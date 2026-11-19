// Build jobs: compile generated Minecraft plugin projects and assemble a READY server .zip
// (Paper jar from PaperMC + compiled plugins + third-party plugins from Modrinth + configs + start scripts).
// Java 21 and Maven are downloaded automatically into DATA_DIR/tools when the server doesn't have them.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { paperInfo } = require('./webtools');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TOOLS = path.join(DATA_DIR, 'tools');
const PACKS = path.join(DATA_DIR, 'packs');
const UA = 'AuraChat/1.0 (self-hosted chat; https://github.com/ominusfgas7-bit/aurachat)';
const jobs = new Map();

// ---------- helpers ----------
function run(cmd, args, { cwd, env, ms = 600000, onLine } = {}) {
  return new Promise((resolve) => {
    let out = '', done = false;
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) } });
    const t = setTimeout(() => { if (!done) { p.kill('SIGKILL'); out += '\n[timed out]'; } }, ms);
    const feed = (d) => { out += d; if (onLine) String(d).split('\n').forEach((l) => l.trim() && onLine(l)); };
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('error', (e) => { done = true; clearTimeout(t); resolve({ code: 127, out: out + e.message }); });
    p.on('close', (code) => { done = true; clearTimeout(t); resolve({ code, out }); });
  });
}
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const clean = (s) => String(s || '').split('\n').filter((l) => !/^Picked up /.test(l)).join('\n');

async function download(url, dest, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, redirect: 'follow' });
  if (!r.ok) throw new Error(`Download failed ${r.status}: ${url}`);
  const tmp = dest + '.part';
  const ws = fs.createWriteStream(tmp);
  const reader = r.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (!ws.write(value)) await new Promise((res) => ws.once('drain', res)); }
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
  fs.renameSync(tmp, dest);
}

// ---------- toolchain (Java 21 + Maven) ----------
async function javaMajor(javac) {
  const r = await run(javac, ['-version'], { ms: 20000 });
  const m = clean(r.out).match(/javac\s+(\d+)/);
  return r.code === 0 && m ? parseInt(m[1], 10) : 0;
}
async function ensureToolchain(log) {
  fs.mkdirSync(TOOLS, { recursive: true });
  const env = {}; const bins = [];
  // JDK 21
  let jdk = fs.readdirSync(TOOLS).find((d) => d.startsWith('jdk-') && fs.existsSync(path.join(TOOLS, d, 'bin', 'javac')));
  if (jdk) { jdk = path.join(TOOLS, jdk); } else if ((await javaMajor('javac')) >= 21) { jdk = null; } else {
    log('Downloading Java 21 (one time, ~200 MB)…');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const tgz = path.join(TOOLS, 'jdk21.tar.gz');
    await download(`https://api.adoptium.net/v3/binary/latest/21/ga/linux/${arch}/jdk/hotspot/normal/eclipse`, tgz);
    log('Unpacking Java 21…');
    const r = await run('tar', ['-xzf', tgz, '-C', TOOLS], { ms: 300000 });
    fs.rmSync(tgz, { force: true });
    if (r.code !== 0) throw new Error('Could not unpack Java: ' + r.out.slice(-300));
    const d = fs.readdirSync(TOOLS).find((x) => x.startsWith('jdk-'));
    if (!d) throw new Error('Java 21 download looked wrong');
    jdk = path.join(TOOLS, d);
  }
  if (jdk) { env.JAVA_HOME = jdk; bins.push(path.join(jdk, 'bin')); }
  // Maven
  let mvnHome = fs.readdirSync(TOOLS).find((d) => d.startsWith('apache-maven-') && fs.existsSync(path.join(TOOLS, d, 'bin', 'mvn')));
  if (mvnHome) { bins.push(path.join(TOOLS, mvnHome, 'bin')); } else {
    const sys = await run('mvn', ['-v'], { ms: 20000, env: env.JAVA_HOME ? { JAVA_HOME: env.JAVA_HOME } : {} });
    if (sys.code !== 0) {
      log('Downloading Maven (one time)…');
      const tgz = path.join(TOOLS, 'maven.tar.gz');
      await download('https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.tar.gz', tgz);
      const r = await run('tar', ['-xzf', tgz, '-C', TOOLS], { ms: 120000 });
      fs.rmSync(tgz, { force: true });
      if (r.code !== 0) throw new Error('Could not unpack Maven');
      bins.push(path.join(TOOLS, 'apache-maven-3.9.9', 'bin'));
    }
  }
  if (bins.length) env.PATH = bins.join(path.delimiter) + path.delimiter + process.env.PATH;
  env.MAVEN_OPTS = '-Xmx768m';
  return env;
}

