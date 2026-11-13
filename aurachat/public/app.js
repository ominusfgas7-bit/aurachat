const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  convs: [], cur: null, messages: [], models: [], model: null, defaultModel: null,
  streaming: false, abort: null, settings: {},
  pending: [], // images waiting to be sent: {mime, data}
  opts: { effort: '', webSearch: false, style: 'normal', temperature: 1, maxTokens: 8192 },
};
try { Object.assign(state.opts, JSON.parse(localStorage.getItem('aura_opts') || '{}')); } catch {}
const saveOpts = () => { try { localStorage.setItem('aura_opts', JSON.stringify(state.opts)); } catch {} updateOptLabel(); };

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

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 2500);
}

// ---------- markdown ----------
function renderMd(text) {
  if (!window.marked) return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
  const html = marked.parse(text, { breaks: true, gfm: true });
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}
function enhance(el) {
  el.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement.classList.contains('codewrap')) return;
    const code = pre.querySelector('code');
    const lang = ((code?.className || '').match(/language-(\w+)/) || [])[1] || 'code';
    if (window.hljs && code) { try { hljs.highlightElement(code); } catch {} }
    const wrap = document.createElement('div');
    wrap.className = 'codewrap';
    wrap.innerHTML = `<div class="codehead"><span>${esc(lang)}</span><button>Copy</button></div>`;
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    $('button', wrap).onclick = async (e) => {
      await navigator.clipboard.writeText(code ? code.innerText : pre.innerText).catch(() => {});
      e.target.textContent = 'Copied';
      setTimeout(() => (e.target.textContent = 'Copy'), 1500);
    };
  });
}

// ---------- login ----------
function showLogin() { $('#login').classList.remove('hidden'); setTimeout(() => $('#pw').focus(), 50); }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    await api('/login', { method: 'POST', body: { password: $('#pw').value } });
    $('#pw').value = '';
    $('#login').classList.add('hidden');
    await boot();
  } catch (err) { $('#loginErr').textContent = err.message; }
};

// ---------- sidebar ----------
function renderConvs() {
  const list = $('#convList');
  list.innerHTML = '';
  for (const c of state.convs) {
    const d = document.createElement('div');
    d.className = 'conv' + (c.id === state.cur ? ' active' : '');
    d.innerHTML = `<span class="t">${esc(c.title)}</span><button class="x" title="Delete">✕</button>`;
    d.onclick = () => { openConv(c.id); closeSide(); };
    $('.x', d).onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this chat?')) return;
      await api('/conversations/' + c.id, { method: 'DELETE' });
      if (state.cur === c.id) newChat();
      loadConvs();
    };
    d.ondblclick = async () => {
      const t = prompt('Rename chat', c.title);
      if (t && t.trim()) { await api('/conversations/' + c.id, { method: 'PATCH', body: { title: t } }); loadConvs(); }
    };
    list.appendChild(d);
  }
}
async function loadConvs() { state.convs = await api('/conversations'); renderConvs(); }
const openSide = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.remove('hidden'); };
const closeSide = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.add('hidden'); };
$('#openSide').onclick = openSide; $('#closeSide').onclick = closeSide; $('#scrim').onclick = closeSide;

// ---------- chat view ----------
function setEmpty(on) {
  $('#empty').classList.toggle('hidden', !on);
  const h = new Date().getHours();
  $('#greeting').textContent = h < 5 ? 'Burning the midnight oil?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function newChat() {
  state.cur = null; state.messages = [];
  $('#messages').innerHTML = ''; $('#chatTitle').textContent = '';
  setEmpty(true); renderConvs(); $('#input').focus();
}
$('#newChat').onclick = () => { newChat(); closeSide(); };

async function openConv(id) {
  if (state.streaming) return;
  const c = await api('/conversations/' + id);
  state.cur = c.id; state.messages = c.messages;
  $('#chatTitle').textContent = c.title;
  renderMessages(); renderConvs();
}

