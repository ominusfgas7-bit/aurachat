// Minimal MCP client over Streamable HTTP (works with GitHub's remote MCP server and any HTTP MCP server).
// Servers are configured in Settings → Connectors: { id, name, url, token, enabled, readOnly, filter }.

const PROTOCOL = '2025-03-26';
const sessions = new Map(); // url+token -> { sid, tools, at }
const MAX_RESULT = 24000;

const slug = (s) => String(s || 'srv').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'srv';

function headersFor(srv, sid) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
  if (srv.token) h.authorization = /^bearer /i.test(srv.token) ? srv.token : `Bearer ${srv.token}`;
  if (sid) h['mcp-session-id'] = sid;
  return h;
}

// read the JSON-RPC reply for `id` from either a JSON body or an SSE stream
async function readReply(resp, id) {
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    const t = await resp.text();
    if (!t.trim()) return null;
    const j = JSON.parse(t);
    return Array.isArray(j) ? j.find((x) => x.id === id) : j;
  }
  const reader = resp.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const m = JSON.parse(data); if (m.id === id) { reader.cancel().catch(() => {}); return m; } } catch {}
    }
  }
  return null;
}

let nextId = 1;
async function rpc(srv, st, method, params, { notify = false, signal } = {}) {
  const id = notify ? undefined : nextId++;
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60000);
  signal?.addEventListener?.('abort', () => ac.abort());
  let resp;
  try {
    resp = await fetch(srv.url, { method: 'POST', headers: headersFor(srv, st.sid), body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    throw new Error(`Could not reach ${srv.name || srv.url} (${e.cause?.code || e.message})`);
  } finally { clearTimeout(timer); }
  const sid = resp.headers.get('mcp-session-id'); if (sid) st.sid = sid;
  if (!resp.ok) {
    let t = ''; try { t = (await resp.text()).slice(0, 200); } catch {}
    const e = new Error(`${srv.name || 'MCP server'} error ${resp.status}${t ? ': ' + t : ''}`); e.status = resp.status; throw e;
  }
  if (notify) { try { await resp.text(); } catch {} return null; }
  const msg = await readReply(resp, id);
  if (!msg) throw new Error(`${srv.name || 'MCP server'} sent no reply to ${method}`);
  if (msg.error) throw new Error(msg.error.message || `${method} failed`);
  return msg.result;
}

async function open(srv) {
  const key = srv.url + '|' + (srv.token || '');
  let st = sessions.get(key);
  if (st?.ready) return st;
  st = { sid: '', ready: false, tools: null, at: 0 };
  await rpc(srv, st, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'AuraChat', version: '1.0' } });
  await rpc(srv, st, 'notifications/initialized', {}, { notify: true }).catch(() => {});
  st.ready = true; sessions.set(key, st);
  return st;
}
const reset = (srv) => sessions.delete(srv.url + '|' + (srv.token || ''));

async function withSession(srv, fn) {
  try { return await fn(await open(srv)); }
  catch (e) { if (e.status === 404 || e.status === 400) { reset(srv); return fn(await open(srv)); } throw e; }
}

function allowed(srv, t) {
  const f = String(srv.filter || '').split(/[\s,]+/).filter(Boolean).map((x) => x.toLowerCase());
  if (f.length && !f.some((x) => t.name.toLowerCase().includes(x))) return false;
  if (srv.readOnly) {
    const ro = t.annotations?.readOnlyHint;
    if (ro === true) return true;
    if (ro === false) return false;
    return /^(get|list|search|read|find|fetch)/i.test(t.name);
  }
  return true;
}

async function listTools(srv, { force = false } = {}) {
  return withSession(srv, async (st) => {
    if (!force && st.tools && Date.now() - st.at < 5 * 60 * 1000) return st.tools;
    const all = [];
    let cursor;
    for (let i = 0; i < 10; i++) {
      const r = await rpc(srv, st, 'tools/list', cursor ? { cursor } : {});
      all.push(...(r.tools || []));
      cursor = r.nextCursor; if (!cursor) break;
    }
    st.tools = all; st.at = Date.now();
    return all;
  });
}

// Build the tool set for a chat: [{ name, description, schema }] + a runner. Names are namespaced "<slug>__<tool>".
async function buildToolset(servers) {
  const defs = [], map = new Map(), notes = [];
  const used = new Set();
  for (const srv of servers.filter((s) => s.enabled !== false && s.url)) {
    let sl = slug(srv.name); while (used.has(sl)) sl += '_'; used.add(sl);
    try {
      for (const t of await listTools(srv)) {
        if (!allowed(srv, t)) continue;
        const name = `${sl}__${t.name}`.slice(0, 64);
        defs.push({ name, description: `[${srv.name}] ${t.description || t.name}`.slice(0, 900), schema: t.inputSchema || { type: 'object', properties: {} } });
        map.set(name, { srv, tool: t.name, label: `${srv.name} · ${t.name}` });
      }
    } catch (e) { notes.push(`${srv.name}: ${e.message}`); }
  }
  const run = async (name, args, signal) => {
    const h = map.get(name);
    if (!h) return { text: `Unknown tool ${name}`, isError: true };
    try {
      const r = await withSession(h.srv, (st) => rpc(h.srv, st, 'tools/call', { name: h.tool, arguments: args || {} }, { signal }));
      let text = (r.content || []).map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? (c.resource?.text || `[resource ${c.resource?.uri || ''}]`) : `[${c.type}]`)).join('\n');
      if (!text && r.structuredContent) text = JSON.stringify(r.structuredContent);
      if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + `\n…[truncated ${text.length - MAX_RESULT} chars]`;
      return { text: text || '(no output)', isError: !!r.isError };
    } catch (e) { return { text: `Tool error: ${e.message}`, isError: true }; }
  };
  const label = (name) => map.get(name)?.label || name;
  return { defs, run, label, notes };
}

async function testServer(srv) {
  reset(srv);
  const tools = await listTools(srv, { force: true });
  const shown = tools.filter((t) => allowed(srv, t));
  return { total: tools.length, enabled: shown.length, names: shown.map((t) => t.name).slice(0, 60) };
}

module.exports = { buildToolset, testServer, slug };
