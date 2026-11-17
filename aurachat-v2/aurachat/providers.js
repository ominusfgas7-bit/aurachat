// Streaming adapters: Anthropic, OpenRouter, and "custom" (OmniRoute / any OpenAI- or Anthropic-compatible gateway).
// Each generator yields { t: 'text' | 'thinking' | 'status', text }.

const BUDGETS = { low: 2048, medium: 8000, high: 16000, max: 32000 };
const EFFORTS = ['low', 'medium', 'high', 'max'];
const DEFAULT_MAX = parseInt(process.env.MAX_TOKENS || '8192', 10);

// config source is injected by server.js (DB settings first, .env as fallback)
let getCfg = () => ({});
const setConfigSource = (fn) => { getCfg = fn; cache = { at: 0, key: '', models: [] }; };

// ---------- helpers ----------
async function* sseData(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
}

class NetError extends Error {}
async function doFetch(url, init, who, base) {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const code = e.cause?.code || e.code || e.message;
    throw new NetError(`Could not reach ${who} at ${base || url} (${code}). Check the Base URL and that the gateway is running. Note: "localhost" means this server, not your browser.`);
  }
}

async function failFromResponse(resp, who) {
  let msg = `${who} error ${resp.status}`;
  try {
    const t = await resp.text();
    try {
      const j = JSON.parse(t);
      msg = j.error?.message || (typeof j.error === 'string' ? j.error : '') || j.message || msg;
    } catch {
      if (t) msg += `: ${t.slice(0, 200)}`;
    }
  } catch {}
  const e = new Error(msg);
  e.status = resp.status;
  throw e;
}

function anthropicMessages(messages) {
  return messages.map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        ...m.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })),
        { type: 'text', text: m.content || '(see image)' },
      ],
    };
  });
}
function openaiMessages(messages) {
  return messages.map((m) => {
    if (!m.images?.length) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content || '(see image)' },
        ...m.images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } })),
      ],
    };
  });
}

// ---------- Anthropic Messages protocol (works for api.anthropic.com and compatible gateways) ----------
async function* anthropicProtocol({ endpoint, headers, model, system, messages, opts, signal, who, base }) {
  const body = { model, system, messages: anthropicMessages(messages), stream: true, max_tokens: opts.maxTokens || DEFAULT_MAX };
  if (opts.effort && BUDGETS[opts.effort]) {
    const budget = BUDGETS[opts.effort];
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens += budget; // thinking budget counts against max_tokens
  } else if (typeof opts.temperature === 'number') {
    body.temperature = opts.temperature;
  }
  if (opts.webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

  const resp = await doFetch(endpoint, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...headers },
    body: JSON.stringify(body),
  }, who, base);
  if (!resp.ok) await failFromResponse(resp, who);

  for await (const data of sseData(resp)) {
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block || {};
      if (cb.type === 'server_tool_use' && cb.name === 'web_search') yield { t: 'status', text: 'Searching the web…' };
    } else if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') yield { t: 'text', text: d.text };
      else if (d.type === 'thinking_delta') yield { t: 'thinking', text: d.thinking };
    } else if (ev.type === 'error') {
      throw new Error(ev.error?.message || `${who} stream error`);
    }
  }
}

