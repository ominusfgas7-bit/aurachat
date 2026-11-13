// Streaming adapters for Anthropic and OpenRouter.
// Each generator yields { t: 'text' | 'thinking' | 'status', text }.

const ANTHROPIC_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
const OPENROUTER_BASE = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '8192', 10);

const BUDGETS = { low: 2048, medium: 8000, high: 16000, max: 32000 };
const EFFORTS = ['low', 'medium', 'high', 'max'];

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
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  }
}

async function failFromResponse(resp, who) {
  let msg = `${who} error ${resp.status}`;
  try {
    const t = await resp.text();
    try {
      const j = JSON.parse(t);
      msg = j.error?.message || j.message || msg;
    } catch {
      if (t) msg += `: ${t.slice(0, 200)}`;
    }
  } catch {}
  throw new Error(msg);
}

// messages: [{role, content: string, images?: [{mime, data}]}]
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
        ...m.images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } })),
        { type: 'text', text: m.content || '(see image)' },
      ],
    };
  });
}

async function* streamAnthropic({ model, system, messages, opts, signal }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server');

  const body = { model, system, messages: anthropicMessages(messages), stream: true, max_tokens: opts.maxTokens || MAX_TOKENS };
  if (opts.effort && BUDGETS[opts.effort]) {
    const budget = BUDGETS[opts.effort];
    body.thinking = { type: 'enabled', budget_tokens: budget };
    body.max_tokens = Math.max(body.max_tokens, 0) + budget; // thinking budget counts against max_tokens
  } else if (typeof opts.temperature === 'number') {
    body.temperature = opts.temperature;
  }
  if (opts.webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

  const resp = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) await failFromResponse(resp, 'Anthropic');

  let lastWasSearch = false;
  for await (const data of sseData(resp)) {
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block || {};
      if (cb.type === 'server_tool_use' && cb.name === 'web_search') yield { t: 'status', text: 'Searching the web…' };
      else if (cb.type === 'text' && lastWasSearch) yield { t: 'text', text: '' };
      lastWasSearch = cb.type === 'web_search_tool_result';
    } else if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') yield { t: 'text', text: d.text };
      else if (d.type === 'thinking_delta') yield { t: 'thinking', text: d.thinking };
    } else if (ev.type === 'error') {
      throw new Error(ev.error?.message || 'Anthropic stream error');
    }
  }
}

async function* streamOpenRouter({ model, system, messages, opts, signal }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set on the server');

  const body = {
    model,
    stream: true,
    max_tokens: opts.maxTokens || MAX_TOKENS,
    messages: [{ role: 'system', content: system }, ...openaiMessages(messages)],
  };
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
  if (opts.effort) body.reasoning = { effort: opts.effort === 'max' ? 'high' : opts.effort };
  if (opts.webSearch) body.plugins = [{ id: 'web' }];

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'X-Title': 'AuraChat' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) await failFromResponse(resp, 'OpenRouter');

  for await (const data of sseData(resp)) {
    if (data === '[DONE]') break;
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.error) throw new Error(ev.error.message || 'OpenRouter stream error');
    const d = ev.choices?.[0]?.delta;
    if (!d) continue;
    const r = d.reasoning || d.reasoning_content;
    if (r) yield { t: 'thinking', text: r };
    if (d.content) yield { t: 'text', text: d.content };
  }
}

function streamModel({ modelId, system, messages, opts = {}, signal }) {
  const i = modelId.indexOf(':');
  const provider = i === -1 ? 'anthropic' : modelId.slice(0, i);
  const model = i === -1 ? modelId : modelId.slice(i + 1);
  if (provider === 'anthropic') return streamAnthropic({ model, system, messages, opts, signal });
  if (provider === 'openrouter') return streamOpenRouter({ model, system, messages, opts, signal });
  throw new Error(`Unknown provider "${provider}"`);
}

// ---- model lists (cached) ----
let cache = { at: 0, models: [] };
const FALLBACK_ANTHROPIC = [
  ['claude-sonnet-4-5', 'Claude Sonnet 4.5'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5'],
  ['claude-opus-4-5', 'Claude Opus 4.5'],
  ['claude-opus-4-1', 'Claude Opus 4.1'],
  ['claude-sonnet-4-0', 'Claude Sonnet 4'],
];

async function listModels() {
  if (Date.now() - cache.at < 10 * 60 * 1000 && cache.models.length) return cache.models;
  const out = [];

  if (process.env.ANTHROPIC_API_KEY) {
    let live = [];
    try {
      const r = await fetch(`${ANTHROPIC_BASE}/v1/models?limit=100`, {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) live = (await r.json()).data || [];
    } catch {}
    const list = live.length ? live.map((m) => [m.id, m.display_name || m.id]) : FALLBACK_ANTHROPIC;
    if (!list.some(([id]) => id === 'claude-sonnet-4-5')) list.unshift(['claude-sonnet-4-5', 'Claude Sonnet 4.5']);
    for (const [id, name] of list) out.push({ id: `anthropic:${id}`, name, provider: 'Anthropic' });
  }

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const r = await fetch(`${OPENROUTER_BASE}/models`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const data = (await r.json()).data || [];
        data.sort((a, b) => a.id.localeCompare(b.id));
        for (const m of data) out.push({ id: `openrouter:${m.id}`, name: m.name || m.id, provider: 'OpenRouter' });
      }
    } catch {}
  }

  if (out.length) cache = { at: Date.now(), models: out };
  return out;
}

module.exports = { streamModel, listModels, EFFORTS };
