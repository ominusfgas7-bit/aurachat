const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- tiny .env loader (no dependency) ----
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
} catch {}

const express = require('express');
const { db, getSetting, setSetting, MEMORY_INSTRUCTIONS } = require('./db');
const { streamModel, listModels, testModel, setConfigSource, clearModelCache } = require('./providers');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Put it in .env (the installer does this).');
  process.exit(1);
}
const mcp = require('./mcp');
const webtools = require('./webtools');
const APP_NAME = process.env.APP_NAME || 'AuraChat';

let SESSION_SECRET = process.env.SESSION_SECRET || getSetting('session_secret');
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', SESSION_SECRET);
}

// ---------- provider config: settings (set in the web UI) first, .env as fallback ----------
const sget = (k) => getSetting(k, '');
// "__none__" = key removed in the UI on purpose, so it also overrides a key left in .env
const pick = (k, envVal) => { const v = sget(k); return v === '__none__' ? '' : v || envVal || ''; };
const cfg = () => ({
  anthropicKey: pick('anthropic_key', process.env.ANTHROPIC_API_KEY),
  anthropicBase: sget('anthropic_base') || process.env.ANTHROPIC_BASE_URL || '',
  openrouterKey: pick('openrouter_key', process.env.OPENROUTER_API_KEY),
  openrouterBase: sget('openrouter_base') || process.env.OPENROUTER_BASE_URL || '',
  customBase: sget('custom_base') || process.env.CUSTOM_BASE_URL || '',
  customKey: pick('custom_key', process.env.CUSTOM_API_KEY),
  customMode: sget('custom_mode') || process.env.CUSTOM_MODE || 'auto',
  customExtra: sget('custom_extra') || process.env.CUSTOM_EXTRA_MODELS || '',
});
setConfigSource(cfg);
const hint = (k) => (k ? (k.length > 14 ? `${k.slice(0, 6)}…${k.slice(-4)}` : '••••') : '');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '40mb' }));

const STYLES = {
  normal: '',
  concise: 'Response style: Concise. Keep replies short and to the point, no filler.',
  explanatory: 'Response style: Explanatory. Teach clearly: give context, reasoning and examples, step by step.',
  formal: 'Response style: Formal. Use a professional, polished tone with precise wording.',
  casual: 'Response style: Casual. Talk like a friendly, relaxed human; informal tone is fine.',
};