// ---------- OpenAI chat/completions protocol ----------
// style: 'openrouter' (reasoning/plugins params) | 'custom' (Anthropic-style thinking param passthrough)
async function* openaiProtocol({ endpoint, headers, model, system, messages, opts, signal, who, base, style }) {
  const build = (withThinking) => {
    const body = {
      model, stream: true, max_tokens: opts.maxTokens || DEFAULT_MAX,
      messages: [{ role: 'system', content: system }, ...openaiMessages(messages)],
    };
    if (typeof opts.temperature === 'number' && !(withThinking && opts.effort)) body.temperature = opts.temperature;
    if (opts.effort && withThinking) {
      if (style === 'openrouter') body.reasoning = { effort: opts.effort === 'max' ? 'high' : opts.effort };
      else {
        const budget = Math.min(BUDGETS[opts.effort], Math.max(1024, body.max_tokens - 1024));
        body.thinking = { type: 'enabled', budget_tokens: budget };
        body.max_tokens += budget;
      }
    }
    if (opts.webSearch && style === 'openrouter') body.plugins = [{ id: 'web' }];
    return body;
  };
  const send = (withThinking) => doFetch(endpoint, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(build(withThinking)),
  }, who, base);

  let resp = await send(true);
  if (!resp.ok && resp.status === 400 && opts.effort) resp = await send(false); // model rejects thinking params
  if (!resp.ok) await failFromResponse(resp, who);

  for await (const data of sseData(resp)) {
    if (data === '[DONE]') break;
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.error) throw new Error(ev.error.message || `${who} stream error`);
    const d = ev.choices?.[0]?.delta;
    if (d) {
      const r = d.reasoning_content || d.reasoning || d.thinking;
      if (r) yield { t: 'thinking', text: r };
      if (d.content) yield { t: 'text', text: d.content };
    } else if (ev.type === 'content_block_delta') { // gateways that pass Anthropic SSE through
      if (ev.delta?.type === 'thinking_delta') yield { t: 'thinking', text: ev.delta.thinking };
      else if (ev.delta?.type === 'text_delta') yield { t: 'text', text: ev.delta.text };
    }
  }
}

// ---------- providers ----------
function streamAnthropic(a) {
  const c = getCfg();
  if (!c.anthropicKey) throw new Error('No Anthropic API key set. Add one in Settings → Providers.');
  const base = (c.anthropicBase || 'https://api.anthropic.com').replace(/\/+$/, '');
  return anthropicProtocol({ ...a, endpoint: `${base}/v1/messages`, headers: { 'x-api-key': c.anthropicKey }, who: 'Anthropic', base });
}