function thinkHtml(text, open) {
  return `<details class="think" ${open ? 'open' : ''}><summary>${open ? 'Thinking…' : 'Thought process'}</summary><div class="tt">${esc(text)}</div></details>`;
}
function msgEl(m) {
  const d = document.createElement('div');
  d.className = 'msg ' + m.role;
  if (m.role === 'user') {
    const imgs = (m.images || []).map((x) => (typeof x === 'number' ? `/api/attachments/${x}` : x.url));
    d.innerHTML = `${imgs.length ? `<div class="imgs">${imgs.map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}${m.content ? '<div class="bubble"></div>' : ''}<div class="actions"></div>`;
    if (m.content) $('.bubble', d).textContent = m.content;
  } else {
    d.innerHTML = `${m.thinking ? thinkHtml(m.thinking, false) : ''}<div class="md"></div><div class="actions"></div>`;
    const md = $('.md', d);
    md.innerHTML = renderMd(m.content); enhance(md);
  }
  return d;
}
function addActions(d, idx) {
  const a = $('.actions', d);
  if (!a) return;
  const m = state.messages[idx];
  if (!m) return;
  if (m.role === 'user') {
    a.innerHTML = '<button data-a="edit">✎ Edit</button>';
  } else {
    const last = idx === state.messages.length - 1;
    a.innerHTML = `<button data-a="copy">Copy</button>${last ? '<button data-a="retry">↻ Retry</button>' : ''}`;
  }
  a.onclick = async (e) => {
    const k = e.target.dataset.a;
    if (!k || state.streaming) return;
    if (k === 'copy') { await navigator.clipboard.writeText(m.content).catch(() => {}); toast('Copied'); }
    if (k === 'retry') send('', true);
    if (k === 'edit') editMessage(idx);
  };
}
function editMessage(idx) {
  const m = state.messages[idx];
  if (!m.id) return toast('Give it a second, then try again');
  openModal(`<div class="modal-head"><span>Edit message</span><button class="icon-btn" id="mx">✕</button></div>
    <div class="modal-body"><textarea id="et" rows="8"></textarea>
    <div class="small">This replaces the message and re-runs everything after it.</div>
    <div class="row"><button class="btn primary" id="es">Save &amp; resend</button><button class="btn" id="ec">Cancel</button></div></div>`);
  $('#et').value = m.content;
  $('#mx').onclick = $('#ec').onclick = closeModal;
  $('#es').onclick = () => {
    const t = $('#et').value; if (!t.trim()) return;
    closeModal();
    state.messages = state.messages.slice(0, idx);
    send(t, false, m.id);
  };
}
function renderMessages() {
  const box = $('#messages'); box.innerHTML = '';
  setEmpty(state.messages.length === 0);
  state.messages.forEach((m, i) => {
    const d = msgEl(m);
    addActions(d, i);
    box.appendChild(d);
  });
  scrollDown(true);
}
function scrollDown(force) {
  const s = $('#scroll');
  if (force || s.scrollHeight - s.scrollTop - s.clientHeight < 160) s.scrollTop = s.scrollHeight;
}

// ---------- sending ----------
async function send(text, regenerate = false, editMessageId = null) {
  if (state.streaming) return;
  let images = [];
  if (!regenerate) {
    text = (text || '').trim();
    images = state.pending.splice(0);
    renderAtt();
    if (!text && !images.length) return;
    state.messages.push({ role: 'user', content: text, images: images.map((im) => ({ url: `data:${im.mime};base64,${im.data}` })) });
  } else {
    if (state.messages.at(-1)?.role === 'assistant') state.messages.pop();
  }
  renderMessages();
  const box = $('#messages');

  const d = document.createElement('div');
  d.className = 'msg assistant';
  d.innerHTML = `<div class="think-slot"></div><div class="status hidden"></div><div class="md cursor"></div><div class="actions"></div>`;
  box.appendChild(d);
  const md = $('.md', d);
  const slot = $('.think-slot', d);
  const statusEl = $('.status', d);
  scrollDown(true);

  state.streaming = true;
  const ac = (state.abort = new AbortController());
  setSendMode();
  let acc = '', thinking = '', err = null, raf = 0;
  const paint = () => {
    raf = 0;
    md.innerHTML = renderMd(acc);
    if (thinking) {
      if (!slot.firstChild) slot.innerHTML = thinkHtml('', !acc);
      const det = slot.firstChild;
      $('.tt', det).textContent = thinking;
      if (acc && det.open && !det._closed) { det.open = false; det._closed = true; $('summary', det).textContent = 'Thought process'; }
    }
    scrollDown();
  };

  try {
    const o = state.opts;
    const r = await fetch('/api/chat', {
      method: 'POST', credentials: 'same-origin', signal: ac.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.cur, message: text, model: state.model, regenerate, editMessageId, images, style: o.style,
        options: { effort: o.effort || undefined, webSearch: o.webSearch, temperature: Number(o.temperature), maxTokens: Number(o.maxTokens) },
      }),
    });
    if (r.status === 401) { showLogin(); throw new Error('Not logged in'); }
    if (!r.ok) { let m; try { m = (await r.json()).error; } catch {} throw new Error(m || r.statusText); }

    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === 'meta') {
          if (!state.cur) { state.cur = ev.conversationId; $('#chatTitle').textContent = ev.title; }
        } else if (ev.type === 'delta') {
          statusEl.classList.add('hidden');
          acc += ev.text; if (!raf) raf = requestAnimationFrame(paint);
        } else if (ev.type === 'thinking') {
          thinking += ev.text; if (!raf) raf = requestAnimationFrame(paint);
        } else if (ev.type === 'status') {
          statusEl.textContent = '🔎 ' + ev.text; statusEl.classList.remove('hidden');
        } else if (ev.type === 'error') err = ev.error;
      }
    }
  } catch (e) { if (e.name !== 'AbortError') err = e.message; }

  if (raf) cancelAnimationFrame(raf);
  md.classList.remove('cursor'); statusEl.classList.add('hidden');
  md.innerHTML = renderMd(acc); enhance(md);
  if (thinking) {
    slot.innerHTML = thinkHtml(thinking, false);
  }
  if (acc.trim()) { state.messages.push({ role: 'assistant', content: acc.trim(), thinking }); addActions(d, state.messages.length - 1); }
  if (err) { const e = document.createElement('div'); e.className = 'err-inline'; e.textContent = '⚠ ' + err; d.appendChild(e); if (!acc.trim()) { addErrActions(d); } }
  state.streaming = false; state.abort = null; setSendMode();
  loadConvs();
  // sync message ids from the server so edit/retry work (no re-render)
  if (state.cur) {
    try {
      const c = await api('/conversations/' + state.cur);
      c.messages.forEach((sm, i) => { if (state.messages[i]) state.messages[i].id = sm.id; });
      document.querySelectorAll('#messages .msg').forEach((el, i) => addActions(el, i));
    } catch {}
  }
}
function addErrActions(d) {
  const b = document.createElement('div'); b.className = 'actions';
  b.innerHTML = '<button>↻ Retry</button>';
  b.onclick = () => { d.remove(); send('', true); };
  d.appendChild(b);
}
function setSendMode() {
  const b = $('#sendBtn');
  b.classList.toggle('stop', state.streaming);
  b.textContent = state.streaming ? '■' : '↑';
  b.disabled = false;
}
$('#sendBtn').onclick = () => {
  if (state.streaming) return state.abort?.abort();
  const t = $('#input').value; if (!t.trim() && !state.pending.length) return;
  $('#input').value = ''; autoGrow(); send(t);
};

// ---------- image attachments ----------
function renderAtt() {
  const s = $('#attStrip');
  s.classList.toggle('hidden', !state.pending.length);
  s.innerHTML = state.pending.map((im, i) => `<div class="att"><img src="data:${im.mime};base64,${im.data}" alt=""><button data-i="${i}">✕</button></div>`).join('');
  s.querySelectorAll('button').forEach((b) => (b.onclick = () => { state.pending.splice(+b.dataset.i, 1); renderAtt(); }));
}
async function shrink(file) { // downscale big photos so uploads stay small
  const bmp = await createImageBitmap(file);
  const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (sc === 1 && file.size < 1.5e6) return null;
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) { toast('Only images are supported'); continue; }
    if (state.pending.length >= 5) { toast('Max 5 images'); break; }
    let url = null;
    try { url = await shrink(f); } catch {}
    if (!url) url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const m = url.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
    if (m) state.pending.push({ mime: m[1], data: m[2] });
  }
  renderAtt();
}
$('#attachBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#input').addEventListener('paste', (e) => {
  const fs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (fs.length) { e.preventDefault(); addFiles(fs); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });

// ---------- options (thinking effort / web search / style / temperature) ----------
const EFFORT_LABEL = { '': 'Off', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };
function updateOptLabel() {
  const o = state.opts, bits = [];
  if (o.effort) bits.push('🧠 ' + EFFORT_LABEL[o.effort]);
  if (o.webSearch) bits.push('🌐');
  if (o.style !== 'normal') bits.push(o.style);
  $('#optLabel').textContent = bits.length ? bits.join(' · ') : '⚙ Options';
  $('#optBtn').classList.toggle('on', bits.length > 0);
}
function openOptions() {
  const o = state.opts;
  openModal(`<div class="modal-head"><span>Options</span><button class="icon-btn" id="mx">✕</button></div>
  <div class="modal-body">
    <div><div class="lbl">Extended thinking (effort)</div>
      <div class="seg" id="effSeg">${Object.keys(EFFORT_LABEL).map((k) => `<button data-v="${k}" class="${o.effort === k ? 'on' : ''}">${EFFORT_LABEL[k]}</button>`).join('')}</div>
      <div class="small" style="margin-top:6px">Higher = the model reasons longer before answering (slower, costs more tokens). Works with Claude; many OpenRouter models support it too.</div></div>
    <div class="card row between"><div><div class="name">Web search</div><div class="desc">Let the model search the web for current info</div></div>
      <label class="switch"><input type="checkbox" id="ws" ${o.webSearch ? 'checked' : ''}><span></span></label></div>
    <div><div class="lbl">Response style</div>
      <select id="st">${['normal', 'concise', 'explanatory', 'formal', 'casual'].map((s) => `<option value="${s}" ${o.style === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
    <div><div class="lbl">Temperature: <b id="tv">${o.temperature}</b> <span class="small">(ignored when thinking is on)</span></div>
      <input type="range" id="tp" min="0" max="1" step="0.1" value="${o.temperature}"></div>
    <div><div class="lbl">Max output tokens</div>
      <input type="text" id="mt" inputmode="numeric" value="${o.maxTokens}"></div>
  </div>`);
  $('#mx').onclick = closeModal;
  $('#effSeg').onclick = (e) => {
    const v = e.target.dataset?.v; if (v === undefined) return;
    state.opts.effort = v; saveOpts();
    document.querySelectorAll('#effSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  };
  $('#ws').onchange = (e) => { state.opts.webSearch = e.target.checked; saveOpts(); };
  $('#st').onchange = (e) => { state.opts.style = e.target.value; saveOpts(); };
  $('#tp').oninput = (e) => { state.opts.temperature = Number(e.target.value); $('#tv').textContent = e.target.value; saveOpts(); };
  $('#mt').onchange = (e) => { const n = parseInt(e.target.value, 10); state.opts.maxTokens = n >= 256 && n <= 64000 ? n : 8192; e.target.value = state.opts.maxTokens; saveOpts(); };
}
$('#optBtn').onclick = openOptions;
const touch = matchMedia('(pointer: coarse)').matches;
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !touch) { e.preventDefault(); $('#sendBtn').click(); }
});
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; }
$('#input').addEventListener('input', autoGrow);

