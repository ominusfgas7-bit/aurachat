// Built-in web_search / web_fetch tools for models behind a gateway (OmniRoute etc.) that has no native web search.
// Search: Tavily if TAVILY_API_KEY / setting `tavily_key` is set, else DuckDuckGo HTML. Fetch: server-side GET with SSRF protection.

const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MAX_CHARS = 14000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Blocked: private address');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(privateIp)) throw new Error('Blocked: private address');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", mdash: '—', ndash: '–', hellip: '…' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
  return ENT[e.toLowerCase()] ?? m;
});
function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let t = html.replace(/<(head|script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  t = decode(t).replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: decode(title).trim(), text: t };
}

async function fetchPublic(url, { accept = 'text/html,*/*', timeout = 20000 } = {}) {
  let u = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(u);
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
    let r;
    try { r = await fetch(u, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': UA, accept, 'accept-language': 'en' } }); }
    finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
    return r;
  }
  throw new Error('Too many redirects');
}

async function webFetch({ url, max_chars }) {
  if (!url) return 'Error: url is required';
  let r;
  try { r = await fetchPublic(url); } catch (e) { return `Error: ${e.message}`; }
  if (!r.ok) return `Error: ${r.status} ${r.statusText} for ${url}`;
  const ct = r.headers.get('content-type') || '';
  if (!/text|json|xml|javascript/i.test(ct)) return `Error: unsupported content type "${ct}" (only text pages)`;
  const body = (await r.text()).slice(0, 2_000_000);
  const limit = Math.min(Math.max(parseInt(max_chars, 10) || MAX_CHARS, 1000), 30000);
  let out;
  if (/html/i.test(ct)) { const { title, text } = htmlToText(body); out = `${title ? title + '\n' : ''}URL: ${url}\n\n${text}`; } else out = body;
  return out.length > limit ? out.slice(0, limit) + `\n…[truncated, ${out.length - limit} more chars]` : out;
}

function parseDdg(html, n) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/gi;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    let href = decode(m[1]);
    const g = href.match(/[?&]uddg=([^&]+)/); if (g) href = decodeURIComponent(g[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:/.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    const sn = (m[3].match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i) || [])[1] || '';
    out.push({ title: decode(m[2].replace(/<[^>]+>/g, '')).trim(), url: href, snippet: decode(sn.replace(/<[^>]+>/g, '')).trim() });
  }
  return out;
}

// ---- PaperMC downloads (https://docs.papermc.io/misc/downloads-service/) ----
const PAPER_UA = 'AuraChat/1.0 (self-hosted chat; https://github.com/ominusfgas7-bit/aurachat)';
async function paperInfo(version) {
  const base = (process.env.PAPER_API || 'https://fill.papermc.io').replace(/\/+$/, '') + '/v3/projects/paper';
  const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': PAPER_UA, accept: 'application/json' } }); if (!r.ok) throw new Error(`PaperMC API ${r.status} for ${u.replace(base, '')}`); return r.json(); };
  let v = String(version || 'latest').trim();
  if (!/^[0-9][0-9a-z.\-]*$/i.test(v) && v !== 'latest') throw new Error('Bad version');
  if (v === 'latest') { const p = await get(base); v = Object.values(p.versions || {}).flat()[0]; if (!v) throw new Error('No versions returned'); }
  let builds; try { builds = await get(`${base}/versions/${v}/builds`); } catch (e) { if (/ 404 /.test(e.message)) throw new Error(`Paper has no builds for ${v}`); throw e; }
  const list = Array.isArray(builds) ? builds : builds.builds || [];
  const b = list.find((x) => x.channel === 'STABLE') || list[0];
  const d = b?.downloads?.['server:default'];
  if (!d?.url) throw new Error(`No downloadable build for ${v}`);
  return { version: v, build: b.id, channel: b.channel, name: d.name, url: d.url, size: d.size, sha256: d.checksums?.sha256 };
}

async function webSearch({ query, max_results }, tavilyKey) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return 'Error: query is required';
  const n = Math.min(Math.max(parseInt(max_results, 10) || 6, 1), 10);
  try {
    if (tavilyKey) {
      const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tavilyKey}` }, body: JSON.stringify({ query: q, max_results: n, include_answer: true }) });
      if (!r.ok) return `Error: Tavily ${r.status}`;
      const j = await r.json();
      return (j.answer ? `Summary: ${j.answer}\n\n` : '') + (j.results || []).map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${(x.content || '').slice(0, 400)}`).join('\n\n');
    }
    const r = await fetchPublic(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    if (!r.ok) return `Error: search failed (${r.status}). Try web_fetch on a specific URL instead.`;
    const res = parseDdg(await r.text(), n);
    if (!res.length) return 'No results (the search engine may be rate-limiting this server). Try a different query or use web_fetch on a specific URL.';
    return res.map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n');
  } catch (e) { return `Error: ${e.message}`; }
}

const defs = [
  { name: 'web_search', description: 'Search the web for current information. Returns titles, URLs and snippets. Follow up with web_fetch to read a page.', schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer', description: '1-10, default 6' } }, required: ['query'] } },
  { name: 'paper_info', paper: true, description: 'Look up the newest Paper (Minecraft server) build for a Minecraft version, e.g. "1.21.11" (or "latest"). Returns the direct jar URL, build number and sha256. Use it for download links and setup scripts.', schema: { type: 'object', properties: { version: { type: 'string' } } } },
  { name: 'web_fetch', description: 'Fetch a public web page and return its text content.', schema: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'integer', description: 'default 14000' } }, required: ['url'] } },
];

// Merge with an existing toolset (e.g. MCP connectors) -> { defs, run, label, notes }
function withWebTools(base, tavilyKey, { search = true, paper = true } = {}) {
  const b = base || { defs: [], run: async () => ({ text: 'unknown tool', isError: true }), label: (n) => n, notes: [] };
  const taken = new Set(b.defs.map((d) => d.name));
  const mine = defs.filter((d) => !taken.has(d.name) && (d.paper ? paper : search));
  return {
    defs: [...mine, ...b.defs], notes: b.notes,
    label: (n) => (n === 'paper_info' ? 'Paper downloads' : n === 'web_search' ? 'Web search' : n === 'web_fetch' ? 'Web fetch' : b.label(n)),
    run: async (name, args, signal) => {
      if (name === 'web_search' && mine.some((d) => d.name === name)) return { text: await webSearch(args, tavilyKey) };
      if (name === 'paper_info' && mine.some((d) => d.name === name)) { try { return { text: JSON.stringify(await paperInfo(args.version)) }; } catch (e) { return { text: `Error: ${e.message}`, isError: true }; } }
      if (name === 'web_fetch' && mine.some((d) => d.name === name)) return { text: await webFetch(args) };
      return b.run(name, args, signal);
    },
  };
}

module.exports = { paperInfo, withWebTools, webFetch, webSearch, parseDdg, htmlToText, privateIp };