// ---------- zip writer (deflate for text, store for jars) ----------
let CRC;
function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
async function zipDir(dir, outPath, topFolder) {
  const ws = fs.createWriteStream(outPath); const central = []; let off = 0;
  const w = (b) => new Promise((res, rej) => ws.write(b, (e) => (e ? rej(e) : res())));
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of walk(dir).sort()) {
    const rel = (topFolder ? topFolder + '/' : '') + path.relative(dir, f).split(path.sep).join('/');
    const data = fs.readFileSync(f), name = Buffer.from(rel), crc = crc32(data);
    const store = /\.(jar|zip|png|jpg|gz)$/i.test(f);
    const body = store ? data : zlib.deflateRawSync(data), method = store ? 0 : 8;
    const exec = /\.(sh)$/.test(f) ? 0o755 : 0o644;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt16LE(dt, 10); h.writeUInt16LE(dd, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    await w(h); await w(name); await w(body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt16LE(dt, 12); c.writeUInt16LE(dd, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(((0o100000 | exec) << 16) >>> 0, 38); c.writeUInt32LE(off, 42);
    central.push(c, name); off += 30 + name.length + body.length;
  }
  const cs = central.reduce((n, b) => n + b.length, 0); for (const b of central) await w(b);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cs, 12); e.writeUInt32LE(off, 16);
  await w(e); await new Promise((res) => ws.end(res));
}

// ---------- third-party plugins (plugins.txt: Modrinth slugs or direct .jar URLs) ----------
async function fetchPlugins(list, mc, pluginsDir, notes, log) {
  for (const raw of list) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    try {
      if (/^https?:\/\/.+\.jar(\?.*)?$/i.test(line)) { log(`Downloading ${line.split('/').pop()}…`); await download(line, path.join(pluginsDir, decodeURIComponent(line.split('/').pop().split('?')[0]))); continue; }
      const slug = line.split(/\s+/)[0].toLowerCase(); if (!/^[a-z0-9_-]+$/.test(slug)) { notes.push(`Skipped "${line}" (not a Modrinth slug)`); continue; }
      log(`Plugin: ${slug}…`);
      let vs;
      for (const q of [`loaders=${encodeURIComponent('["paper"]')}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`, `loaders=${encodeURIComponent('["paper","spigot","bukkit"]')}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`]) {
        const r = await fetch(`https://api.modrinth.com/v2/project/${slug}/version?${q}`, { headers: { 'user-agent': UA } });
        if (!r.ok) { vs = null; break; }
        vs = await r.json(); if (vs.length) break;
      }
      const v = vs && vs[0]; const file = v && (v.files.find((f) => f.primary) || v.files[0]);
      if (!file) { notes.push(`Not on Modrinth for ${mc}: ${slug} (add it to plugins/ yourself)`); continue; }
      await download(file.url, path.join(pluginsDir, file.filename));
    } catch (e) { notes.push(`Plugin "${line}" failed: ${e.message}`); }
  }
}