// ---------- modal helpers ----------
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------- model picker ----------
function modelLabel(id) {
  const m = state.models.find((x) => x.id === id);
  return m ? m.name : (id || 'Model').replace(/^\w+:/, '');
}
function updateModelBtn() { $('#modelName').textContent = modelLabel(state.model); }
function pickModel(onPick, current) {
  openModal(`<div class="modal-head"><span>Choose model</span><button class="icon-btn" id="mx">✕</button></div>
    <div class="modal-body"><input type="search" id="mq" placeholder="Search models…" autocomplete="off">
    <div id="mlist"></div>
    <div class="small">Tip: any OpenRouter model ID works too — type <code>openrouter:vendor/model</code> and press Enter.</div></div>`);
  $('#mx').onclick = closeModal;
  const draw = () => {
    const q = $('#mq').value.toLowerCase();
    const items = state.models.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 150);
    $('#mlist').innerHTML = items.map((m) =>
      `<div class="mrow ${m.id === current ? 'on' : ''}" data-id="${esc(m.id)}"><span>${esc(m.name)}</span><span class="p">${esc(m.provider)}</span></div>`).join('') || '<div class="small">No matches</div>';
    document.querySelectorAll('#mlist .mrow').forEach((r) => (r.onclick = () => { onPick(r.dataset.id); closeModal(); }));
  };
  $('#mq').oninput = draw;
  $('#mq').onkeydown = (e) => {
    const v = $('#mq').value.trim();
    if (e.key === 'Enter' && /^(anthropic|openrouter):.+/.test(v)) { onPick(v); closeModal(); }
  };
  draw(); setTimeout(() => $('#mq').focus(), 50);
}
$('#modelBtn').onclick = () => pickModel((id) => { state.model = id; localStorage.setItem('aura_model', id); updateModelBtn(); }, state.model);

