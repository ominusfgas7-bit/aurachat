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
const { db, getSetting, setSetting } = require('./db');
const { streamModel, listModels } = require('./providers');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is not set. Put it in .env (the installer does this).');
  process.exit(1);
}
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'anthropic:claude-sonnet-4-5';

let SESSION_SECRET = process.env.SESSION_SECRET || getSetting('session_secret');
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', SESSION_SECRET);
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '30mb' }));

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
app.get('/api/me', (req, res) => res.json({ ok: true }));

// ---------- config / models ----------
app.get('/api/models', async (req, res) => {
  const models = await listModels();
  res.json({
    models,
    defaultModel: getSetting('default_model', DEFAULT_MODEL),
    keys: { anthropic: !!process.env.ANTHROPIC_API_KEY, openrouter: !!process.env.OPENROUTER_API_KEY },
  });
});

app.get('/api/settings', (req, res) =>
  res.json({ defaultModel: getSetting('default_model', DEFAULT_MODEL), systemPrompt: getSetting('system_prompt', '') })
);
app.put('/api/settings', (req, res) => {
  const { defaultModel, systemPrompt } = req.body || {};
  if (typeof defaultModel === 'string') setSetting('default_model', defaultModel);
  if (typeof systemPrompt === 'string') setSetting('system_prompt', systemPrompt.slice(0, 8000));
  res.json({ ok: true });
});