// ---------- the job ----------
function startJob(files, { mode = 'pack', mcVersion = '' } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, state: 'running', steps: [], log: '', created: Date.now() };
  jobs.set(id, job);
  const log = (s) => { job.steps.push(s); if (job.steps.length > 60) job.steps.shift(); };
  (async () => {
    sweep();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aurabuild-'));
    try {
      fs.mkdirSync(PACKS, { recursive: true });
      for (const f of files) {
        const rel = path.normalize(String(f.name).replace(/^\/+/, ''));
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
        fs.writeFileSync(path.join(work, rel), f.text);
      }
      const names = files.map((f) => f.name.replace(/^\/+/, ''));
      const pomPath = walk(work).filter((p) => path.basename(p) === 'pom.xml').sort((a, b) => a.length - b.length)[0];
      const hasJava = names.some((n) => n.endsWith('.java'));
      if (!pomPath && !hasJava) throw Object.assign(new Error('Nothing to build: need a pom.xml or .java files.'), { build: true });

      log('Preparing Java…');
      const env = await ensureToolchain(log);
      const jars = [];
      if (pomPath) {
        const root = path.dirname(pomPath);
        log('Compiling with Maven (first time downloads dependencies, can take a few minutes)…');
        const r = await run('mvn', ['-B', '-DskipTests', '-Dmaven.javadoc.skip=true', 'package'], { cwd: root, env, ms: 15 * 60 * 1000, onLine: (l) => { if (/Building |BUILD|ERROR/.test(l)) log(l.replace(/\[\w+\]\s*/, '').slice(0, 90)); } });
        if (r.code !== 0) { const out = clean(r.out); const i = out.search(/\[ERROR\]/); throw Object.assign(new Error(out.slice(Math.max(0, i)).slice(0, 3500)), { build: true }); }
        for (const p of walk(root)) if (/[\\/]target[\\/][^\\/]+\.jar$/.test(p) && !/original-|-sources|-javadoc|-shaded-\d/.test(path.basename(p))) jars.push(p);
        if (!jars.length) throw Object.assign(new Error('Maven finished but produced no .jar (check <packaging> and finalName).'), { build: true });
      } else {
        log('Compiling with javac…');
        const out = path.join(work, '_out'); fs.mkdirSync(out);
        const srcs = walk(work).filter((p) => p.endsWith('.java') && !p.startsWith(out));
        const r = await run('javac', ['-d', out, ...srcs], { cwd: work, env, ms: 180000 });
        if (r.code !== 0) throw Object.assign(new Error(clean(r.out).slice(0, 3500)), { build: true });
        for (const p of walk(work)) { if (p.startsWith(out) || p.endsWith('.java')) continue; const rel = path.relative(work, p); fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fs.copyFileSync(p, path.join(out, rel)); }
        const j = path.join(work, 'plugin.jar'); const r2 = await run('jar', ['cf', j, '-C', out, '.'], { cwd: work, env, ms: 60000 });
        if (r2.code !== 0) throw new Error(clean(r2.out)); jars.push(j);
      }

      const save = path.join(PACKS, id + '.zip');
      const notes = [];
      if (mode === 'jar' || (!names.some((n) => /(^|\/)(server\/|plugins\.txt$|start\.sh$|server\.properties$)/.test(n)) && mode !== 'pack-force' && jars.length === 1 && mode !== 'pack')) {
        // single jar download
        fs.copyFileSync(jars[0], save + '.jar'); fs.renameSync(save + '.jar', save);
        job.result = { kind: 'jar', name: path.basename(jars[0]), size: fs.statSync(save).size };
      } else {
        const out = path.join(work, '_server'); fs.mkdirSync(path.join(out, 'plugins'), { recursive: true });
        for (const j of jars) fs.copyFileSync(j, path.join(out, 'plugins', path.basename(j)));
        // project's server/ folder becomes the server root
        for (const p of walk(work)) {
          const rel = path.relative(work, p).split(path.sep).join('/');
          if (rel.startsWith('server/') && !rel.includes('/target/')) { const dest = path.join(out, rel.slice(7)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(p, dest); }
        }
        // Paper version: request > pom paper-api > latest
        let mc = mcVersion;
        if (!mc) { const pom = pomPath ? fs.readFileSync(pomPath, 'utf8') : ''; const m = pom.match(/paper-api<\/artifactId>\s*<version>\s*([0-9][0-9.]*)-R0/); mc = m ? m[1] : 'latest'; }
        log(`Fetching Paper ${mc}…`);
        const info = await paperInfo(mc); mc = info.version;
        await download(info.url, path.join(out, 'paper.jar'));
        const pt = walk(work).find((p) => /(^|[\\/])plugins\.txt$/.test(p));
        if (pt) await fetchPlugins(fs.readFileSync(pt, 'utf8').split('\n'), mc, path.join(out, 'plugins'), notes, log);
        if (!fs.existsSync(path.join(out, 'eula.txt'))) fs.writeFileSync(path.join(out, 'eula.txt'), 'eula=true\n');
        let sh = fs.existsSync(path.join(out, 'start.sh')) ? fs.readFileSync(path.join(out, 'start.sh'), 'utf8') : '#!/usr/bin/env bash\ncd "$(dirname "$0")"\nexec java -Xms2G -Xmx2G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -jar paper.jar --nogui\n';
        sh = sh.replace(/-jar\s+\S+\.jar/, '-jar paper.jar'); fs.writeFileSync(path.join(out, 'start.sh'), sh);
        fs.writeFileSync(path.join(out, 'start.bat'), '@echo off\r\njava -Xms2G -Xmx2G -jar paper.jar --nogui\r\npause\r\n');
        fs.writeFileSync(path.join(out, 'README-FIRST.txt'), `Minecraft server (Paper ${mc} build ${info.build})\n\n1. Install Java 21.\n2. Linux/Mac: bash start.sh   Windows: start.bat\n3. Plugins are in plugins/ (custom ones compiled for you).\n\nBy running this server you agree to Mojang's EULA (eula.txt is set to true).\n${notes.length ? '\nNotes:\n- ' + notes.join('\n- ') + '\n' : ''}`);
        log('Packing the .zip…');
        await zipDir(out, save, 'minecraft-server');
        try { fs.cpSync(out, path.join(PACKS, id), { recursive: true }); } catch {} // kept for "Run test server"
        job.result = { kind: 'pack', name: 'minecraft-server.zip', size: fs.statSync(save).size, plugins: fs.readdirSync(path.join(out, 'plugins')).length, mc, build: info.build, notes };
      }
      job.state = 'done';
    } catch (e) {
      job.state = 'error'; job.log = e.message || String(e); job.buildError = !!e.build;
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  })();
  return id;
}

function sweep() { // delete finished packs older than 2 hours; forget old jobs
  const cutoff = Date.now() - 2 * 3600 * 1000;
  try { for (const f of fs.readdirSync(PACKS)) { const p = path.join(PACKS, f); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }); } } catch {}
  for (const [k, j] of jobs) if (j.created < cutoff) jobs.delete(k);
}
const getJob = (id) => jobs.get(id);
const packPath = (id) => (/^[0-9a-f]{16}$/.test(id) ? path.join(PACKS, id + '.zip') : null);

module.exports = { startJob, getJob, packPath, ensureToolchain, download, PACKS, TOOLS, DATA_DIR };