// ---------- auth ----------
const COOKIE = 'aura_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest();

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isAuthed(req) {
  const c = parseCookies(req)[COOKIE];
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

const attempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  const rec = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (rec.length >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const pw = String(req.body?.password || '');
  if (!crypto.timingSafeEqual(sha(pw), sha(ADMIN_PASSWORD))) {
    rec.push(now);
    attempts.set(ip, rec);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  const exp = String(now + SESSION_MS);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});
app.use('/api', (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Not logged in' })));
app.get('/api/me', (req, res) => res.json({ ok: true, appName: APP_NAME }));

// ---------- default model ----------
function pickDefaultModel(models) {
  const saved = getSetting('default_model');
  if (saved) return saved;
  if (process.env.DEFAULT_MODEL) return process.env.DEFAULT_MODEL;
  const has = (id) => models.some((m) => m.id === id);
  if (has('anthropic:claude-sonnet-4-5')) return 'anthropic:claude-sonnet-4-5';
  const sonnet = models.find((m) => /sonnet[-.]?4[-.]?5/i.test(m.id) && !/anthropic:/.test(m.id));
  if (sonnet) return sonnet.id;
  return models[0]?.id || 'anthropic:claude-sonnet-4-5';
}

app.get('/api/models', async (req, res) => {
  const models = await listModels(req.query.refresh === '1');
  const c = cfg();
  res.json({
    models,
    defaultModel: pickDefaultModel(models),
    keys: { anthropic: !!c.anthropicKey, openrouter: !!c.openrouterKey, custom: !!(c.customBase && c.customKey) },
  });
});

// ---------- config (everything editable from the UI) ----------
app.get('/api/config', (req, res) => {
  const c = cfg();
  res.json({
    appName: APP_NAME,
    displayName: getSetting('display_name', ''),
    memoryEnabled: getSetting('memory_enabled', '1') === '1',
    defaultSkillId: parseInt(getSetting('default_skill_id', '0'), 10) || 0,
    defaultModel: getSetting('default_model', ''),
    systemPrompt: getSetting('system_prompt', ''),
    providers: {
      anthropic: { set: !!c.anthropicKey, hint: hint(c.anthropicKey) },
      openrouter: { set: !!c.openrouterKey, hint: hint(c.openrouterKey) },
      custom: { set: !!c.customKey, hint: hint(c.customKey), baseUrl: c.customBase, mode: c.customMode, extra: c.customExtra },
    },
  });
});
app.put('/api/config', (req, res) => {
  const b = req.body || {};
  const str = (k, max = 500) => (typeof b[k] === 'string' ? b[k].trim().slice(0, max) : undefined);
  const put = (key, v) => { if (v !== undefined) setSetting(key, v); };
  put('display_name', str('displayName', 60));
  put('system_prompt', typeof b.systemPrompt === 'string' ? b.systemPrompt.slice(0, 8000) : undefined);
  put('default_model', str('defaultModel', 200));
  if (typeof b.memoryEnabled === 'boolean') setSetting('memory_enabled', b.memoryEnabled ? '1' : '0');
  if (b.defaultSkillId !== undefined) setSetting('default_skill_id', String(parseInt(b.defaultSkillId, 10) || 0));
  // secrets: empty string = leave unchanged, "__clear__" = remove
  for (const [field, key] of [['anthropicKey', 'anthropic_key'], ['openrouterKey', 'openrouter_key'], ['customKey', 'custom_key']]) {
    const v = str(field, 400);
    if (v === '__clear__') setSetting(key, '__none__');
    else if (v) setSetting(key, v);
  }
  put('custom_base', str('customBaseUrl', 300));
  const mode = str('customMode', 30);
  if (['auto', 'openai', 'anthropic', 'anthropic-bearer'].includes(mode)) setSetting('custom_mode', mode);
  if (typeof b.customExtra === 'string') setSetting('custom_extra', b.customExtra.slice(0, 2000));
  clearModelCache();
  res.json({ ok: true });
});
app.post('/api/test', async (req, res) => {
  res.json(await testModel(String(req.body?.model || '')));
});

// ---------- conversations ----------
app.get('/api/conversations', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    return res.json(
      db.prepare(`SELECT id,title,model,updated,starred FROM conversations
        WHERE title LIKE ? ESCAPE '\\' OR id IN (SELECT conv_id FROM messages WHERE content LIKE ? ESCAPE '\\')
        ORDER BY updated DESC LIMIT 100`).all(like, like)
    );
  }
  res.json(db.prepare('SELECT id,title,model,updated,starred FROM conversations ORDER BY updated DESC LIMIT 500').all());
});
app.get('/api/conversations/:id', (req, res) => {
  const c = db.prepare('SELECT id,title,model,starred,skill_id FROM conversations WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.messages = db.prepare('SELECT id,role,content,model,thinking FROM messages WHERE conv_id=? ORDER BY id').all(c.id);
  const atts = db.prepare('SELECT id,msg_id,kind,name FROM attachments WHERE msg_id IN (SELECT id FROM messages WHERE conv_id=?)').all(c.id);
  for (const m of c.messages) {
    m.images = atts.filter((a) => a.msg_id === m.id && a.kind === 'image').map((a) => a.id);
    m.files = atts.filter((a) => a.msg_id === m.id && a.kind === 'text').map((a) => a.name);
  }
  res.json(c);
});
app.patch('/api/conversations/:id', (req, res) => {
  const b = req.body || {};
  if (typeof b.title === 'string') {
    const t = b.title.trim().slice(0, 120);
    if (!t) return res.status(400).json({ error: 'Title required' });
    db.prepare('UPDATE conversations SET title=? WHERE id=?').run(t, req.params.id);
  }
  if (typeof b.starred === 'boolean') db.prepare('UPDATE conversations SET starred=? WHERE id=?').run(b.starred ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM conversations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/attachments/:id', (req, res) => {
  const a = db.prepare("SELECT mime,data FROM attachments WHERE id=? AND kind='image'").get(req.params.id);
  if (!a) return res.status(404).end();
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(Buffer.from(a.data, 'base64'));
});

// ---------- memories ----------
function addMemory(text) {
  text = String(text).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return false;
  if (db.prepare('SELECT 1 FROM memories WHERE lower(text)=lower(?)').get(text)) return false;
  db.prepare('INSERT INTO memories(text,created) VALUES(?,?)').run(text, Date.now());
  return true;
}
app.get('/api/memories', (req, res) => res.json(db.prepare('SELECT id,text FROM memories ORDER BY id DESC').all()));
app.post('/api/memories', (req, res) => {
  if (!addMemory(req.body?.text || '')) return res.status(400).json({ error: 'Empty or duplicate' });
  res.json({ ok: true });
});
app.delete('/api/memories/:id', (req, res) => {
  db.prepare('DELETE FROM memories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/memories', (req, res) => {
  db.prepare('DELETE FROM memories').run();
  res.json({ ok: true });
});

// ---------- skills (pick one per chat; star = default for new chats) ----------
app.get('/api/skills', (req, res) => {
  const def = parseInt(getSetting('default_skill_id', '0'), 10) || 0;
  const rows = db.prepare("SELECT id,slug,name,icon,description,instructions,builtin FROM skills WHERE slug IS NOT 'memory' ORDER BY builtin DESC, id").all();
  res.json(rows.map((r) => ({ ...r, isDefault: r.id === def })));
});
app.post('/api/skills', (req, res) => {
  const { name, description = '', instructions = '', icon = '✦' } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name required' });
  const r = db
    .prepare('INSERT INTO skills(name,description,instructions,icon,enabled,builtin) VALUES(?,?,?,?,0,0)')
    .run(String(name).trim().slice(0, 80), String(description).slice(0, 300), String(instructions).slice(0, 20000), String(icon || '✦').slice(0, 4));
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/skills/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE skills SET name=?,description=?,instructions=?,icon=? WHERE id=?').run(
    typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : s.name,
    typeof b.description === 'string' ? b.description.slice(0, 300) : s.description,
    typeof b.instructions === 'string' ? b.instructions.slice(0, 20000) : s.instructions,
    typeof b.icon === 'string' && b.icon.trim() ? b.icon.trim().slice(0, 4) : s.icon,
    s.id
  );
  res.json({ ok: true });
});
app.delete('/api/skills/:id', (req, res) => {
  const r = db.prepare('DELETE FROM skills WHERE id=? AND builtin=0').run(req.params.id);
  if (r.changes && String(getSetting('default_skill_id', '0')) === String(req.params.id)) setSetting('default_skill_id', '0');
  res.json({ ok: true });
});

// ---------- Paper server jar (fetched from PaperMC, never stored on this server) ----------
app.get('/api/paper/:version?', async (req, res) => {
  try { res.json(await webtools.paperInfo(req.params.version)); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/paper/:version/download', async (req, res) => {
  try { res.redirect(302, (await webtools.paperInfo(req.params.version)).url); } catch (e) { res.status(502).send(e.message); }
});

// ---------- connectors (MCP servers, e.g. GitHub) ----------
const getConnectors = () => { try { const a = JSON.parse(getSetting('mcp_servers', '[]')); return Array.isArray(a) ? a : []; } catch { return []; } };
const pubConnector = (x) => ({ id: x.id, name: x.name, url: x.url, enabled: x.enabled !== false, readOnly: !!x.readOnly, filter: x.filter || '', hasToken: !!x.token, hint: hint(x.token) });
app.get('/api/connectors', (req, res) => res.json({ connectors: getConnectors().map(pubConnector) }));
app.put('/api/connectors', (req, res) => {
  const old = new Map(getConnectors().map((x) => [x.id, x]));
  const list = (Array.isArray(req.body?.connectors) ? req.body.connectors : []).slice(0, 12).map((x) => {
    const id = typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : crypto.randomBytes(5).toString('hex');
    const prev = old.get(id);
    let token = typeof x.token === 'string' ? x.token.trim().slice(0, 600) : '';
    if (x.token === '__clear__') token = ''; else if (!token) token = prev?.token || '';
    const url = String(x.url || '').trim().slice(0, 400);
    return { id, name: String(x.name || 'Connector').trim().slice(0, 40), url, token, enabled: x.enabled !== false, readOnly: !!x.readOnly, filter: String(x.filter || '').slice(0, 300) };
  }).filter((x) => /^https?:\/\//i.test(x.url));
  setSetting('mcp_servers', JSON.stringify(list));
  res.json({ connectors: list.map(pubConnector) });
});
app.post('/api/connectors/test', async (req, res) => {
  const b = req.body || {};
  const saved = getConnectors().find((x) => x.id === b.id);
  const srv = { ...(saved || {}), ...(b.url ? { url: String(b.url).trim() } : {}), name: b.name || saved?.name || 'Connector', filter: b.filter ?? saved?.filter, readOnly: b.readOnly ?? saved?.readOnly };
  if (typeof b.token === 'string' && b.token.trim()) srv.token = b.token.trim();
  if (!/^https?:\/\//i.test(srv.url || '')) return res.json({ ok: false, error: 'Enter a valid https:// URL' });
  try { res.json({ ok: true, ...(await mcp.testServer(srv)) }); } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ---------- prompt building ----------
function buildSystem(style, skillId, hasTools) {
  const parts = [
    `You are a helpful, thoughtful AI assistant in a self-hosted chat app. Today is ${new Date().toUTCString().slice(0, 16)}. Format answers with Markdown when it helps. When the user asks you to build a web page, app, widget or visual, deliver it as ONE complete self-contained file in a single fenced \`\`\`html block (inline CSS and JS, no build step) or a \`\`\`svg block, so it can be previewed live in the Artifacts panel.

When the user wants files, a project, plugin source, configs or scripts: put EACH file in its own fenced code block whose FIRST line is a file marker comment with the path, e.g. \`// file: src/Main.java\`, \`# file: config.yml\`, \`<!-- file: index.html -->\`, \`-- file: setup.sql\`. The app hides the code behind download cards and adds a "Download all (.zip)" button, so do NOT say you created or attached a zip or any file yourself, and never paste file contents outside those blocks. For Java/Minecraft plugins ALWAYS include a complete pom.xml (Maven, with the right repositories/dependencies, e.g. Paper API as provided scope) plus plugin.yml; the app has a \"Build .jar\" button that compiles the files on the server. You cannot produce other binaries (.exe, images). Keep prose short and don't repeat code in the explanation.`,
  ];
  if (hasTools) parts.push('## Connectors\nYou can call tools connected to the user\'s accounts (e.g. GitHub). Use them when the user asks to read, search, create or change files/repos; if you need an owner/repo or path you don\'t know, look it up with a tool or ask briefly. After using tools, say plainly what you did (repo, path, branch). Never claim to have changed something unless a tool call succeeded.');
  if (STYLES[style]) parts.push(STYLES[style]);
  const custom = getSetting('system_prompt', '').trim();
  if (custom) parts.push(`## User's custom instructions\n${custom}`);

  const sid = parseInt(skillId, 10) || 0;
  if (sid) {
    const s = db.prepare('SELECT name,instructions FROM skills WHERE id=?').get(sid);
    if (s && s.instructions.trim()) parts.push(`## Active skill: ${s.name}\n${s.instructions.trim()}`);
  }
  if (getSetting('memory_enabled', '1') === '1') {
    parts.push(`## Memory\n${MEMORY_INSTRUCTIONS}`);
    const mems = db.prepare('SELECT text FROM memories ORDER BY id').all();
    if (mems.length) parts.push(`## Saved memories\n${mems.map((m) => `- ${m.text}`).join('\n')}`);
  }
  return parts.join('\n\n');
}
app.get('/api/system-prompt', (req, res) => res.json({ prompt: buildSystem(String(req.query.style || 'normal'), req.query.skillId) }));

function buildMessages(convId) {
  const rows = db.prepare('SELECT id,role,content FROM messages WHERE conv_id=? ORDER BY id').all(convId);
  const out = [];
  for (const r of rows) {
    const atts = db.prepare('SELECT kind,mime,data,name,text FROM attachments WHERE msg_id=?').all(r.id);
    const images = atts.filter((a) => a.kind === 'image').map((a) => ({ mime: a.mime, data: a.data }));
    const files = atts.filter((a) => a.kind === 'text').map((a) => `<attached_file name="${a.name.replace(/"/g, "'")}">\n${a.text}\n</attached_file>`);
    let content = r.content;
    if (files.length) content = files.join('\n\n') + (content ? `\n\n${content}` : '');
    if (!content.trim() && !images.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === r.role) {
      last.content += '\n\n' + content;
      last.images = [...(last.images || []), ...images];
    } else out.push({ role: r.role, content, images });
  }
  return out;
}

const ALLOWED_IMG = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function parseOpts(o = {}) {
  const opts = {};
  if (['low', 'medium', 'high', 'max'].includes(o.effort)) opts.effort = o.effort;
  if (typeof o.temperature === 'number' && o.temperature >= 0 && o.temperature <= 1) opts.temperature = o.temperature;
  if (o.webSearch) opts.webSearch = true;
  const mt = parseInt(o.maxTokens, 10);
  if (mt >= 256 && mt <= 64000) opts.maxTokens = mt;
  return opts;
}

// Strips <memory>...</memory> tags out of the stream and reports their content.
class MemoryFilter {
  constructor(onMemory) { this.buf = ''; this.inside = false; this.onMemory = onMemory; }
  push(chunk) {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (!this.inside) {
        const i = this.buf.indexOf('<memory>');
        if (i === -1) {
          let keep = 0;
          for (let k = Math.min(7, this.buf.length); k > 0; k--) {
            if ('<memory>'.startsWith(this.buf.slice(-k))) { keep = k; break; }
          }
          out += this.buf.slice(0, this.buf.length - keep);
          this.buf = this.buf.slice(this.buf.length - keep);
          break;
        }
        out += this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 8);
        this.inside = true;
      } else {
        const j = this.buf.indexOf('</memory>');
        if (j === -1) break;
        this.onMemory(this.buf.slice(0, j));
        this.buf = this.buf.slice(j + 9);
        this.inside = false;
      }
    }
    return out;
  }
  flush() { const r = this.inside ? '' : this.buf; this.buf = ''; return r; }
}

// ---------- chat ----------
app.post('/api/chat', async (req, res) => {
  const { conversationId, message, regenerate, editMessageId } = req.body || {};
  const c = cfg();
  const modelId = String(req.body?.model || getSetting('default_model') || process.env.DEFAULT_MODEL || 'anthropic:claude-sonnet-4-5');
  const opts = parseOpts(req.body?.options);
  const style = String(req.body?.style || 'normal');
  const skillId = parseInt(req.body?.skillId, 10) || 0;
  const images = (Array.isArray(req.body?.images) ? req.body.images : [])
    .filter((im) => im && ALLOWED_IMG.has(im.mime) && typeof im.data === 'string' && im.data.length < 20e6).slice(0, 5);
  const files = (Array.isArray(req.body?.files) ? req.body.files : [])
    .filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string')
    .map((f) => ({ name: f.name.slice(0, 120), text: f.text.slice(0, 400000) })).slice(0, 8);
  const now = Date.now();
  void c;

  let conv;
  if (conversationId) {
    conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  }

  if (regenerate) {
    if (!conv) return res.status(400).json({ error: 'Nothing to regenerate' });
    const last = db.prepare('SELECT id,role FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 1').get(conv.id);
    if (last && last.role === 'assistant') db.prepare('DELETE FROM messages WHERE id=?').run(last.id);
  } else {
    const text = String(message || '').trim();
    if (!text && !images.length && !files.length) return res.status(400).json({ error: 'Empty message' });
    let carry = [];
    if (!conv) {
      const title = (text || files[0]?.name || 'Image').replace(/\s+/g, ' ').slice(0, 60);
      const r = db.prepare('INSERT INTO conversations(title,model,created,updated) VALUES(?,?,?,?)').run(title, modelId, now, now);
      conv = { id: r.lastInsertRowid, title, model: modelId };
    } else if (editMessageId) {
      // edit: keep the old attachments if none were provided, then drop that message and everything after
      if (!images.length && !files.length) carry = db.prepare('SELECT kind,mime,data,name,text FROM attachments WHERE msg_id=?').all(editMessageId);
      db.prepare('DELETE FROM messages WHERE conv_id=? AND id>=?').run(conv.id, editMessageId);
    }
    const mid = db.prepare('INSERT INTO messages(conv_id,role,content,created) VALUES(?,?,?,?)').run(conv.id, 'user', text, now).lastInsertRowid;
    const insA = db.prepare('INSERT INTO attachments(msg_id,mime,data,kind,name,text) VALUES(?,?,?,?,?,?)');
    for (const im of images) insA.run(mid, im.mime, im.data, 'image', '', '');
    for (const f of files) insA.run(mid, 'text/plain', '', 'text', f.name, f.text);
    for (const a of carry) insA.run(mid, a.mime, a.data, a.kind, a.name, a.text);
  }
  db.prepare('UPDATE conversations SET updated=?, model=?, skill_id=? WHERE id=?').run(now, modelId, skillId, conv.id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ type: 'meta', conversationId: conv.id, title: conv.title });

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  let full = '';
  let thinking = '';
  const filter = new MemoryFilter((t) => addMemory(t));
  const memoryOn = getSetting('memory_enabled', '1') === '1';
  let failed = null;

  try {
    let toolset = null;
    if (req.body?.options?.connectors !== false && getConnectors().some((x) => x.enabled !== false)) {
      toolset = await mcp.buildToolset(getConnectors());
      if (toolset.notes.length) send({ type: 'status', text: 'Connector problem: ' + toolset.notes[0] });
      if (!toolset.defs.length) toolset = null;
    }
    // gateways have no native web search: give the model our own web_search / web_fetch tools
    const skSlug = skillId ? (db.prepare('SELECT slug FROM skills WHERE id=?').get(skillId)?.slug || '') : '';
    const wantSearch = !!opts.webSearch && modelId.startsWith('custom:');
    if (wantSearch || skSlug.startsWith('mc-')) {
      toolset = webtools.withWebTools(toolset, process.env.TAVILY_API_KEY || getSetting('tavily_key', ''), { search: wantSearch || skSlug.startsWith('mc-'), paper: true });
      if (modelId.startsWith('custom:')) opts.webSearch = false;
    }
    const stream = streamModel({ modelId, system: buildSystem(style, skillId, !!toolset), messages: buildMessages(conv.id), opts: { ...opts, toolset }, signal: ac.signal });
    for await (const ev of stream) {
      if (ev.t === 'thinking') { thinking += ev.text; send({ type: 'thinking', text: ev.text }); continue; }
      if (ev.t === 'status') { send({ type: 'status', text: ev.text }); continue; }
      const visible = memoryOn ? filter.push(ev.text) : ev.text;
      if (visible) { full += visible; send({ type: 'delta', text: visible }); }
    }
    if (memoryOn) {
      const rest = filter.flush();
      if (rest) { full += rest; send({ type: 'delta', text: rest }); }
    }
  } catch (e) {
    if (!ac.signal.aborted) failed = e.message || String(e);
  }

  full = full.trim();
  let id = null;
  if (full) {
    id = db.prepare('INSERT INTO messages(conv_id,role,content,model,thinking,created) VALUES(?,?,?,?,?,?)').run(conv.id, 'assistant', full, modelId, thinking, Date.now()).lastInsertRowid;
    db.prepare('UPDATE conversations SET updated=? WHERE id=?').run(Date.now(), conv.id);
  }
  if (!res.writableEnded) {
    if (failed) send({ type: 'error', error: failed });
    send({ type: 'done', messageId: id });
    res.end();
  }
});

// ---------- build .jar from generated files (needs JDK + Maven on this server) ----------
const { spawn } = require('child_process');
const fsx = require('fs'), osx = require('os');
function run(cmd, args, cwd, ms) {
  return new Promise((resolve) => {
    let out = '', done = false;
    const p = spawn(cmd, args, { cwd, env: { ...process.env, MAVEN_OPTS: '-Xmx512m' } });
    const t = setTimeout(() => { if (!done) { p.kill('SIGKILL'); out += '\n[build timed out]'; } }, ms);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => { done = true; clearTimeout(t); resolve({ code: 127, out: out + e.message }); });
    p.on('close', (code) => { done = true; clearTimeout(t); resolve({ code, out }); });
  });
}
const walk = (d) => fsx.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
app.post('/api/build', async (req, res) => {
  const files = (Array.isArray(req.body?.files) ? req.body.files : []).filter((f) => f && typeof f.name === 'string' && typeof f.text === 'string').slice(0, 200);
  if (!files.length) return res.json({ ok: false, log: 'No files' });
  const dir = fsx.mkdtempSync(path.join(osx.tmpdir(), 'aurabuild-'));
  const cleanup = () => fsx.rmSync(dir, { recursive: true, force: true });
  try {
    for (const f of files) {
      const rel = path.normalize(f.name.replace(/^\/+/, ''));
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      fsx.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fsx.writeFileSync(path.join(dir, rel), f.text);
    }
    const has = (n) => files.some((f) => f.name.replace(/^\/+/, '') === n || f.name.endsWith('/' + n));
    let r, jar;
    if (has('pom.xml')) {
      const root = path.dirname(walk(dir).find((p) => path.basename(p) === 'pom.xml'));
      r = await run('mvn', ['-q', '-B', '-DskipTests', 'package'], root, 8 * 60 * 1000);
      jar = fsx.existsSync(path.join(root, 'target')) && walk(path.join(root, 'target')).filter((p) => p.endsWith('.jar') && !/original-|sources|javadoc/.test(p)).sort((a, b) => fsx.statSync(b).size - fsx.statSync(a).size)[0];
    } else if (has('build.gradle') || has('build.gradle.kts')) {
      r = await run('gradle', ['build', '-x', 'test', '--no-daemon', '-q'], dir, 10 * 60 * 1000);
      jar = fsx.existsSync(path.join(dir, 'build/libs')) && walk(path.join(dir, 'build/libs')).find((p) => p.endsWith('.jar') && !/plain|sources/.test(p));
    } else if (files.some((f) => f.name.endsWith('.java'))) {
      const out = path.join(dir, '_out'); fsx.mkdirSync(out);
      const srcs = walk(dir).filter((p) => p.endsWith('.java') && !p.startsWith(out));
      r = await run('javac', ['-d', out, ...srcs], dir, 3 * 60 * 1000);
      if (r.code === 0) {
        for (const p of walk(dir)) { if (p.startsWith(out) || p.endsWith('.java')) continue; const rel = path.relative(dir, p); fsx.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true }); fsx.copyFileSync(p, path.join(out, rel)); }
        const j = path.join(dir, 'app.jar'); const r2 = await run('jar', ['cf', j, '-C', out, '.'], dir, 60000); r.out += r2.out; if (r2.code === 0) jar = j;
      }
    } else return res.json({ ok: false, log: 'Nothing to build: need a pom.xml, build.gradle or .java files.' });
    const log = (r.out || '').split('\n').filter((l) => !/^Picked up /.test(l)).join('\n').slice(-3500);
    if (r.code === 127) return res.json({ ok: false, log: `Build tool missing on the server.\nInstall: apt-get install -y default-jdk-headless maven\n\n${log}` });
    if (r.code !== 0 || !jar) return res.json({ ok: false, log: log || 'Build failed' });
    res.json({ ok: true, name: path.basename(jar), size: fsx.statSync(jar).size, data: fsx.readFileSync(jar).toString('base64'), log });
  } catch (e) { res.json({ ok: false, log: e.message }); } finally { cleanup(); }
});

// ---------- export ----------
app.get('/api/export', (req, res) => {
  const convs = db.prepare('SELECT * FROM conversations ORDER BY id').all().map((c) => ({
    ...c, messages: db.prepare('SELECT role,content,model,thinking,created FROM messages WHERE conv_id=? ORDER BY id').all(c.id),
  }));
  res.setHeader('Content-Disposition', `attachment; filename="${APP_NAME.toLowerCase()}-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    memories: db.prepare('SELECT text FROM memories ORDER BY id').all().map((m) => m.text),
    skills: db.prepare('SELECT name,icon,description,instructions FROM skills WHERE builtin=0').all(),
    conversations: convs,
  });
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`${APP_NAME} running on http://0.0.0.0:${PORT}`));