// ---------- conversations ----------
app.get('/api/conversations', (req, res) =>
  res.json(db.prepare('SELECT id,title,model,updated FROM conversations ORDER BY updated DESC LIMIT 500').all())
);
app.get('/api/conversations/:id', (req, res) => {
  const c = db.prepare('SELECT id,title,model FROM conversations WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.messages = db.prepare('SELECT id,role,content,model,thinking FROM messages WHERE conv_id=? ORDER BY id').all(c.id);
  const atts = db.prepare('SELECT id,msg_id,mime FROM attachments WHERE msg_id IN (SELECT id FROM messages WHERE conv_id=?)').all(c.id);
  for (const m of c.messages) m.images = atts.filter((a) => a.msg_id === m.id).map((a) => a.id);
  res.json(c);
});
app.patch('/api/conversations/:id', (req, res) => {
  const t = String(req.body?.title || '').trim().slice(0, 120);
  if (!t) return res.status(400).json({ error: 'Title required' });
  db.prepare('UPDATE conversations SET title=? WHERE id=?').run(t, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM conversations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT mime,data FROM attachments WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).end();
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(Buffer.from(a.data, 'base64'));
});

// ---------- memories ----------
app.get('/api/memories', (req, res) => res.json(db.prepare('SELECT id,text FROM memories ORDER BY id DESC').all()));
app.post('/api/memories', (req, res) => {
  const t = String(req.body?.text || '').trim().slice(0, 500);
  if (!t) return res.status(400).json({ error: 'Text required' });
  addMemory(t);
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
function addMemory(text) {
  text = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text) return false;
  const exists = db.prepare('SELECT 1 FROM memories WHERE lower(text)=lower(?)').get(text);
  if (exists) return false;
  db.prepare('INSERT INTO memories(text,created) VALUES(?,?)').run(text, Date.now());
  return true;
}

// ---------- skills ----------
app.get('/api/skills', (req, res) =>
  res.json(db.prepare('SELECT id,slug,name,description,instructions,enabled,builtin FROM skills ORDER BY builtin DESC, id').all())
);
app.post('/api/skills', (req, res) => {
  const { name, description = '', instructions = '' } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name required' });
  const r = db
    .prepare('INSERT INTO skills(name,description,instructions,enabled,builtin) VALUES(?,?,?,1,0)')
    .run(String(name).trim().slice(0, 80), String(description).slice(0, 300), String(instructions).slice(0, 20000));
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/skills/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare('UPDATE skills SET name=?,description=?,instructions=?,enabled=? WHERE id=?').run(
    typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : s.name,
    typeof b.description === 'string' ? b.description.slice(0, 300) : s.description,
    typeof b.instructions === 'string' ? b.instructions.slice(0, 20000) : s.instructions,
    typeof b.enabled === 'boolean' ? (b.enabled ? 1 : 0) : s.enabled,
    s.id
  );
  res.json({ ok: true });
});
app.delete('/api/skills/:id', (req, res) => {
  db.prepare('DELETE FROM skills WHERE id=? AND builtin=0').run(req.params.id);
  res.json({ ok: true });
});

// ---------- chat ----------
function buildSystem(style) {
  const parts = [
    `You are a helpful, thoughtful AI assistant in a self-hosted chat app. Today is ${new Date().toUTCString().slice(0, 16)}. Format answers with Markdown when it helps.`,
  ];
  if (STYLES[style]) parts.push(STYLES[style]);
  const custom = getSetting('system_prompt', '').trim();
  if (custom) parts.push(`## User's custom instructions\n${custom}`);

  const skills = db.prepare('SELECT slug,name,instructions FROM skills WHERE enabled=1 ORDER BY builtin DESC,id').all();
  for (const s of skills) if (s.instructions.trim()) parts.push(`## Skill: ${s.name}\n${s.instructions.trim()}`);

  if (skills.some((s) => s.slug === 'memory')) {
    const mems = db.prepare('SELECT text FROM memories ORDER BY id').all();
    if (mems.length) parts.push(`## Saved memories\n${mems.map((m) => `- ${m.text}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

function buildMessages(convId) {
  const rows = db.prepare('SELECT id,role,content FROM messages WHERE conv_id=? ORDER BY id').all(convId);
  const out = [];
  for (const r of rows) {
    const images = db.prepare('SELECT mime,data FROM attachments WHERE msg_id=?').all(r.id);
    if (!r.content.trim() && !images.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === r.role) {
      last.content += '\n\n' + r.content;
      last.images = [...(last.images || []), ...images];
    } else out.push({ role: r.role, content: r.content, images });
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
  flush() {
    const r = this.inside ? '' : this.buf;
    this.buf = '';
    return r;
  }
}

app.post('/api/chat', async (req, res) => {
  const { conversationId, message, regenerate, editMessageId } = req.body || {};
  const modelId = String(req.body?.model || getSetting('default_model', DEFAULT_MODEL));
  const opts = parseOpts(req.body?.options);
  const style = String(req.body?.style || 'normal');
  const images = (Array.isArray(req.body?.images) ? req.body.images : [])
    .filter((im) => im && ALLOWED_IMG.has(im.mime) && typeof im.data === 'string' && im.data.length < 20e6)
    .slice(0, 5);
  const now = Date.now();

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
    if (!text && !images.length) return res.status(400).json({ error: 'Empty message' });
    if (!conv) {
      const title = (text || 'Image').replace(/\s+/g, ' ').slice(0, 60);
      const r = db.prepare('INSERT INTO conversations(title,model,created,updated) VALUES(?,?,?,?)').run(title, modelId, now, now);
      conv = { id: r.lastInsertRowid, title, model: modelId };
    } else if (editMessageId) {
      // edit: drop that user message and everything after it
      db.prepare('DELETE FROM messages WHERE conv_id=? AND id>=?').run(conv.id, editMessageId);
    }
    const mid = db.prepare('INSERT INTO messages(conv_id,role,content,created) VALUES(?,?,?,?)').run(conv.id, 'user', text, now).lastInsertRowid;
    for (const im of images) db.prepare('INSERT INTO attachments(msg_id,mime,data) VALUES(?,?,?)').run(mid, im.mime, im.data);
  }
  db.prepare('UPDATE conversations SET updated=?, model=? WHERE id=?').run(now, modelId, conv.id);

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
  const memoryOn = !!db.prepare("SELECT 1 FROM skills WHERE slug='memory' AND enabled=1").get();
  let failed = null;

  try {
    const stream = streamModel({ modelId, system: buildSystem(style), messages: buildMessages(conv.id), opts, signal: ac.signal });
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

// ---------- static ----------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`AuraChat running on http://0.0.0.0:${PORT}`));