// ---------- settings ----------
$('#openSettings').onclick = () => { closeSide(); openSettings('memory'); };
async function openSettings(tab) {
  openModal(`<div class="modal-head"><span>Settings</span><button class="icon-btn" id="mx">✕</button></div>
    <div class="tabs">
      ${['memory', 'skills', 'general'].map((t) => `<button class="tab ${t === tab ? 'on' : ''}" data-t="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    </div><div class="modal-body" id="tabBody"></div>`);
  $('#mx').onclick = closeModal;
  document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => openSettings(b.dataset.t)));
  const body = $('#tabBody');
  if (tab === 'memory') await memoryTab(body);
  if (tab === 'skills') await skillsTab(body);
  if (tab === 'general') await generalTab(body);
}

async function memoryTab(body) {
  const mems = await api('/memories');
  body.innerHTML = `<div class="small">Facts the assistant saved about you (needs the Memory skill on). They are added to every chat.</div>
    <div class="row"><input type="text" id="newMem" placeholder="Add a memory manually…"><button class="btn" id="addMem">Add</button></div>
    ${mems.map((m) => `<div class="card row between"><span>${esc(m.text)}</span><button class="btn danger" data-id="${m.id}">Delete</button></div>`).join('') || '<div class="small">Nothing saved yet.</div>'}
    ${mems.length ? '<button class="btn danger" id="clearMem">Delete all memories</button>' : ''}`;
  $('#addMem').onclick = async () => { const v = $('#newMem').value; if (v.trim()) { await api('/memories', { method: 'POST', body: { text: v } }); memoryTab(body); } };
  body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = async () => { await api('/memories/' + b.dataset.id, { method: 'DELETE' }); memoryTab(body); }));
  const c = $('#clearMem'); if (c) c.onclick = async () => { if (confirm('Delete ALL memories?')) { await api('/memories', { method: 'DELETE' }); memoryTab(body); } };
}