function streamOpenRouter(a) {
  const c = getCfg();
  if (!c.openrouterKey) throw new Error('No OpenRouter API key set. Add one in Settings → Providers.');
  const base = (c.openrouterBase || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return openaiProtocol({
    ...a, style: 'openrouter', endpoint: `${base}/chat/completions`, who: 'OpenRouter', base,
    headers: { authorization: `Bearer ${c.openrouterKey}`, 'X-Title': 'AuraChat' },
  });
}

function customEndpoint(base, suffix) {
  let clean = String(base || '').trim().replace(/\/+$/, '');
  if (/\/(chat\/completions|messages|models)$/.test(clean)) return clean; // full endpoint pasted
  if (!/\/v\d+$/.test(clean)) clean += '/v1';
  return clean + suffix;
}

async function* streamCustom(a) {
  const c = getCfg();
  if (!c.customBase) throw new Error('No custom Base URL set. Add it in Settings → Providers.');
  if (!c.customKey) throw new Error('No custom API key set. Add it in Settings → Providers.');
  const base = c.customBase.trim();
  const mode = c.customMode || 'auto';
  const isAnthropicHost = /^https?:\/\/api\.anthropic\.com/i.test(base);
  const strategies =
    mode === 'openai' ? ['openai']
    : mode === 'anthropic' ? ['anthropic-xkey']
    : mode === 'anthropic-bearer' ? ['anthropic-bearer']
    : isAnthropicHost ? ['anthropic-xkey']
    : ['openai', 'anthropic-bearer', 'anthropic-xkey'];

  let lastErr;
  for (const s of strategies) {
    let yielded = false;
    try {
      const gen = s === 'openai'
        ? openaiProtocol({ ...a, style: 'custom', endpoint: customEndpoint(base, '/chat/completions'), headers: { authorization: `Bearer ${c.customKey}` }, who: 'Gateway', base })
        : anthropicProtocol({ ...a, endpoint: customEndpoint(base, '/messages'), headers: s === 'anthropic-bearer' ? { authorization: `Bearer ${c.customKey}` } : { 'x-api-key': c.customKey }, who: 'Gateway', base });
      for await (const ev of gen) { yielded = true; yield ev; }
      return;
    } catch (e) {
      if (yielded || e.name === 'AbortError' || e instanceof NetError) throw e;
      lastErr = e; // try the next protocol
    }
  }
  throw lastErr || new Error('Could not talk to the gateway');
}

function streamModel({ modelId, system, messages, opts = {}, signal }) {
  const i = modelId.indexOf(':');
  const provider = i === -1 ? 'anthropic' : modelId.slice(0, i);
  const model = i === -1 ? modelId : modelId.slice(i + 1);
  const a = { model, system, messages, opts, signal };
  if (provider === 'anthropic') return streamAnthropic(a);
  if (provider === 'openrouter') return streamOpenRouter(a);
  if (provider === 'custom') return streamCustom(a);
  throw new Error(`Unknown provider "${provider}"`);
}

// ---------- model lists ----------
const MODEL_INFO = {
  'claude-sonnet-4-5': ['Claude Sonnet 4.5', 'Best balance of speed, intelligence & coding'],
  'claude-opus-4-5': ['Claude Opus 4.5', 'Deep reasoning and synthesis'],
  'claude-haiku-4-5': ['Claude Haiku 4.5', 'Near-instant answers for quick tasks'],
  'claude-opus-4-1': ['Claude Opus 4.1', 'Deep reasoning and synthesis'],
  'claude-sonnet-4-0': ['Claude Sonnet 4', 'Strong all-rounder'],
};
const FALLBACK_CLAUDE = ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-sonnet-4-0'];
const nice = (id, given) => {
  const base = id.replace(/-\d{8}$/, '');
  return given || MODEL_INFO[base]?.[0] || id;
};
const descOf = (id) => MODEL_INFO[id.replace(/-\d{8}$/, '')]?.[1] || '';

let cache = { at: 0, key: '', models: [] };
const clearModelCache = () => { cache = { at: 0, key: '', models: [] }; };

async function fetchJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function listModels(force = false) {
  const c = getCfg();
  const key = JSON.stringify([c.anthropicKey && 1, c.openrouterKey && 1, c.customBase, c.customKey && 1]);
  if (!force && cache.key === key && Date.now() - cache.at < 10 * 60 * 1000 && cache.models.length) return cache.models;
  const out = [];

  if (c.anthropicKey) {
    let ids = [];
    try {
      const base = (c.anthropicBase || 'https://api.anthropic.com').replace(/\/+$/, '');
      const j = await fetchJson(`${base}/v1/models?limit=100`, { 'x-api-key': c.anthropicKey, 'anthropic-version': '2023-06-01' });
      ids = (j.data || []).map((m) => [m.id, m.display_name]);
    } catch {}
    if (!ids.length) ids = FALLBACK_CLAUDE.map((id) => [id, null]);
    if (!ids.some(([id]) => id === 'claude-sonnet-4-5')) ids.unshift(['claude-sonnet-4-5', null]);
    for (const [id, name] of ids) out.push({ id: `anthropic:${id}`, name: nice(id, name), provider: 'Anthropic', desc: descOf(id) });
  }

  if (c.customBase && c.customKey) {
    let ids = [];
    try {
      const j = await fetchJson(customEndpoint(c.customBase, '/models'), {
        authorization: `Bearer ${c.customKey}`, 'x-api-key': c.customKey, 'anthropic-version': '2023-06-01',
      });
      const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
      ids = raw.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
    } catch {}
    if (!ids.length) ids = FALLBACK_CLAUDE;
    for (const id of ids) out.push({ id: `custom:${id}`, name: nice(id), provider: 'Gateway', desc: descOf(id) || 'From your gateway' });
  }

  if (c.openrouterKey) {
    try {
      const base = (c.openrouterBase || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
      const data = (await fetchJson(`${base}/models`, {})).data || [];
      data.sort((a, b) => a.id.localeCompare(b.id));
      for (const m of data) out.push({ id: `openrouter:${m.id}`, name: m.name || m.id, provider: 'OpenRouter', desc: m.id });
    } catch {}
  }

  if (out.length) cache = { at: Date.now(), key, models: out };
  return out;
}

// one tiny request to verify a provider works
async function testModel(modelId) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    let got = '';
    for await (const ev of streamModel({ modelId, system: 'Reply with one short word.', messages: [{ role: 'user', content: 'Hi' }], opts: { maxTokens: 16 }, signal: ac.signal })) {
      if (ev.t === 'text') { got += ev.text; if (got.length > 3) break; }
    }
    return { ok: true, sample: got.slice(0, 40) };
  } catch (e) {
    return { ok: false, error: ac.signal.aborted ? 'Timed out after 30s' : e.message };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

module.exports = { streamModel, listModels, testModel, setConfigSource, clearModelCache, EFFORTS };
