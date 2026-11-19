// Test-run a built server pack on this machine with the playit.gg plugin, so you get a public address to try it.
// One server at a time, auto-stops after N minutes. Meant for TESTING, not hosting players.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ensureToolchain, download, PACKS, TOOLS, DATA_DIR } = require('./builder');

const RUN_DIR = path.join(DATA_DIR, 'test-server');
const SAVED = path.join(DATA_DIR, 'playit-saved'); // keeps the playit account link between runs
const PLAYIT_URL = process.env.PLAYIT_JAR_URL || 'https://github.com/playit-cloud/playit-minecraft-plugin/releases/latest/download/playit-minecraft-plugin.jar';
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
let cur = null;

const state = () => {
  if (!cur) return { state: 'idle' };
  return {
    state: cur.state, lines: cur.lines.slice(-60), claimUrl: cur.claimUrl, address: cur.address, ready: cur.ready,
    secondsLeft: cur.state === 'running' ? Math.max(0, Math.round((cur.endsAt - Date.now()) / 1000)) : 0, error: cur.error || '', mc: cur.mc || '',
  };
};

function saveLink() { // remember playit config so the account only has to be linked once
  try {
    fs.rmSync(SAVED, { recursive: true, force: true }); fs.mkdirSync(SAVED, { recursive: true });
    const pl = path.join(RUN_DIR, 'plugins');
    for (const d of fs.readdirSync(pl)) if (/playit/i.test(d) && fs.statSync(path.join(pl, d)).isDirectory()) fs.cpSync(path.join(pl, d), path.join(SAVED, d), { recursive: true });
  } catch {}
}

async function start({ packId, minutes = 30, offline = false }) {
  if (cur && ['starting', 'running'].includes(cur.state)) throw Object.assign(new Error('A test server is already running. Stop it first.'), { status: 409 });
  if (!/^[0-9a-f]{16}$/.test(packId || '')) throw new Error('Bad pack id');
  const src = path.join(PACKS, packId);
  if (!fs.existsSync(path.join(src, 'paper.jar'))) throw Object.assign(new Error('That build expired. Build the server again, then run it.'), { status: 404 });
  if (os.totalmem() < 1.1 * 1024 ** 3) throw new Error('This machine has less than ~1 GB RAM — too small to run a Minecraft server.');
  const mins = Math.min(Math.max(parseInt(minutes, 10) || 30, 5), 120);
  const run = (cur = { state: 'starting', lines: [], claimUrl: '', address: '', ready: false, endsAt: Date.now() + mins * 60000, proc: null });
  const log = (s) => { for (const l of String(s).replace(ANSI, '').split(/\r?\n/)) { if (!l.trim()) continue; run.lines.push(l.slice(0, 300)); if (run.lines.length > 300) run.lines.shift(); scan(l); } };
  const scan = (l) => {
    const u = l.match(/https?:\/\/(?:www\.)?playit\.gg\/[^\s"')]+/i); if (u && !run.address) run.claimUrl = u[0];
    const a = l.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:joinmc\.link|ply\.gg)(?::\d{2,5})?)\b/i); if (a) { run.address = a[1]; run.claimUrl = ''; }
    if (/Done \(.*\)! For help/.test(l)) run.ready = true;
  };
  (async () => {
    try {
      log('Preparing…');
      const env = await ensureToolchain((s) => log(s));
      fs.rmSync(RUN_DIR, { recursive: true, force: true });
      fs.cpSync(src, RUN_DIR, { recursive: true });
      const pj = path.join(TOOLS, 'playit.jar');
      if (!fs.existsSync(pj)) { log('Downloading the playit plugin…'); fs.mkdirSync(TOOLS, { recursive: true }); await download(PLAYIT_URL, pj); }
      fs.mkdirSync(path.join(RUN_DIR, 'plugins'), { recursive: true });
      fs.copyFileSync(pj, path.join(RUN_DIR, 'plugins', 'playit-minecraft-plugin.jar'));
      if (fs.existsSync(SAVED)) fs.cpSync(SAVED, path.join(RUN_DIR, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(RUN_DIR, 'eula.txt'), 'eula=true\n');
      // test-friendly server.properties
      const pp = path.join(RUN_DIR, 'server.properties'); let props = fs.existsSync(pp) ? fs.readFileSync(pp, 'utf8') : '';
      const setp = (k, v) => { const re = new RegExp(`^${k}=.*$`, 'm'); props = re.test(props) ? props.replace(re, `${k}=${v}`) : props + (props.endsWith('\n') || !props ? '' : '\n') + `${k}=${v}\n`; };
      setp('server-port', '25565'); setp('server-ip', ''); if (offline) setp('online-mode', 'false');
      fs.writeFileSync(pp, props);
      const mem = Math.max(768, Math.min(3072, Math.floor((os.totalmem() / 1048576) * 0.6)));
      log(`Starting Paper with ${mem} MB…`);
      const p = spawn('java', [`-Xms${Math.min(mem, 1024)}M`, `-Xmx${mem}M`, '-XX:+UseG1GC', '-Dcom.mojang.eula.agree=true', '-jar', 'paper.jar', '--nogui'], { cwd: RUN_DIR, env: { ...process.env, ...env } });
      run.proc = p; run.state = 'running';
      p.stdout.on('data', log); p.stderr.on('data', log);
      p.on('error', (e) => { run.state = 'error'; run.error = e.message; });
      p.on('close', (code) => { clearTimeout(run.timer); saveLink(); if (run.state !== 'error') run.state = 'stopped'; log(`Server stopped (exit ${code}).`); });
      run.timer = setTimeout(() => stop(), mins * 60000);
    } catch (e) { run.state = 'error'; run.error = e.message; log('Error: ' + e.message); }
  })();
  return state();
}

function stop() {
  if (!cur?.proc || cur.state !== 'running') { if (cur && cur.state === 'starting') cur.state = 'stopped'; return state(); }
  try { cur.proc.stdin.write('stop\n'); } catch {}
  const p = cur.proc; setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 25000);
  return state();
}
function command(c) { if (cur?.proc && cur.state === 'running') { try { cur.proc.stdin.write(String(c).slice(0, 200).replace(/[\r\n]/g, ' ') + '\n'); } catch {} } return state(); }
process.on('exit', () => { try { cur?.proc?.kill('SIGKILL'); } catch {} });

module.exports = { start, stop, command, state };