async function skillsTab(body) {
  const skills = await api('/skills');
  body.innerHTML = `<div class="small">Skills are instruction packs added to the system prompt when switched on.</div>
    ${skills.map((s) => `<div class="card"><div class="row between"><div><div class="name">${esc(s.name)}${s.builtin ? ' <span class="small">· built-in</span>' : ''}</div><div class="desc">${esc(s.description)}</div></div>
      <label class="switch"><input type="checkbox" data-sw="${s.id}" ${s.enabled ? 'checked' : ''}><span></span></label></div>
      <div class="row" style="margin-top:8px"><button class="btn" data-edit="${s.id}">Edit</button>${s.builtin ? '' : `<button class="btn danger" data-del="${s.id}">Delete</button>`}</div></div>`).join('')}
    <div class="row"><button class="btn primary" id="addSkill">＋ New skill</button><button class="btn" id="impSkill">Import SKILL.md</button></div>`;
  $('#impSkill').onclick = () => importSkill(body);
  body.querySelectorAll('[data-sw]').forEach((i) => (i.onchange = async () => { await api('/skills/' + i.dataset.sw, { method: 'PUT', body: { enabled: i.checked } }); toast(i.checked ? 'Skill on' : 'Skill off'); }));
  body.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('Delete skill?')) { await api('/skills/' + b.dataset.del, { method: 'DELETE' }); skillsTab(body); } }));
  body.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => skillForm(body, skills.find((s) => s.id == b.dataset.edit))));
  $('#addSkill').onclick = () => skillForm(body, null);
}
function importSkill(body) {
  body.innerHTML = `<div class="small">Paste a SKILL.md (frontmatter with name + description, then the instructions).</div>
    <textarea id="sm" rows="14" placeholder="---\nname: my-skill\ndescription: When to use it\n---\nInstructions…"></textarea>
    <div class="row"><button class="btn primary" id="si2">Import</button><button class="btn" id="sc2">Cancel</button></div>`;
  $('#sc2').onclick = () => skillsTab(body);
  $('#si2').onclick = async () => {
    const t = $('#sm').value.replace(/\r/g, '');
    const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const fm = m ? m[1] : '', ins = (m ? m[2] : t).trim();
    const get = (k) => ((fm.match(new RegExp('^' + k + ':\\s*(.+)$', 'mi')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
    const name = get('name') || 'Imported skill';
    if (!ins) return toast('No instructions found');
    try { await api('/skills', { method: 'POST', body: { name, description: get('description'), instructions: ins } }); toast('Imported'); skillsTab(body); }
    catch (e) { toast(e.message); }
  };
}
function skillForm(body, s) {
  body.innerHTML = `<input type="text" id="sn" placeholder="Skill name" value="${esc(s?.name || '')}">
    <input type="text" id="sd" placeholder="Short description" value="${esc(s?.description || '')}">
    <textarea id="si" rows="10" placeholder="Instructions the model should follow…">${esc(s?.instructions || '')}</textarea>
    <div class="row"><button class="btn primary" id="ss">Save</button><button class="btn" id="sc">Cancel</button></div>`;
  $('#sc').onclick = () => skillsTab(body);
  $('#ss').onclick = async () => {
    const b = { name: $('#sn').value, description: $('#sd').value, instructions: $('#si').value };
    try {
      if (s) await api('/skills/' + s.id, { method: 'PUT', body: b }); else await api('/skills', { method: 'POST', body: b });
      skillsTab(body);
    } catch (e) { toast(e.message); }
  };
}

async function generalTab(body) {
  const st = await api('/settings');
  body.innerHTML = `<div><div class="small">Default model for new chats</div>
      <div class="row"><button class="btn" id="dm" style="flex:1;text-align:left">${esc(modelLabel(st.defaultModel))}</button></div></div>
    <div><div class="small">Custom instructions (added to every chat)</div>
      <textarea id="sp" rows="6" placeholder="e.g. Reply casually and keep it short.">${esc(st.systemPrompt)}</textarea></div>
    <div class="row"><button class="btn primary" id="sv">Save</button><button class="btn" id="lo">Log out</button></div>`;
  $('#dm').onclick = () => pickModel(async (id) => {
    await api('/settings', { method: 'PUT', body: { defaultModel: id } });
    state.defaultModel = id; toast('Default model saved');
    setTimeout(() => openSettings('general'), 0);
  }, st.defaultModel);
  $('#sv').onclick = async () => {
    await api('/settings', { method: 'PUT', body: { systemPrompt: $('#sp').value } });
    toast('Saved');
  };
  $('#lo').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };
}

// ---------- boot ----------
async function boot() {
  const [m] = await Promise.all([api('/models'), loadConvs()]);
  state.models = m.models; state.defaultModel = m.defaultModel;
  const saved = localStorage.getItem('aura_model');
  state.model = saved || m.defaultModel;
  updateModelBtn(); updateOptLabel();
  if (!m.keys.anthropic && !m.keys.openrouter) toast('No API keys configured on the server (.env)');
  newChat();
}
(async () => {
  try { await api('/me'); await boot(); } catch { /* login shown */ }
})();
