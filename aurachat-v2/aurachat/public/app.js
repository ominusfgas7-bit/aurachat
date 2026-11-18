/* AuraChat front-end. Single file, no build step. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- icons
const S1 = (p, extra = '') => `<svg class="ic" viewBox="0 0 24 24" ${extra}>${p}</svg>`;
const ICONS = {
  logo: '<svg viewBox="0 0 24 24" fill="currentColor" style="width:100%;height:100%"><path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/></svg>',
  search: S1('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  chat: S1('<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>'),
  sparkle: S1('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 16v4M17 18h4"/>'),
  code: S1('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'),
  panel: S1('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  chev: S1('<path d="M6 9l6 6 6-6"/>'),
  updown: S1('<path d="M8 9l4-4 4 4M16 15l-4 4-4-4"/>'),
  key: S1('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>'),
  note: S1('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  moon: S1('<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>'),
  sun: S1('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  logout: S1('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>'),
  plus: S1('<path d="M12 5v14M5 12h14"/>'),
  clip: S1('<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2L9.9 17.5a1.8 1.8 0 01-2.6-2.6l7.8-7.8"/>'),
  globe: S1('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>'),
  clock: S1('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  send: S1('<path d="M12 19V5M5 12l7-7 7 7"/>', 'style="stroke-width:2.3"'),
  download: S1('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
  close: S1('<path d="M6 6l12 12M18 6L6 18"/>'),
  star: S1('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  starfill: S1('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/>'),
  pencil: S1('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: S1('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: S1('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'),
  retry: S1('<path d="M3 12a9 9 0 109-9 9 9 0 00-6.7 3L3 8M3 3v5h5"/>'),
  file: S1('<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>'),
};
function paintIcons(root = document) {
  $$('[data-i]', root).forEach((el) => { if (!el.dataset.done) { el.innerHTML = ICONS[el.dataset.i] || ''; el.dataset.done = '1'; } });
}
const ico = (n, cls = 'w-4 h-4') => `<span class="inline-flex ${cls}">${ICONS[n] || ''}</span>`;

// ---------------------------------------------------------------- state
const st = {
  appName: 'AuraChat', convs: [], cur: null, messages: [], models: [], model: null, keys: {}, config: { providers: {} },
  skills: [], activeSkillId: 0, streaming: false, abort: null, pending: [], search: '',
  opts: { effort: '', webSearch: false, connectors: true, style: 'normal', temperature: 1, maxTokens: 8192 },
  artifacts: [], curArtifact: -1, artTab: 'preview', curStarred: false,
};
try { Object.assign(st.opts, JSON.parse(localStorage.getItem('aura_opts') || '{}')); } catch {}
const saveOpts = () => { try { localStorage.setItem('aura_opts', JSON.stringify(st.opts)); } catch {} updateThinkingPill(); };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('Not logged in'); }
  if (!r.ok) {
    let m; try { m = (await r.json()).error; } catch {}
    throw new Error(m || r.statusText);
  }
  return r.json();
}
function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'px-4 py-2.5 rounded-xl bg-claude-textLight text-claude-bgLight dark:bg-claude-textDark dark:text-claude-bgDark text-xs font-medium shadow-lg transition-all duration-200 max-w-[90vw]';
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 200); }, ms);
}
const clip = async (t) => { try { await navigator.clipboard.writeText(t); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); } };

// ---------------------------------------------------------------- theme / layout
function applyTheme(t) {
  document.documentElement.className = t;
  try { localStorage.setItem('aura_theme', t); } catch {}
  $('#theme-menu-label').textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  const m = $('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#1A1918' : '#FAF9F5';
  const ic = $('#theme-menu-label').parentElement.querySelector('[data-i]'); if (ic) ic.innerHTML = ICONS[t === 'dark' ? 'sun' : 'moon'];
}
function toggleTheme() { applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'); }
function toggleSidebar(force) {
  const sb = $('#sidebar'), bd = $('#mobile-sidebar-backdrop');
  if (matchMedia('(max-width: 767px)').matches) {
    const open = force === undefined ? sb.classList.contains('-translate-x-full') : force;
    sb.classList.toggle('-translate-x-full', !open); bd.classList.toggle('hidden', !open);
  } else {
    const collapsed = force === undefined ? !document.body.classList.contains('sb-collapsed') : !force;
    document.body.classList.toggle('sb-collapsed', collapsed);
  }
}
function toggleProfilePopover() { closePops(); $('#profile-popover-menu').classList.toggle('hidden'); }
function closeProfilePopover() { $('#profile-popover-menu').classList.add('hidden'); }
function togglePop(id) {
  const el = document.getElementById(id), was = el.classList.contains('hidden');
  closePops(); if (was) el.classList.remove('hidden');
}
function closePops() { $$('.pop, #profile-popover-menu').forEach((p) => p.classList.add('hidden')); }
document.addEventListener('click', (e) => {
  $$('.pop, #profile-popover-menu').forEach((p) => { if (!p.classList.contains('hidden') && !p.parentElement.contains(e.target)) p.classList.add('hidden'); });
});
function openModal(id) { closePops(); document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
$$('.modal-backdrop').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.add('hidden'); }));
function openDialog(title, html) { $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; paintIcons($('#dialog-body')); openModal('dialog-modal'); return $('#dialog-body'); }

// ---------------------------------------------------------------- login
function showLogin() { $('#login').classList.remove('hidden'); setTimeout(() => $('#pw').focus(), 50); }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { password: $('#pw').value } });
    $('#pw').value = ''; $('#login').classList.add('hidden'); await boot();
  } catch (err) { $('#loginErr').textContent = err.message; }
};
async function logout() { await api('/logout', { method: 'POST' }).catch(() => {}); location.reload(); }

// ---------------------------------------------------------------- markdown / code / artifacts
function hideOpenFence(t) {
  const m = [...t.matchAll(/^```/gm)]; if (m.length % 2 === 0) return t;
  return t.slice(0, m.at(-1).index) + '\n\n*Writing code…*';
}
function renderMd(text) {
  if (!window.marked) return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
  const html = marked.parse(text, { gfm: true, breaks: false });
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}
function isArtifact(lang, text) {
  const t = text.trim();
  if (lang === 'svg') return /^<svg[\s>]/i.test(t) || /^<\?xml/i.test(t);
  if (lang === 'html') return /<!doctype html|<html[\s>]/i.test(t) || (t.split('\n').length >= 6 && /<(script|style|body|div|canvas)/i.test(t));
  return false;
}
function artifactTitle(lang, code) {
  const m = code.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || code.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  return t.slice(0, 60) || (lang === 'svg' ? 'SVG image' : 'HTML page');
}
const EXT = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', java: 'java', yaml: 'yml', yml: 'yml', json: 'json', html: 'html', css: 'css', bash: 'sh', sh: 'sh', shell: 'sh', xml: 'xml', markdown: 'md', md: 'md', sql: 'sql', kotlin: 'kt', go: 'go', rust: 'rs', c: 'c', cpp: 'cpp', php: 'php', lua: 'lua', properties: 'properties', toml: 'toml', ini: 'ini', bat: 'bat', powershell: 'ps1', gradle: 'gradle', svg: 'svg', txt: 'txt' };
const FILE_MARK = /^\s*(?:\/\/|#|--|;|\/\*|<!--)\s*(?:file(?:name)?|path)\s*[:=]\s*([^\s*]+?)\s*(?:\*\/|-->)?\s*(?:\r?\n|$)/i;
function crc32(buf) {
  if (!crc32.t) { crc32.t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc32.t[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crc32.t[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) { // stored (no compression) zip, no dependencies
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name); off += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
function saveBlob(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
function uniqueNames(files) { const seen = {}; return files.map((f) => { let n = f.name.replace(/^\/+/, '').replace(/\.\.\//g, ''); if (seen[n]) { const i = n.lastIndexOf('.'); n = i > 0 ? `${n.slice(0, i)}-${seen[n]}${n.slice(i)}` : `${n}-${seen[n]}`; } seen[n] = (seen[n] || 0) + 1; return { name: n, text: f.text }; }); }
function enhance(el, finalize) {
  const files = [];
  $$('pre', el).forEach((pre) => {
    if (pre.closest('.codewrap, .filecard, .artifact-card')) return;
    const code = pre.querySelector('code');
    const info = ((code?.className || '').match(/language-(\S+)/) || [])[1] || '';
    let [lang, infoName] = info.split(':'); lang = (lang || '').toLowerCase();
    let text = code ? code.textContent : pre.textContent;
    let name = infoName || '';
    const mk = text.match(FILE_MARK);
    if (mk) { name = mk[1]; text = text.slice(mk[0].length); }
    text = text.replace(/\n$/, '');
    const nlines = text ? text.split('\n').length : 0;
    if (finalize && (lang === 'html' || lang === 'svg') && isArtifact(lang, text)) {
      const idx = st.artifacts.push({ lang, code: text, title: name || artifactTitle(lang, text) }) - 1;
      files.push({ name: name || `${artifactTitle(lang, text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page'}.${lang}`, text });
      const card = document.createElement('div'); card.className = 'artifact-card'; card.dataset.aid = idx;
      card.innerHTML = `<span class="w-9 h-9 rounded-xl bg-claude-accent/15 text-claude-accent flex items-center justify-center font-mono text-xs shrink-0">&lt;/&gt;</span>
        <span class="min-w-0 flex-1"><span class="block text-sm font-semibold truncate">${esc(st.artifacts[idx].title)}</span><span class="block text-[11px] text-claude-mutedLight dark:text-claude-mutedDark uppercase font-mono">${lang} · click to open</span></span>
        <button type="button" data-dl class="px-2.5 py-1 rounded-lg text-xs border border-claude-borderLight dark:border-claude-borderDark hover:bg-black/5 dark:hover:bg-white/5">Download</button>`;
      card.style.cursor = 'pointer'; card.onclick = (e) => { if (e.target.closest('[data-dl]')) saveBlob(new Blob([text], { type: 'text/html' }), files.at(-1)?.name || `page.${lang}`); else openArtifact(idx); };
      const fn = files.at(-1).name; card.querySelector('[data-dl]').onclick = (e) => { e.stopPropagation(); saveBlob(new Blob([text], { type: 'text/plain' }), fn); };
      pre.replaceWith(card); return;
    }
    const isFile = !!name || nlines >= 12;
    if (!isFile) { // short snippet stays inline
      if (window.hljs && code && finalize) { try { hljs.highlightElement(code); } catch {} }
      const wrap = document.createElement('div'); wrap.className = 'codewrap';
      wrap.innerHTML = `<div class="codehead"><span>${esc(lang || 'code')}</span><button type="button">Copy</button></div>`;
      pre.replaceWith(wrap); wrap.appendChild(pre);
      $('button', wrap).onclick = async (e) => { await clip(text); e.target.textContent = 'Copied'; setTimeout(() => (e.target.textContent = 'Copy'), 1500); };
      return;
    }
    const fname = name || `code.${EXT[lang] || lang || 'txt'}`;
    files.push({ name: fname, text });
    const card = document.createElement('div'); card.className = 'filecard';
    card.innerHTML = `<div class="filehead"><span class="fileicon">${ico('file', 'w-4 h-4')}</span><span class="min-w-0 flex-1"><span class="block text-sm font-semibold truncate">${esc(fname)}</span><span class="block text-[11px] text-claude-mutedLight dark:text-claude-mutedDark">${esc((lang || 'text').toUpperCase())} · ${nlines} ${nlines === 1 ? 'line' : 'lines'}</span></span>
      <button type="button" data-a="view">View</button><button type="button" data-a="copy">Copy</button><button type="button" data-a="dl" class="primary">Download</button></div><div class="filebody hidden"></div>`;
    card.onclick = async (e) => {
      const k = e.target.closest('button')?.dataset.a; if (!k) return;
      if (k === 'dl') saveBlob(new Blob([text], { type: 'text/plain' }), fname.split('/').pop());
      else if (k === 'copy') { await clip(text); toast('Copied'); }
      else if (k === 'view') {
        const body = $('.filebody', card), btn = e.target.closest('button');
        if (!body.firstChild) { const p = document.createElement('pre'), c = document.createElement('code'); if (lang) c.className = 'language-' + lang; c.textContent = text; p.appendChild(c); body.appendChild(p); if (window.hljs) { try { hljs.highlightElement(c); } catch {} } }
        body.classList.toggle('hidden'); btn.textContent = body.classList.contains('hidden') ? 'View' : 'Hide';
      }
    };
    pre.replaceWith(card);
  });
  if (finalize && files.filter((f) => f.name.includes('.')).length >= 2) {
    const list = uniqueNames(files), z = document.createElement('div'); z.className = 'filecard zipcard';
    z.innerHTML = `<div class="filehead"><span class="fileicon">${ico('file', 'w-4 h-4')}</span><span class="min-w-0 flex-1"><span class="block text-sm font-semibold truncate">Project files (.zip)</span><span class="block text-[11px] text-claude-mutedLight dark:text-claude-mutedDark truncate">${list.length} files · ${esc(list.map((f) => f.name.split('/').pop()).slice(0, 4).join(', '))}${list.length > 4 ? '…' : ''}</span></span><button type="button" class="primary">Download all</button></div>`;
    $('button', z).onclick = () => saveBlob(makeZip(list), 'project.zip');
    el.appendChild(z);
  }
  updateArtifactBadge();
}
function updateArtifactBadge() {
  const b = $('#sidebar-artifact-badge'); b.textContent = st.artifacts.length; b.classList.toggle('hidden', !st.artifacts.length);
  const pk = $('#artifact-picker');
  pk.classList.toggle('hidden', st.artifacts.length < 2);
  pk.innerHTML = st.artifacts.map((a, i) => `<option value="${i}" ${i === st.curArtifact ? 'selected' : ''}>${i + 1}. ${esc(a.title)}</option>`).join('');
}
$('#artifact-picker').onchange = (e) => openArtifact(+e.target.value);
function toggleArtifactsPanel(force) {
  const p = $('#artifacts-panel'), show = force === undefined ? p.classList.contains('hidden') : force;
  p.classList.toggle('hidden', !show);
  if (show && st.curArtifact < 0 && st.artifacts.length) openArtifact(st.artifacts.length - 1);
  else if (show) openArtifact(st.curArtifact);
}
function openArtifact(i) {
  const a = st.artifacts[i];
  $('#artifacts-panel').classList.remove('hidden');
  const empty = $('#artifact-empty');
  if (!a) { empty.classList.remove('hidden'); $('#artifact-preview-frame').classList.add('hidden'); $('#artifact-code-view').classList.add('hidden'); return; }
  st.curArtifact = i; empty.classList.add('hidden');
  $('#artifact-title').textContent = a.title; $('#artifact-lang-badge').textContent = a.lang;
  $('#artifact-code-content').textContent = a.code;
  const doc = a.lang === 'svg' ? `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${a.code}</body>` : a.code;
  $('#artifact-preview-frame').srcdoc = doc;
  switchArtifactTab(st.artTab); updateArtifactBadge();
}
function switchArtifactTab(t) {
  st.artTab = t;
  const has = st.curArtifact >= 0 && st.artifacts[st.curArtifact];
  $('#artifact-preview-frame').classList.toggle('hidden', !(has && t === 'preview'));
  $('#artifact-code-view').classList.toggle('hidden', !(has && t === 'code'));
  const on = 'bg-claude-surfaceLight dark:bg-claude-cardDark shadow-sm', off = 'text-claude-mutedLight dark:text-claude-mutedDark';
  $('#artifact-tab-preview').className = 'px-2.5 py-1 rounded-md font-medium transition ' + (t === 'preview' ? on : off);
  $('#artifact-tab-code').className = 'px-2.5 py-1 rounded-md font-medium transition ' + (t === 'code' ? on : off);
}
function copyArtifactCode() { const a = st.artifacts[st.curArtifact]; if (a) { clip(a.code); toast('Code copied'); } }
function downloadArtifact() {
  const a = st.artifacts[st.curArtifact]; if (!a) return;
  const name = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artifact';
  const url = URL.createObjectURL(new Blob([a.code], { type: a.lang === 'svg' ? 'image/svg+xml' : 'text/html' }));
  const l = document.createElement('a'); l.href = url; l.download = `${name}.${a.lang}`; l.click(); URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- chat list
function groupName(ts) {
  const age = Date.now() - ts, day = 86400000;
  return age < day ? 'Today' : age < day * 7 ? 'Previous 7 days' : 'Older';
}
function renderChatList() {
  const list = $('#chat-history-list'); list.innerHTML = '';
  const groups = new Map();
  const add = (g, c) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); };
  if (st.search) st.convs.forEach((c) => add('Results', c));
  else st.convs.forEach((c) => add(c.starred ? 'Starred' : groupName(c.updated), c));
  const order = ['Results', 'Starred', 'Today', 'Previous 7 days', 'Older'];
  if (!st.convs.length) list.innerHTML = `<div class="px-3 py-4 text-xs text-claude-mutedLight dark:text-claude-mutedDark">${st.search ? 'No chats found.' : 'No chats yet. Start one!'}</div>`;
  for (const g of order) {
    if (!groups.has(g)) continue;
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-claude-mutedLight dark:text-claude-mutedDark">${g}</div>`;
    for (const c of groups.get(g)) {
      const active = c.id === st.cur;
      const row = document.createElement('div');
      row.className = `group flex items-center gap-1 px-2.5 py-1.5 rounded-xl cursor-pointer text-[13px] transition ${active ? 'bg-black/[0.06] dark:bg-white/[0.08] font-medium' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'}`;
      row.innerHTML = `<span class="truncate flex-1">${esc(c.title)}</span>
        <span class="${active ? 'flex' : 'hidden group-hover:flex'} items-center gap-0.5 text-claude-mutedLight dark:text-claude-mutedDark shrink-0">
          <button data-a="star" title="${c.starred ? 'Unstar' : 'Star'}" class="p-1 rounded hover:text-claude-accent ${c.starred ? 'text-claude-accent' : ''}">${ico(c.starred ? 'starfill' : 'star', 'w-3.5 h-3.5')}</button>
          <button data-a="ren" title="Rename" class="p-1 rounded hover:text-claude-textLight dark:hover:text-claude-textDark">${ico('pencil', 'w-3.5 h-3.5')}</button>
          <button data-a="del" title="Delete" class="p-1 rounded hover:text-red-500">${ico('trash', 'w-3.5 h-3.5')}</button></span>`;
      row.onclick = (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (a === 'star') return starChat(c);
        if (a === 'ren') return renameChat(c);
        if (a === 'del') return deleteChat(c);
        openChat(c.id); if (matchMedia('(max-width: 767px)').matches) toggleSidebar(false);
      };
      sec.appendChild(row);
    }
    list.appendChild(sec);
  }
}
async function loadConvs() { st.convs = await api('/conversations' + (st.search ? '?q=' + encodeURIComponent(st.search) : '')); renderChatList(); }
let searchTimer;
$('#chat-search-input').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { st.search = e.target.value.trim(); loadConvs(); }, 220); });
function focusChatSearch() { if (matchMedia('(max-width: 767px)').matches) toggleSidebar(true); $('#chat-search-input').focus(); }
async function starChat(c) { await api('/conversations/' + c.id, { method: 'PATCH', body: { starred: !c.starred } }); if (c.id === st.cur) st.curStarred = !c.starred; loadConvs(); }
function renameChat(c) {
  const b = openDialog('Rename chat', `<input id="rn-in" type="text" maxlength="120" class="w-full px-3.5 py-2 rounded-xl text-sm bg-claude-bgLight dark:bg-claude-bgDark border border-claude-borderLight dark:border-claude-borderDark outline-none focus:border-claude-accent"><div class="flex justify-end gap-2"><button onclick="closeModal('dialog-modal')" class="px-3 py-1.5 rounded-xl text-xs hover:bg-black/5 dark:hover:bg-white/5">Cancel</button><button id="rn-ok" class="px-4 py-1.5 rounded-xl bg-claude-accent text-white text-xs font-semibold">Save</button></div>`);
  const inp = $('#rn-in', b); inp.value = c.title; inp.focus(); inp.select();
  const go = async () => { const t = inp.value.trim(); if (!t) return; await api('/conversations/' + c.id, { method: 'PATCH', body: { title: t } }); closeModal('dialog-modal'); if (c.id === st.cur) setHeaderTitle(t); loadConvs(); };
  $('#rn-ok', b).onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
function renameActiveChat() { const c = st.convs.find((x) => x.id === st.cur); if (c) renameChat(c); }
async function deleteChat(c) {
  if (!confirm(`Delete "${c.title}"?`)) return;
  await api('/conversations/' + c.id, { method: 'DELETE' });
  if (st.cur === c.id) createNewChat();
  loadConvs();
}
function setHeaderTitle(t) {
  const b = $('#header-chat-title-btn'); b.classList.toggle('hidden', !t); b.classList.toggle('flex', !!t); $('#header-chat-title').textContent = t || 'New chat';
}

// ---------------------------------------------------------------- views
function moveComposer(toWelcome) {
  const card = $('#claude-composer-card');
  (toWelcome ? $('#welcome-composer-slot') : $('#bottom-composer-slot')).appendChild(card);
  $('#bottom-composer-dock').classList.toggle('hidden', toWelcome);
}
function showWelcome(on) {
  $('#welcome-screen').classList.toggle('hidden', !on);
  $('#messages-container').classList.toggle('hidden', on);
  moveComposer(on);
  if (on) {
    const h = new Date().getHours(), n = st.config.displayName ? `, ${st.config.displayName}` : '';
    $('#welcome-greeting').textContent = (h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + n;
  }
}
function createNewChat() {
  if (st.streaming) return;
  st.cur = null; st.messages = []; st.artifacts = []; st.curArtifact = -1;
  st.activeSkillId = st.config.defaultSkillId || 0;
  $('#messages-container').innerHTML = ''; setHeaderTitle('');
  showWelcome(true); updateSkillPill(); updateArtifactBadge(); openArtifact(-1); $('#artifacts-panel').classList.add('hidden');
  renderChatList(); $('#prompt-input').focus();
  if (matchMedia('(max-width: 767px)').matches) toggleSidebar(false);
}
async function openChat(id) {
  if (st.streaming) return;
  const c = await api('/conversations/' + id);
  st.cur = c.id; st.messages = c.messages; st.curStarred = !!c.starred;
  st.activeSkillId = c.skill_id || 0;
  if (c.model && st.models.some((m) => m.id === c.model)) { st.model = c.model; updateModelLabel(); }
  setHeaderTitle(c.title); showWelcome(false); renderMessages(); updateSkillPill(); renderChatList();
  $('#artifacts-panel').classList.add('hidden');
}

// ---------------------------------------------------------------- messages
function thinkHtml(text, open) {
  return `<details class="mb-3 text-sm text-claude-mutedLight dark:text-claude-mutedDark border-l-2 border-claude-borderLight dark:border-claude-borderDark pl-3" ${open ? 'open' : ''}><summary class="cursor-pointer select-none">${open ? 'Thinking…' : 'Thought process'}</summary><div class="tt whitespace-pre-wrap mt-1.5 max-h-80 overflow-y-auto leading-relaxed">${esc(text)}</div></details>`;
}
function userEl(m, idx) {
  const d = document.createElement('div'); d.className = 'group flex flex-col items-end gap-1.5';
  const imgs = (m.images || []).map((x) => (typeof x === 'number' ? `/api/attachments/${x}` : x.url));
  const files = m.files || [];
  d.innerHTML = `${imgs.length ? `<div class="flex flex-wrap gap-1.5 justify-end">${imgs.map((u) => `<img src="${esc(u)}" class="max-w-[220px] max-h-[220px] rounded-xl border border-claude-borderLight dark:border-claude-borderDark" alt="">`).join('')}</div>` : ''}
    ${files.length ? `<div class="flex flex-wrap gap-1.5 justify-end">${files.map((f) => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-claude-cardLight dark:bg-claude-bubbleDark border border-claude-borderLight dark:border-claude-borderDark">${ico('file', 'w-3.5 h-3.5')}${esc(f)}</span>`).join('')}</div>` : ''}
    ${m.content ? '<div class="bubble max-w-[88%] rounded-2xl px-4 py-2.5 bg-claude-cardLight dark:bg-claude-bubbleDark text-[15px] leading-relaxed whitespace-pre-wrap break-words"></div>' : ''}
    <div class="acts opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition flex gap-0.5 text-claude-mutedLight dark:text-claude-mutedDark"></div>`;
  if (m.content) $('.bubble', d).textContent = m.content;
  const a = $('.acts', d);
  a.innerHTML = `<button data-a="copy" title="Copy" class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">${ico('copy', 'w-3.5 h-3.5')}</button><button data-a="edit" title="Edit" class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">${ico('pencil', 'w-3.5 h-3.5')}</button>`;
  a.onclick = (e) => { const k = e.target.closest('button')?.dataset.a; if (k === 'copy') { clip(m.content); toast('Copied'); } if (k === 'edit') editMessage(idx); };
  if (matchMedia('(pointer: coarse)').matches) a.classList.remove('opacity-0');
  return d;
}
function assistantEl(m, idx, final) {
  const d = document.createElement('div'); d.className = 'group';
  d.innerHTML = `<div class="think-slot">${m.thinking ? thinkHtml(m.thinking, false) : ''}</div><div class="status hidden text-xs text-claude-mutedLight dark:text-claude-mutedDark mb-2"></div><div class="markdown-body"></div><div class="acts flex gap-0.5 mt-2 text-claude-mutedLight dark:text-claude-mutedDark"></div>`;
  const md = $('.markdown-body', d); md.innerHTML = renderMd(m.content || ''); if (m.content) enhance(md, final);
  if (m.content) setAssistantActions(d, idx);
  return d;
}
function setAssistantActions(d, idx) {
  const m = st.messages[idx]; if (!m) return;
  const last = idx === st.messages.length - 1;
  const a = $('.acts', d);
  a.innerHTML = `<button data-a="copy" title="Copy" class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">${ico('copy', 'w-3.5 h-3.5')}</button>${last ? `<button data-a="retry" title="Retry" class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">${ico('retry', 'w-3.5 h-3.5')}</button>` : ''}
    <span class="ml-1 self-center text-[11px] opacity-70 truncate max-w-[220px]">${esc((m.model || '').replace(/^\w+:/, ''))}</span>`;
  a.onclick = (e) => { const k = e.target.closest('button')?.dataset.a; if (k === 'copy') { clip(m.content); toast('Copied'); } if (k === 'retry' && !st.streaming) runChat({ regenerate: true }); };
}
function renderMessages() {
  const box = $('#messages-container'); box.innerHTML = '';
  st.artifacts = []; st.curArtifact = -1;
  st.messages.forEach((m, i) => box.appendChild(m.role === 'user' ? userEl(m, i) : assistantEl(m, i, true)));
  updateArtifactBadge(); scrollDown(true);
}
function scrollDown(force) {
  const s = $('#messages-scroll-area');
  if (force || s.scrollHeight - s.scrollTop - s.clientHeight < 180) s.scrollTop = s.scrollHeight;
}
function editMessage(idx) {
  const m = st.messages[idx]; if (!m?.id) return toast('One sec, then try again');
  const b = openDialog('Edit message', `<textarea id="ed-in" rows="8" class="w-full px-3.5 py-2 rounded-xl text-sm bg-claude-bgLight dark:bg-claude-bgDark border border-claude-borderLight dark:border-claude-borderDark outline-none focus:border-claude-accent"></textarea><div class="text-xs text-claude-mutedLight dark:text-claude-mutedDark">This replaces the message and re-runs everything after it.</div><div class="flex justify-end gap-2"><button onclick="closeModal('dialog-modal')" class="px-3 py-1.5 rounded-xl text-xs hover:bg-black/5 dark:hover:bg-white/5">Cancel</button><button id="ed-ok" class="px-4 py-1.5 rounded-xl bg-claude-accent text-white text-xs font-semibold">Save &amp; resend</button></div>`);
  $('#ed-in', b).value = m.content;
  $('#ed-ok', b).onclick = () => { const t = $('#ed-in', b).value; if (!t.trim() && !(m.images || []).length) return; closeModal('dialog-modal'); st.messages = st.messages.slice(0, idx); runChat({ text: t, editId: m.id, keepAttachments: true, images: m.images, files: m.files }); };
}

// ---------------------------------------------------------------- sending
function sendMessage() {
  if (st.streaming) return;
  const t = $('#prompt-input').value;
  if (!t.trim() && !st.pending.length) return;
  $('#prompt-input').value = ''; autoResize($('#prompt-input'));
  const imgs = st.pending.filter((p) => p.kind === 'image'), files = st.pending.filter((p) => p.kind === 'text');
  st.pending = []; renderAttachments();
  runChat({ text: t, images: imgs, files });
}
function stopGeneration() { st.abort?.abort(); }
function setSending(on) {
  st.streaming = on;
  $('#send-btn').classList.toggle('hidden', on); $('#stop-btn').classList.toggle('hidden', !on); $('#stop-btn').classList.toggle('flex', on);
}
async function runChat({ text = '', regenerate = false, editId = null, images = [], files = [], keepAttachments = false }) {
  if (st.streaming) return;
  if (!st.model) return toast('No model selected. Add an API key in Settings.');
  const wasNew = !st.cur;
  if (!regenerate) {
    const userMsg = { role: 'user', content: text.trim() };
    if (keepAttachments) { userMsg.images = images; userMsg.files = files; }
    else { userMsg.images = images.map((i) => ({ url: `data:${i.mime};base64,${i.data}` })); userMsg.files = files.map((f) => f.name); }
    st.messages.push(userMsg);
  } else if (st.messages.at(-1)?.role === 'assistant') st.messages.pop();

  showWelcome(false);
  const box = $('#messages-container'); box.innerHTML = '';
  const priorArtifacts = st.artifacts.length;
  st.artifacts = []; st.curArtifact = -1;
  st.messages.forEach((m, i) => box.appendChild(m.role === 'user' ? userEl(m, i) : assistantEl(m, i, true)));
  const d = assistantEl({ role: 'assistant', content: '' }, -1, false);
  box.appendChild(d);
  const md = $('.markdown-body', d), slot = $('.think-slot', d), statusEl = $('.status', d);
  md.classList.add('streaming-cursor'); scrollDown(true); void priorArtifacts;

  setSending(true);
  const ac = (st.abort = new AbortController());
  let acc = '', thinking = '', err = null, raf = 0;
  const paint = () => {
    raf = 0; md.innerHTML = renderMd(hideOpenFence(acc)); enhance(md, false);
    if (thinking) {
      if (!slot.firstChild) slot.innerHTML = thinkHtml('', !acc);
      const det = slot.firstChild; $('.tt', det).textContent = thinking;
      if (acc && det.open && !det._closed) { det.open = false; det._closed = true; $('summary', det).textContent = 'Thought process'; }
    }
    scrollDown();
  };
  const o = st.opts;
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', credentials: 'same-origin', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: st.cur, message: text, model: st.model, regenerate, editMessageId: editId, style: o.style, skillId: st.activeSkillId,
        images: keepAttachments ? [] : images.map((i) => ({ mime: i.mime, data: i.data })), files: keepAttachments ? [] : files.map((f) => ({ name: f.name, text: f.text })),
        options: { effort: o.effort || undefined, webSearch: o.webSearch, connectors: o.connectors !== false, temperature: Number(o.temperature), maxTokens: Number(o.maxTokens) },
      }),
    });
    if (r.status === 401) { showLogin(); throw new Error('Not logged in'); }
    if (!r.ok) { let m; try { m = (await r.json()).error; } catch {} throw new Error(m || r.statusText); }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === 'meta') { if (!st.cur) { st.cur = ev.conversationId; setHeaderTitle(ev.title); } }
        else if (ev.type === 'delta') { statusEl.classList.add('hidden'); acc += ev.text; if (!raf) raf = requestAnimationFrame(paint); }
        else if (ev.type === 'thinking') { thinking += ev.text; if (!raf) raf = requestAnimationFrame(paint); }
        else if (ev.type === 'status') { statusEl.textContent = '🔎 ' + ev.text; statusEl.classList.remove('hidden'); }
        else if (ev.type === 'error') err = ev.error;
      }
    }
  } catch (e) { if (e.name !== 'AbortError') err = e.message; }

  if (raf) cancelAnimationFrame(raf);
  md.classList.remove('streaming-cursor'); statusEl.classList.add('hidden');
  if (acc.trim()) st.messages.push({ role: 'assistant', content: acc.trim(), thinking, model: st.model });
  setSending(false); st.abort = null;
  if (st.cur) { try { const c = await api('/conversations/' + st.cur); c.messages.forEach((sm, i) => { if (st.messages[i]) { st.messages[i].id = sm.id; if (sm.images) st.messages[i].images = sm.images; if (sm.files) st.messages[i].files = sm.files; } }); } catch {} }
  renderMessages();
  if (err) {
    const e = document.createElement('div'); e.className = 'mt-3 p-3 rounded-xl text-sm border border-red-300/60 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/60';
    e.innerHTML = `<div class="font-semibold mb-0.5">Something went wrong</div><div class="break-words"></div><div class="mt-2 flex gap-3 text-xs"><button class="underline" data-r="1">Retry</button>${/key|auth|401|403|invalid|No .* set/i.test(err) ? '<button class="underline" onclick="openSettingsModal(\'providers\')">Open API settings</button>' : ''}</div>`;
    $('[data-r]', e).onclick = () => runChat({ regenerate: true });
    $('div:nth-child(2)', e).textContent = err; box.appendChild(e);
  }
  if (st.artifacts.length && acc.trim()) openArtifact(st.artifacts.length - 1);
  scrollDown(true); loadConvs(); void wasNew;
}

// ---------------------------------------------------------------- attachments
const TEXT_EXT = /\.(txt|md|js|ts|tsx|jsx|py|json|html|css|sql|csv|yaml|yml|sh|log|xml|java|c|cpp|go|rs|php|env|conf|ini|toml)$/i;
function renderAttachments() {
  const bar = $('#attachments-preview-bar');
  bar.classList.toggle('hidden', !st.pending.length); bar.classList.toggle('flex', !!st.pending.length);
  bar.innerHTML = st.pending.map((p, i) => `<div class="relative">${p.kind === 'image'
    ? `<img src="data:${p.mime};base64,${p.data}" class="w-16 h-16 object-cover rounded-xl border border-claude-borderLight dark:border-claude-borderDark" alt="">`
    : `<div class="h-16 px-3 rounded-xl border border-claude-borderLight dark:border-claude-borderDark flex items-center gap-2 text-xs max-w-[180px]">${ico('file', 'w-4 h-4 shrink-0')}<span class="truncate">${esc(p.name)}</span></div>`}
    <button data-i="${i}" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-claude-textLight dark:bg-claude-textDark text-claude-bgLight dark:text-claude-bgDark text-[11px] leading-5">✕</button></div>`).join('');
  $$('button', bar).forEach((b) => (b.onclick = () => { st.pending.splice(+b.dataset.i, 1); renderAttachments(); }));
}
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file), max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (sc === 1 && file.size < 1.5e6) return null;
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85);
}
const readAs = (f, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](f); });
async function addFiles(files) {
  for (const f of files) {
    if (st.pending.length >= 8) { toast('Max 8 attachments'); break; }
    if (f.type.startsWith('image/')) {
      if (st.pending.filter((p) => p.kind === 'image').length >= 5) { toast('Max 5 images'); continue; }
      let url = null; try { url = await shrinkImage(f); } catch {}
      if (!url) url = await readAs(f, 'readAsDataURL');
      const m = url.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
      if (m && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(m[1])) st.pending.push({ kind: 'image', mime: m[1], data: m[2] }); else toast('Unsupported image type');
    } else if (f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json') {
      if (f.size > 400000) { toast(`${f.name} is too large (max 400 KB)`); continue; }
      st.pending.push({ kind: 'text', name: f.name, text: await readAs(f, 'readAsText') });
    } else toast(`${f.name}: only images and text/code files are supported`);
  }
  renderAttachments();
}
$('#file-upload-input').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; closePops(); };
$('#prompt-input').addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });
function autoResize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; }
$('#prompt-input').addEventListener('input', (e) => autoResize(e.target));
$('#prompt-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); sendMessage(); }
});
const STARTERS = [
  ['Write', 'pencil', 'Help me write a compelling, clear announcement for a new product launch.'],
  ['Learn', 'note', 'Explain how distributed consensus algorithms like Raft work from first principles, with clear mental models.'],
  ['Code', 'code', 'Build a sleek Pomodoro & focus timer web app in a single self-contained HTML file so I can preview it live in Artifacts.'],
  ['Life stuff', 'chat', 'Help me design a realistic weekly routine that balances deep work, fitness and rest without burnout.'],
  ['Surprise me', 'sparkle', 'Show me an insightful mental model or an interactive SVG visualization that changes how I think about complex systems.'],
];
$('#starter-pills').innerHTML = STARTERS.map(([l, i, p], n) => `<button data-n="${n}" class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-claude-sidebarLight/90 dark:bg-claude-cardDark border border-claude-borderLight dark:border-claude-borderDark hover:border-claude-accent/60 text-claude-mutedLight dark:text-claude-mutedDark hover:text-claude-textLight dark:hover:text-claude-textDark transition">${ico(i, 'w-3.5 h-3.5 text-claude-accent')}<span>${l}</span></button>`).join('');
$$('#starter-pills button').forEach((b) => (b.onclick = () => { const t = $('#prompt-input'); t.value = STARTERS[b.dataset.n][2]; autoResize(t); t.focus(); }));

// ---------------------------------------------------------------- (+) menu, thinking, style
const STYLE_LIST = ['normal', 'concise', 'explanatory', 'formal', 'casual'];
function renderStyleOptions() {
  $('#style-options').innerHTML = STYLE_LIST.map((s) => `<button data-s="${s}" class="px-2 py-1.5 rounded-lg text-[11px] font-medium capitalize transition ${st.opts.style === s ? 'bg-claude-accent text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}">${s}</button>`).join('');
  $$('#style-options button').forEach((b) => (b.onclick = () => { st.opts.style = b.dataset.s; saveOpts(); renderStyleOptions(); }));
}
$('#opt-websearch').onchange = (e) => { st.opts.webSearch = e.target.checked; saveOpts(); };
$('#opt-connectors').onchange = (e) => { st.opts.connectors = e.target.checked; saveOpts(); };
$('#opt-temp').oninput = (e) => { st.opts.temperature = Number(e.target.value); $('#opt-temp-label').textContent = Number(e.target.value).toFixed(1); saveOpts(); };
const EFFORTS = [['', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max']];
function renderEffort() {
  $('#effort-seg').innerHTML = EFFORTS.map(([v, l]) => `<button data-v="${v}" class="flex-1 py-1.5 text-xs font-medium border-r last:border-r-0 border-claude-borderLight dark:border-claude-borderDark transition ${st.opts.effort === v ? 'bg-claude-accent text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}">${l}</button>`).join('');
  $$('#effort-seg button').forEach((b) => (b.onclick = () => { st.opts.effort = b.dataset.v; saveOpts(); renderEffort(); }));
}
function updateThinkingPill() {
  const on = !!st.opts.effort, btn = $('#thinking-toggle-btn');
  $('#thinking-status-text').textContent = on ? EFFORTS.find((e) => e[0] === st.opts.effort)[1] : 'Off';
  btn.classList.toggle('text-claude-accent', on); btn.classList.toggle('border-claude-accent/60', on);
  $('#opt-websearch').checked = !!st.opts.webSearch; $('#opt-connectors').checked = st.opts.connectors !== false; $('#opt-temp').value = st.opts.temperature; $('#opt-temp-label').textContent = Number(st.opts.temperature).toFixed(1);
}

// ---------------------------------------------------------------- models
function providerOf(id) { return (id || '').split(':')[0]; }
function modelMeta(id) { return st.models.find((m) => m.id === id) || { id, name: (id || '').replace(/^\w+:/, ''), provider: providerOf(id), desc: '' }; }
function updateModelLabel() { $('#selected-model-label').textContent = st.model ? modelMeta(st.model).name : 'No model'; renderModelList(); updateApiStatus(); }
function toggleModelDropdown() { togglePop('model-dropdown-menu'); renderModelList(); setTimeout(() => $('#model-search').focus(), 30); }
function renderModelList() {
  const q = $('#model-search').value.trim().toLowerCase();
  const list = st.models.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 250);
  if (!st.models.length) { $('#model-options-list').innerHTML = '<div class="px-3 py-3 text-xs text-claude-mutedLight dark:text-claude-mutedDark">No models yet. Add an API key in <button class="underline" onclick="closePops();openSettingsModal(\'providers\')">Settings</button>.</div>'; return; }
  let last = '', html = '';
  for (const m of list) {
    if (m.provider !== last) { last = m.provider; html += `<div class="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-claude-mutedLight dark:text-claude-mutedDark">${esc(m.provider)}</div>`; }
    const sel = st.model === m.id;
    html += `<button data-id="${esc(m.id)}" class="w-full text-left px-3 py-2 rounded-xl flex items-start justify-between gap-2 transition ${sel ? 'bg-claude-accent/10 text-claude-accent' : 'hover:bg-black/5 dark:hover:bg-white/5'}"><div class="min-w-0"><div class="text-xs font-semibold truncate">${esc(m.name)}</div>${m.desc ? `<div class="text-[11px] text-claude-mutedLight dark:text-claude-mutedDark mt-0.5 truncate">${esc(m.desc)}</div>` : ''}</div>${sel ? '<span class="font-bold text-sm shrink-0">✓</span>' : ''}</button>`;
  }
  $('#model-options-list').innerHTML = html || '<div class="px-3 py-3 text-xs text-claude-mutedLight dark:text-claude-mutedDark">No matches</div>';
  $$('#model-options-list button[data-id]').forEach((b) => (b.onclick = () => selectModel(b.dataset.id)));
}
$('#model-search').addEventListener('input', renderModelList);
function selectModel(id) { st.model = id; try { localStorage.setItem('aura_model', id); } catch {} updateModelLabel(); closePops(); }
function applyCustomModel() {
  let v = $('#custom-model-input').value.trim(); if (!v) return;
  if (!/^(anthropic|openrouter|custom):/.test(v)) v = 'custom:' + v;
  selectModel(v); $('#custom-model-input').value = '';
}
$('#custom-model-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomModel(); });
async function refreshModels() {
  const b = $('#dropdown-fetch-models-btn'); b.textContent = 'Fetching…';
  try { await loadModels(true); toast(`Loaded ${st.models.length} models`); } catch (e) { toast('Failed: ' + e.message); }
  b.textContent = '↻ Refresh';
}
async function loadModels(force) {
  const m = await api('/models' + (force ? '?refresh=1' : ''));
  st.models = m.models; st.keys = m.keys; st.defaultModel = m.defaultModel;
  let saved = null; try { saved = localStorage.getItem('aura_model'); } catch {}
  if (!st.model || (force && !st.models.some((x) => x.id === st.model))) st.model = saved && st.models.some((x) => x.id === saved) ? saved : m.defaultModel;
  const sel = st.models.some((x) => x.id === st.model);
  if (!sel && st.models.length) st.model = st.models[0].id;
  updateModelLabel();
}
function updateApiStatus() {
  const p = providerOf(st.model), ok = (p === 'anthropic' && st.keys.anthropic) || (p === 'openrouter' && st.keys.openrouter) || (p === 'custom' && st.keys.custom);
  const anyKey = st.keys.anthropic || st.keys.openrouter || st.keys.custom;
  const label = !anyKey ? 'Add API key' : ok ? ({ anthropic: 'Anthropic ready', openrouter: 'OpenRouter ready', custom: 'Gateway ready' }[p]) : 'Key missing for this model';
  const color = ok ? 'bg-emerald-500' : 'bg-amber-500';
  $('#api-status-dot').className = `w-1.5 h-1.5 rounded-full shrink-0 ${color}`; $('#api-status-label').textContent = label;
  $('#header-api-dot').className = `w-1.5 h-1.5 rounded-full ${color}`; $('#header-api-text').textContent = label;
  $('#popover-api-status').className = `text-[11px] flex items-center gap-1.5 mt-0.5 ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`;
  $('#popover-api-status').innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${color}"></span><span>${label}</span>`;
}

// ---------------------------------------------------------------- skills pill
const activeSkill = () => st.skills.find((s) => s.id === st.activeSkillId);
function updateSkillPill() {
  const s = activeSkill();
  $('#composer-skill-icon').textContent = s ? s.icon : '✦'; $('#composer-skill-name').textContent = s ? s.name : 'Default';
  $('#active-system-summary').textContent = `${st.config.memoryEnabled ? 'Memo' : 'No memo'} · ${s ? s.name : 'Default'}`;
  const opts = [{ id: 0, name: 'Default', icon: '✦', description: 'No extra skill', isDefault: !st.config.defaultSkillId }, ...st.skills];
  $('#composer-skill-options').innerHTML = opts.map((k) => `<div data-id="${k.id}" class="flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition ${k.id === st.activeSkillId ? 'bg-claude-accent/10' : 'hover:bg-black/5 dark:hover:bg-white/5'}">
    <span class="w-6 text-center">${esc(k.icon)}</span><div class="min-w-0 flex-1"><div class="text-xs font-semibold truncate ${k.id === st.activeSkillId ? 'text-claude-accent' : ''}">${esc(k.name)}</div><div class="text-[11px] text-claude-mutedLight dark:text-claude-mutedDark truncate">${esc(k.description || '')}</div></div>
    <button data-star="${k.id}" title="Set as default" class="p-1 rounded ${k.isDefault ? 'text-claude-accent' : 'text-claude-mutedLight dark:text-claude-mutedDark hover:text-claude-accent'}">${ico(k.isDefault ? 'starfill' : 'star', 'w-3.5 h-3.5')}</button></div>`).join('');
  $$('#composer-skill-options > div').forEach((row) => (row.onclick = async (e) => {
    const star = e.target.closest('button[data-star]');
    if (star) { await setDefaultSkill(+star.dataset.star); return; }
    st.activeSkillId = +row.dataset.id; updateSkillPill(); closePops();
  }));
  $('#sidebar-memo-badge').textContent = st.memoCount ?? 0; $('#popover-memo-count').textContent = st.memoCount ?? 0;
}
async function setDefaultSkill(id) {
  await api('/config', { method: 'PUT', body: { defaultSkillId: id } });
  st.config.defaultSkillId = id; st.skills.forEach((s) => (s.isDefault = s.id === id)); updateSkillPill();
  if ($('#skills-modal') && !$('#skills-modal').classList.contains('hidden')) renderSkillsManager();
  toast(id ? 'Default skill set' : 'Default cleared');
}
async function loadSkills() { st.skills = await api('/skills'); updateSkillPill(); }

// ---------------------------------------------------------------- memo & skills modal
function openSkillsModal(tab) { openModal('skills-modal'); switchSkillsTab(tab || 'memo'); }
function switchSkillsTab(t) {
  const on = 'border-claude-accent text-claude-accent', off = 'border-transparent text-claude-mutedLight dark:text-claude-mutedDark hover:text-claude-textLight dark:hover:text-claude-textDark';
  $('#tab-btn-memo').className = `pb-2 text-sm font-semibold border-b-2 transition ${t === 'memo' ? on : off}`;
  $('#tab-btn-skills').className = `pb-2 text-sm font-semibold border-b-2 transition ${t === 'skills' ? on : off}`;
  $('#tab-panel-memo').classList.toggle('hidden', t !== 'memo'); $('#tab-panel-skills').classList.toggle('hidden', t !== 'skills');
  if (t === 'memo') renderMemos(); else renderSkillsManager();
}
async function renderMemos() {
  $('#memory-toggle').checked = !!st.config.memoryEnabled;
  const mems = await api('/memories'); st.memoCount = mems.length; updateSkillPill();
  $('#memo-items-list').innerHTML = (mems.map((m) => `<div class="flex items-start justify-between gap-3 p-3 rounded-xl bg-claude-bgLight dark:bg-claude-bgDark border border-claude-borderLight dark:border-claude-borderDark text-sm"><span class="break-words min-w-0">${esc(m.text)}</span><button data-id="${m.id}" class="text-xs text-claude-mutedLight dark:text-claude-mutedDark hover:text-red-500 shrink-0">Delete</button></div>`).join('')
    || '<div class="text-xs text-claude-mutedLight dark:text-claude-mutedDark">Nothing saved yet.</div>')
    + (mems.length ? '<button id="clear-memos" class="text-xs text-red-500 hover:underline mt-1">Delete all memories</button>' : '');
  $$('#memo-items-list button[data-id]').forEach((b) => (b.onclick = async () => { await api('/memories/' + b.dataset.id, { method: 'DELETE' }); renderMemos(); }));
  const c = $('#clear-memos'); if (c) c.onclick = async () => { if (confirm('Delete ALL memories?')) { await api('/memories', { method: 'DELETE' }); renderMemos(); } };
}
$('#memory-toggle').onchange = async (e) => { await api('/config', { method: 'PUT', body: { memoryEnabled: e.target.checked } }); st.config.memoryEnabled = e.target.checked; updateSkillPill(); toast(e.target.checked ? 'Memory on' : 'Memory off'); };
async function addMemoItem() {
  const i = $('#new-memo-input'), v = i.value.trim(); if (!v) return;
  try { await api('/memories', { method: 'POST', body: { text: v } }); i.value = ''; renderMemos(); } catch (e) { toast(e.message); }
}
$('#new-memo-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemoItem(); });
function renderSkillsManager() {
  $('#skills-manager-list').innerHTML = st.skills.map((s) => `<div class="p-3.5 rounded-2xl border ${s.id === st.activeSkillId ? 'border-claude-accent bg-claude-accent/5' : 'border-claude-borderLight dark:border-claude-borderDark bg-claude-bgLight dark:bg-claude-bgDark'}">
    <div class="flex items-start gap-3"><span class="text-xl w-7 text-center">${esc(s.icon)}</span><div class="min-w-0 flex-1"><div class="text-sm font-semibold">${esc(s.name)} ${s.builtin ? '<span class="text-[10px] font-normal text-claude-mutedLight dark:text-claude-mutedDark">· built-in</span>' : ''}</div><div class="text-xs text-claude-mutedLight dark:text-claude-mutedDark mt-0.5">${esc(s.description)}</div></div>
    <button data-star="${s.id}" title="Default for new chats" class="p-1 ${s.isDefault ? 'text-claude-accent' : 'text-claude-mutedLight dark:text-claude-mutedDark hover:text-claude-accent'}">${ico(s.isDefault ? 'starfill' : 'star', 'w-4 h-4')}</button></div>
    <div class="flex gap-2 mt-2.5 ml-10"><button data-use="${s.id}" class="px-3 py-1 rounded-lg text-xs font-semibold ${s.id === st.activeSkillId ? 'bg-claude-accent text-white' : 'bg-claude-accent/15 text-claude-accent hover:bg-claude-accent/25'} transition">${s.id === st.activeSkillId ? 'Active' : 'Use'}</button><button data-edit="${s.id}" class="px-3 py-1 rounded-lg text-xs border border-claude-borderLight dark:border-claude-borderDark hover:border-claude-accent transition">Edit</button>${s.builtin ? '' : `<button data-del="${s.id}" class="px-3 py-1 rounded-lg text-xs text-red-500 hover:bg-red-500/10 transition">Delete</button>`}</div></div>`).join('');
  $$('#skills-manager-list [data-star]').forEach((b) => (b.onclick = () => setDefaultSkill(st.skills.find((s) => s.id === +b.dataset.star)?.isDefault ? 0 : +b.dataset.star)));
  $$('#skills-manager-list [data-use]').forEach((b) => (b.onclick = () => { st.activeSkillId = +b.dataset.use; updateSkillPill(); renderSkillsManager(); toast('Skill active for this chat'); }));
  $$('#skills-manager-list [data-edit]').forEach((b) => (b.onclick = () => editSkill(+b.dataset.edit)));
  $$('#skills-manager-list [data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Delete this skill?')) return; await api('/skills/' + b.dataset.del, { method: 'DELETE' }); if (st.activeSkillId === +b.dataset.del) st.activeSkillId = 0; await loadSkills(); renderSkillsManager(); }));
}
function resetSkillForm() { $('#edit-skill-id').value = ''; $('#skill-name-input').value = ''; $('#skill-icon-input').value = ''; $('#skill-desc-input').value = ''; $('#skill-prompt-input').value = ''; $('#skill-form-title').textContent = 'Create skill'; $('#skill-form').classList.remove('hidden'); $('#skill-name-input').focus(); }
function hideSkillForm() { $('#skill-form').classList.add('hidden'); }
function editSkill(id) { const s = st.skills.find((x) => x.id === id); if (!s) return; resetSkillForm(); $('#edit-skill-id').value = id; $('#skill-name-input').value = s.name; $('#skill-icon-input').value = s.icon; $('#skill-desc-input').value = s.description; $('#skill-prompt-input').value = s.instructions; $('#skill-form-title').textContent = 'Edit skill'; $('#skill-form').scrollIntoView({ behavior: 'smooth' }); }
async function saveSkillForm() {
  const id = $('#edit-skill-id').value, body = { name: $('#skill-name-input').value, icon: $('#skill-icon-input').value || '✦', description: $('#skill-desc-input').value, instructions: $('#skill-prompt-input').value };
  if (!body.name.trim()) return toast('Give it a name');
  try { if (id) await api('/skills/' + id, { method: 'PUT', body }); else await api('/skills', { method: 'POST', body }); hideSkillForm(); await loadSkills(); renderSkillsManager(); toast('Skill saved'); } catch (e) { toast(e.message); }
}
function importSkillDialog() {
  const b = openDialog('Import SKILL.md', `<p class="text-xs text-claude-mutedLight dark:text-claude-mutedDark">Paste a SKILL.md: frontmatter with name and description, then the instructions.</p><textarea id="im-in" rows="12" placeholder="---\nname: my-skill\ndescription: When to use it\n---\nInstructions…" class="w-full px-3.5 py-2 rounded-xl text-sm font-mono bg-claude-bgLight dark:bg-claude-bgDark border border-claude-borderLight dark:border-claude-borderDark outline-none focus:border-claude-accent"></textarea><div class="flex justify-end gap-2"><button onclick="closeModal('dialog-modal')" class="px-3 py-1.5 rounded-xl text-xs hover:bg-black/5 dark:hover:bg-white/5">Cancel</button><button id="im-ok" class="px-4 py-1.5 rounded-xl bg-claude-accent text-white text-xs font-semibold">Import</button></div>`);
  $('#im-ok', b).onclick = async () => {
    const t = $('#im-in', b).value.replace(/\r/g, ''), m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/), fm = m ? m[1] : '', ins = (m ? m[2] : t).trim();
    const get = (k) => ((fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'mi')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
    if (!ins) return toast('No instructions found');
    try { await api('/skills', { method: 'POST', body: { name: get('name') || 'Imported skill', description: get('description'), instructions: ins } }); closeModal('dialog-modal'); await loadSkills(); renderSkillsManager(); toast('Imported'); } catch (e) { toast(e.message); }
  };
}

// ---------------------------------------------------------------- settings
function openSettingsModal(tab) { fillSettings(); openModal('settings-modal'); switchSettingsTab(tab || 'providers'); }
function switchSettingsTab(t) {
  const on = 'border-claude-accent text-claude-accent', off = 'border-transparent text-claude-mutedLight dark:text-claude-mutedDark hover:text-claude-textLight dark:hover:text-claude-textDark';
  for (const k of ['providers', 'general', 'connectors']) { $('#stab-btn-' + k).className = `pb-2.5 text-sm font-semibold border-b-2 transition ${t === k ? on : off}`; $('#stab-' + k).classList.toggle('hidden', t !== k); }
  if (t === 'connectors' && !st.conns) loadConnectors();
}
// ---- connectors (MCP) ----
const GH_PRESET = { name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', filter: 'file,repositor,branch,commit,search_code,push,pull_request,get_me', enabled: true, readOnly: false };
async function loadConnectors() { try { st.conns = (await api('/connectors')).connectors; } catch { st.conns = []; } renderConnectors(); }
function addConnector(kind) { st.conns = st.conns || []; syncConnectorInputs(); st.conns.push(kind === 'github' ? { ...GH_PRESET } : { name: 'My MCP server', url: '', filter: '', enabled: true, readOnly: false }); renderConnectors(); }
function syncConnectorInputs() {
  $$('#conn-list [data-ci]').forEach((row) => { const c = st.conns[+row.dataset.ci]; if (!c) return;
    c.name = $('[data-f=name]', row).value; c.url = $('[data-f=url]', row).value; c.filter = $('[data-f=filter]', row).value;
    c.token = $('[data-f=token]', row).value; c.enabled = $('[data-f=enabled]', row).checked; c.readOnly = $('[data-f=readOnly]', row).checked; });
}
function renderConnectors() {
  const inp = 'w-full px-3 py-1.5 rounded-lg text-xs bg-claude-bgLight dark:bg-claude-bgDark border border-claude-borderLight dark:border-claude-borderDark outline-none focus:border-claude-accent';
  const list = $('#conn-list');
  if (!st.conns?.length) { list.innerHTML = '<div class="text-xs text-claude-mutedLight dark:text-claude-mutedDark py-6 text-center border border-dashed border-claude-borderLight dark:border-claude-borderDark rounded-xl">No connectors yet. Add GitHub to let the model read and write your repos.</div>'; return; }
  list.innerHTML = st.conns.map((c, i) => `<div data-ci="${i}" class="p-3 rounded-xl border border-claude-borderLight dark:border-claude-borderDark space-y-2">
    <div class="flex items-center gap-2"><input data-f="name" class="${inp} font-semibold" value="${esc(c.name || '')}" placeholder="Name"><label class="flex items-center gap-1.5 text-xs shrink-0"><input type="checkbox" data-f="enabled" ${c.enabled !== false ? 'checked' : ''}>On</label></div>
    <input data-f="url" class="${inp} font-mono" value="${esc(c.url || '')}" placeholder="MCP server URL (https://…)">
    <input data-f="token" type="password" class="${inp} font-mono" placeholder="${c.hasToken ? `Saved (${esc(c.hint || '')}). Type to replace` : 'Access token (ghp_… / github_pat_…)'}" autocomplete="off">
    <input data-f="filter" class="${inp}" value="${esc(c.filter || '')}" placeholder="Only tools whose name contains… (comma list, empty = all)">
    <div class="flex items-center gap-3 text-xs"><label class="flex items-center gap-1.5"><input type="checkbox" data-f="readOnly" ${c.readOnly ? 'checked' : ''}>Read-only (no writes)</label>
      <button type="button" data-a="test" class="ml-auto px-2.5 py-1 rounded-lg border border-claude-borderLight dark:border-claude-borderDark hover:bg-black/5 dark:hover:bg-white/5">Test</button>
      <button type="button" data-a="del" class="px-2.5 py-1 rounded-lg text-red-600 hover:bg-red-500/10">Remove</button></div>
    <div data-f="result" class="text-[11px] text-claude-mutedLight dark:text-claude-mutedDark hidden"></div></div>`).join('');
  $$('#conn-list [data-ci]').forEach((row) => {
    const i = +row.dataset.ci;
    $('[data-a=del]', row).onclick = () => { syncConnectorInputs(); st.conns.splice(i, 1); renderConnectors(); };
    $('[data-a=test]', row).onclick = async () => {
      syncConnectorInputs(); const c = st.conns[i], out = $('[data-f=result]', row); out.classList.remove('hidden'); out.textContent = 'Testing…';
      try { const r = await api('/connectors/test', { method: 'POST', body: { id: c.id, name: c.name, url: c.url, token: c.token, filter: c.filter, readOnly: c.readOnly } });
        out.textContent = r.ok ? `✓ Connected. ${r.enabled} of ${r.total} tools enabled: ${r.names.slice(0, 12).join(', ')}${r.names.length > 12 ? '…' : ''}` : '✗ ' + r.error; } catch (e) { out.textContent = '✗ ' + e.message; }
    };
  });
}
async function saveConnectors(silent) {
  if (!st.conns) return; syncConnectorInputs();
  try { const r = await api('/connectors', { method: 'PUT', body: { connectors: st.conns } }); st.conns = r.connectors; renderConnectors(); if (!silent) toast('Connectors saved'); } catch (e) { toast(e.message); }
}
function fillSettings() {
  const p = st.config.providers || {};
  const stateOf = (x) => (x?.set ? `<span class="text-emerald-600 dark:text-emerald-400">● saved ${esc(x.hint)}</span>` : '<span class="text-claude-mutedLight dark:text-claude-mutedDark">○ not set</span>');
  $('#prov-custom-state').innerHTML = stateOf(p.custom); $('#prov-anthropic-state').innerHTML = stateOf(p.anthropic); $('#prov-openrouter-state').innerHTML = stateOf(p.openrouter);
  $('#set-custom-base').value = p.custom?.baseUrl || ''; $('#set-custom-mode').value = p.custom?.mode || 'auto'; $('#set-custom-extra').value = p.custom?.extra || '';
  for (const [id, x] of [['set-custom-key', p.custom], ['set-anthropic-key', p.anthropic], ['set-openrouter-key', p.openrouter]]) { const el = $('#' + id); el.value = ''; el.type = 'password'; el.placeholder = x?.set ? `Saved (${x.hint}). Type to replace` : el.dataset.ph || el.placeholder; }
  $('#set-display-name').value = st.config.displayName || ''; $('#set-system-prompt').value = st.config.systemPrompt || '';
  const sel = $('#set-default-model'); let last = '', h = '<option value="">Automatic (Claude Sonnet 4.5 if available)</option>';
  for (const m of st.models) { if (m.provider !== last) { if (last) h += '</optgroup>'; h += `<optgroup label="${esc(m.provider)}">`; last = m.provider; } h += `<option value="${esc(m.id)}">${esc(m.name)}</option>`; }
  sel.innerHTML = h + (last ? '</optgroup>' : ''); sel.value = st.config.defaultModel || '';
  $('#set-max-tokens').value = st.opts.maxTokens; $('#max-tokens-label').textContent = st.opts.maxTokens;
}
$('#set-max-tokens').oninput = (e) => ($('#max-tokens-label').textContent = e.target.value);
function setBasePreset(u) { $('#set-custom-base').value = u; toast('Base URL set'); }
function toggleKeyVis(id, btn) { const i = document.getElementById(id); i.type = i.type === 'password' ? 'text' : 'password'; btn.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
async function loadConfig() { st.config = await api('/config'); applyIdentity(); }
function applyIdentity() {
  const n = st.config.displayName || 'You'; $$('.pop-name').forEach((e) => (e.textContent = n)); $('#avatar').textContent = (n[0] || '?').toUpperCase();
  st.appName = st.config.appName || 'AuraChat'; $('#brand-name').textContent = st.appName; document.title = st.appName;
}
async function saveSettings(silent) {
  const body = {
    displayName: $('#set-display-name').value, systemPrompt: $('#set-system-prompt').value, defaultModel: $('#set-default-model').value,
    customBaseUrl: $('#set-custom-base').value, customMode: $('#set-custom-mode').value, customExtra: $('#set-custom-extra').value,
    customKey: $('#set-custom-key').value, anthropicKey: $('#set-anthropic-key').value, openrouterKey: $('#set-openrouter-key').value,
  };
  st.opts.maxTokens = +$('#set-max-tokens').value; saveOpts();
  await api('/config', { method: 'PUT', body });
  if (st.conns) await saveConnectors(true);
  await loadConfig(); await loadModels(true); showWelcomeGreetingIfEmpty(); fillSettings();
  if (silent !== true) { closeModal('settings-modal'); toast('Settings saved'); }
}
function showWelcomeGreetingIfEmpty() { if (!st.cur && !st.messages.length) showWelcome(true); }
async function testProvider(p) {
  const btn = $('#test-' + p), label = btn.textContent; btn.textContent = 'Testing…'; btn.disabled = true;
  try {
    await saveSettings(true);
    const pick = st.models.find((m) => m.id === 'anthropic:claude-haiku-4-5' && p === 'anthropic') || st.models.find((m) => m.id.startsWith(p + ':') && (p !== 'openrouter' || /anthropic\/claude/.test(m.id))) || st.models.find((m) => m.id.startsWith(p + ':'));
    if (!pick) throw new Error('No models found. Check the key / base URL.');
    const r = await api('/test', { method: 'POST', body: { model: pick.id } });
    if (r.ok) toast(`✓ ${p === 'custom' ? 'Gateway' : p} works (${pick.name})`); else toast('✗ ' + r.error, 6000);
  } catch (e) { toast('✗ ' + e.message, 6000); }
  btn.textContent = label; btn.disabled = false;
}
async function clearKey(field) { await api('/config', { method: 'PUT', body: { [field]: '__clear__' } }); await loadConfig(); await loadModels(true); fillSettings(); toast('Key removed'); }

// ---------------------------------------------------------------- inspector
async function openPromptInspector() {
  openModal('inspector-modal'); $('#compiled-prompt-preview').textContent = 'Loading…';
  try { const r = await api(`/system-prompt?style=${encodeURIComponent(st.opts.style)}&skillId=${st.activeSkillId}`); $('#compiled-prompt-preview').textContent = r.prompt; } catch (e) { $('#compiled-prompt-preview').textContent = e.message; }
}

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePops(); ['skills-modal', 'settings-modal', 'inspector-modal', 'dialog-modal'].forEach(closeModal); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettingsModal('providers'); }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); createNewChat(); }
});

// ---------------------------------------------------------------- boot
async function boot() {
  await loadConfig();
  await Promise.all([loadModels(), loadSkills(), loadConvs(), api('/memories').then((m) => (st.memoCount = m.length))]);
  st.activeSkillId = st.config.defaultSkillId || 0;
  renderStyleOptions(); renderEffort(); updateThinkingPill(); updateSkillPill(); updateApiStatus();
  const noKeys = !st.keys.anthropic && !st.keys.openrouter && !st.keys.custom;
  createNewChat();
  if (noKeys) { toast('Add an API key to start (Settings → API & Providers)', 5000); setTimeout(() => openSettingsModal('providers'), 400); }
}
paintIcons(); applyTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
$('#set-custom-key').dataset.ph = 'Gateway API key'; $('#set-anthropic-key').dataset.ph = 'sk-ant-…'; $('#set-openrouter-key').dataset.ph = 'sk-or-…';
document.addEventListener('DOMContentLoaded', () => {});
(async () => { try { await api('/me'); await boot(); } catch { /* login screen is shown by api() */ } })();
