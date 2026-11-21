// Seoran DevTools. Talks to the inspected page over the Chrome DevTools
// Protocol, relayed by the shell (sd.result / sd.event come back from Rust).
'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const send = (m) => window.ipc.postMessage(JSON.stringify(m));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

// ---- protocol ----------------------------------------------------------------
let rid = 0;
const waits = new Map();
const handlers = {};
let target = null; // { tabId, url, title }
let gen = 0; // bumps on every attach; stale replies are dropped

function cdp(method, params = {}) {
  const g = gen;
  return new Promise((ok, fail) => {
    const id = ++rid;
    waits.set(id, { ok, fail, g });
    send({ t: 'cdp', id, method, params });
  });
}
const quiet = (p) => p.catch(() => null);

function on(name, fn) {
  (handlers[name] ||= []).push(fn);
}

const EVENTS = [
  'Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Runtime.executionContextsCleared',
  'Log.entryAdded',
  'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed',
  'Network.requestServedFromCache', 'Network.webSocketCreated',
  'Page.frameNavigated',
  'DOM.documentUpdated', 'DOM.setChildNodes', 'DOM.childNodeInserted', 'DOM.childNodeRemoved',
  'DOM.attributeModified', 'DOM.attributeRemoved', 'DOM.characterDataModified', 'DOM.childNodeCountUpdated',
  'Overlay.inspectNodeRequested',
];

window.sd = {
  result(id, ok, data) {
    const w = waits.get(id);
    if (!w) return;
    waits.delete(id);
    if (w.g !== gen) return;
    ok ? w.ok(data) : w.fail(new Error((data && data.message) || String(data)));
  },
  event(name, params) {
    for (const fn of handlers[name] || []) {
      try { fn(params); } catch (e) { console.error(name, e); }
    }
  },
  async attach(info) {
    target = info;
    gen++;
    window.__seoranLook(info);
    waits.clear();
    $('#target').textContent = info.title || info.url;
    $('#target').title = info.url;
    consoleView.reset(true);
    networkView.reset(true);
    elementsView.reset();
    send({ t: 'subscribe', events: EVENTS });
    for (const m of ['Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable', 'CSS.enable', 'Overlay.enable']) {
      await quiet(cdp(m));
    }
    await quiet(cdp('Network.enable', { maxPostDataSize: 65536 }));
    elementsView.load();
    if (current === 'storage') storageView.load();
    if (current === 'shield') send({ t: 'shield' });
  },
  show(opts) {
    if (opts.view) select(opts.view);
    if (opts.pick) elementsView.pick(true);
    if (opts.inspectAt) elementsView.inspectAt(opts.inspectAt);
  },
  shield(report) { shieldView.render(report); },
};

window.__seoranLook = ({ theme, plastic }) => {
  const r = document.documentElement;
  if (theme && theme !== 'system') r.dataset.theme = theme; else delete r.dataset.theme;
  if (plastic && plastic !== 'volt') r.dataset.signal = plastic; else delete r.dataset.signal;
};

// ---- chrome of the panel -------------------------------------------------------
$('#pick').innerHTML = icon('cursor', 15);
$('#close').innerHTML = icon('x', 15);
$('#con-clear').innerHTML = icon('ban', 14);
$('#net-clear').innerHTML = icon('ban', 14);
$('#st-refresh').innerHTML = icon('reload', 14);
$('#net-close').innerHTML = icon('x', 13);

let current = null;
function select(view) {
  current = view;
  for (const b of $$('#views button')) b.classList.toggle('on', b.dataset.view === view);
  for (const s of $$('.view')) s.hidden = s.id !== `v-${view}`;
  try { localStorage.setItem('sd.view', view); } catch {}
  if (view === 'console') consoleView.focus();
  if (view === 'storage') storageView.load();
  if (view === 'shield') send({ t: 'shield' });
}
$('#views').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(b.dataset.view); });
$('#close').addEventListener('click', () => send({ t: 'close' }));
$('#advanced').addEventListener('click', () => send({ t: 'advanced' }));
$('#pick').addEventListener('click', () => elementsView.pick(!elementsView.picking));

// Resize by dragging the top edge.
$('#grip').addEventListener('pointerdown', (e) => {
  const y0 = e.screenY;
  const h0 = innerHeight;
  let frame = 0;
  const move = (ev) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => send({ t: 'resize', h: h0 + (y0 - ev.screenY) }));
  };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
});

document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'F12' || (e.ctrlKey && e.shiftKey && (k === 'I' || k === 'i'))) { e.preventDefault(); send({ t: 'close' }); }
  else if (e.ctrlKey && e.shiftKey && (k === 'C' || k === 'c')) { e.preventDefault(); select('elements'); elementsView.pick(true); }
  else if (e.ctrlKey && e.shiftKey && (k === 'J' || k === 'j')) { e.preventDefault(); select('console'); }
  else if (k === 'Escape' && elementsView.picking) elementsView.pick(false);
  else if ((e.ctrlKey && (k === 'r' || k === '+' || k === '-' || k === '=')) || k === 'F5') e.preventDefault();
});
addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

// ---- value rendering (shared by console and others) ------------------------------
function short(text, n = 120) {
  text = String(text);
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function previewText(p) {
  if (!p) return '';
  const inner = (p.properties || []).map((x) => {
    const v = x.type === 'string' ? `"${short(x.value, 30)}"` : x.value ?? x.type;
    return p.subtype === 'array' ? v : `${x.name}: ${v}`;
  });
  if (p.overflow) inner.push('…');
  return p.subtype === 'array' ? `[${inner.join(', ')}]` : `{${inner.join(', ')}}`;
}

// Render a RemoteObject. `top` = a direct console argument (strings unquoted).
function renderValue(o, top = false) {
  if (!o) return document.createTextNode('');
  switch (o.type) {
    case 'string':
      return top ? document.createTextNode(o.value) : h(`<span class="t-str">"${esc(short(o.value, 500))}"</span>`);
    case 'number':
    case 'bigint':
      return h(`<span class="t-num">${esc(o.description ?? o.value ?? o.unserializableValue)}</span>`);
    case 'boolean':
      return h(`<span class="t-num">${o.value}</span>`);
    case 'undefined':
      return h('<span class="t-null">undefined</span>');
    case 'symbol':
      return h(`<span class="t-fn">${esc(o.description)}</span>`);
    case 'function':
      return expandable(o, h(`<span class="t-fn">ƒ ${esc(short((o.description || '').split('\n')[0].replace(/^function\s*/, ''), 80))}</span>`));
    case 'object': {
      if (o.subtype === 'null') return h('<span class="t-null">null</span>');
      if (o.subtype === 'node') {
        const el = h(`<span class="node-ref">${esc(o.description)}</span>`);
        el.addEventListener('mouseenter', () => quiet(cdp('Overlay.highlightNode', { objectId: o.objectId, highlightConfig: HIGHLIGHT })));
        el.addEventListener('mouseleave', () => quiet(cdp('Overlay.hideHighlight')));
        el.addEventListener('click', async () => {
          const r = await quiet(cdp('DOM.requestNode', { objectId: o.objectId }));
          if (r) { select('elements'); elementsView.revealNode(r.nodeId); }
        });
        return el;
      }
      if (o.subtype === 'error') {
        return expandable(o, h(`<span>${esc(o.description)}</span>`));
      }
      const label = o.preview ? `${o.className && o.className !== 'Object' ? `${o.className} ` : ''}${previewText(o.preview)}` : o.description;
      return expandable(o, h(`<span>${esc(label)}</span>`));
    }
    default:
      return document.createTextNode(o.description ?? String(o.value));
  }
}

function expandable(o, summaryContent) {
  if (!o.objectId) return summaryContent;
  const d = h('<details class="obj"><summary></summary><span class="props"></span></details>');
  d.firstChild.appendChild(summaryContent);
  d.addEventListener('toggle', async () => {
    if (!d.open || d.dataset.loaded) return;
    d.dataset.loaded = '1';
    const r = await quiet(cdp('Runtime.getProperties', { objectId: o.objectId, ownProperties: true, generatePreview: true }));
    const box = d.lastChild;
    if (!r) { box.textContent = '(unavailable)'; return; }
    const props = [...(r.result || []), ...(r.internalProperties || []).map((p) => ({ ...p, name: `[[${p.name}]]` }))];
    for (const p of props.slice(0, 500)) {
      if (!p.value && !p.get) continue;
      const row = h(`<div><span class="t-key">${esc(p.name)}</span>: </div>`);
      row.appendChild(p.value ? renderValue(p.value) : h('<span class="t-null">(…)</span>'));
      box.appendChild(row);
    }
    if (!box.childNodes.length) box.textContent = '(no own properties)';
  });
  return d;
}

const HIGHLIGHT = {
  showInfo: true,
  showStyles: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.55 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.5 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.6 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.55 },
};

const fileOf = (url) => {
  try { const u = new URL(url); return u.pathname.split('/').filter(Boolean).pop() || u.host; } catch { return url; }
};

// ---- console ---------------------------------------------------------------------
const consoleView = (() => {
  const out = $('#con-out');
  const input = $('#con-in');
  let level = 'all';
  let errors = 0;
  let warnings = 0;
  const history = [];
  let hpos = 0;
  let last = null; // for collapsing repeats

  const levelOf = (type) => ({ error: 'error', assert: 'error', warning: 'warning', warn: 'warning', debug: 'debug', verbose: 'debug', info: 'info' }[type] || 'log');
  const ic = { error: icon('x', 12), warning: icon('warn', 12), input: '<span class="t-null">›</span>', result: '<span class="t-null">‹</span>' };

  function badge() {
    $('#b-err').hidden = !errors;
    $('#b-err').textContent = errors;
    $('#b-warn').hidden = !warnings;
    $('#b-warn').textContent = warnings;
  }

  function visible(el) {
    const lv = el.dataset.level;
    const okLevel = level === 'all' || lv === level || (level === 'info' && lv === 'log') || lv === 'input' || lv === 'result';
    const q = $('#con-filter').value.trim().toLowerCase();
    return okLevel && (!q || el.textContent.toLowerCase().includes(q));
  }

  function add(lv, parts, src) {
    if (lv === 'error') errors++;
    if (lv === 'warning') warnings++;
    badge();
    const key = `${lv}|${src}|${parts.map((p) => (p.nodeType === 3 ? p.textContent : p.outerHTML)).join('')}`;
    if (last && last.key === key && out.lastChild === last.el) {
      last.n++;
      let c = last.el.querySelector('.count');
      if (!c) { c = h('<span class="count"></span>'); last.el.insertBefore(c, last.el.querySelector('.msg')); }
      c.textContent = last.n;
      return;
    }
    const el = h(`<div class="ce ${lv}" data-level="${lv}"><span class="ic-col">${ic[lv] || ''}</span><span class="msg"></span>${src ? `<span class="src" title="${esc(src)}">${esc(fileOf(src.split(':').slice(0, -1).join(':') || src))}:${esc(src.split(':').pop())}</span>` : ''}</div>`);
    const msg = el.querySelector('.msg');
    parts.forEach((p, i) => { if (i) msg.append(' '); msg.append(p); });
    el.hidden = !visible(el);
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
    out.appendChild(el);
    while (out.childNodes.length > 1500) out.firstChild.remove();
    if (stick) out.scrollTop = out.scrollHeight;
    last = { key, el, n: 1 };
  }

  // printf-style %s %d %i %f %o %O %c in the first argument.
  function formatArgs(args) {
    if (!args.length) return [];
    const [first, ...rest] = args;
    if (first.type !== 'string' || !first.value.includes('%')) return args.map((a) => renderValue(a, true));
    const parts = [];
    let text = '';
    const fmt = first.value;
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] === '%' && i + 1 < fmt.length) {
        const c = fmt[i + 1];
        if ('sdifoOc'.includes(c)) {
          i++;
          const a = rest.shift();
          if (c === 'c') continue;
          if (!a) { text += `%${c}`; continue; }
          if (c === 's' || c === 'd' || c === 'i' || c === 'f') {
            const v = a.type === 'string' ? a.value : a.description ?? a.value;
            text += c === 'd' || c === 'i' ? String(parseInt(v, 10)) : c === 'f' ? String(parseFloat(v)) : String(v);
          } else {
            if (text) { parts.push(document.createTextNode(text)); text = ''; }
            parts.push(renderValue(a));
          }
          continue;
        }
        if (c === '%') { text += '%'; i++; continue; }
      }
      text += fmt[i];
    }
    if (text) parts.push(document.createTextNode(text));
    for (const a of rest) parts.push(renderValue(a, true));
    return parts;
  }

  const where = (st, url, line) => {
    const f = st && st.callFrames && st.callFrames[0];
    if (f && f.url) return `${f.url}:${f.lineNumber + 1}`;
    return url ? `${url}:${(line ?? 0) + 1}` : '';
  };

  on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'clear') { reset(false); add('debug', [document.createTextNode('Console was cleared')], ''); return; }
    add(levelOf(p.type), formatArgs(p.args || []), where(p.stackTrace));
  });
  on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
    const text = d.exception ? d.exception.description || d.exception.value : d.text;
    add('error', [document.createTextNode(`Uncaught ${text || ''}`)], where(d.stackTrace, d.url, d.lineNumber));
  });
  on('Log.entryAdded', ({ entry }) => {
    add(levelOf(entry.level), [document.createTextNode(entry.text)], entry.url ? `${entry.url}:${(entry.lineNumber ?? 0) + 1}` : '');
  });
  on('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId) return;
    if (target) { target.url = frame.url; $('#target').title = frame.url; }
    if ($('#con-preserve').checked) add('debug', [document.createTextNode(`Navigated to ${frame.url}`)], '');
    else reset(false);
  });

  function reset(full) {
    out.textContent = '';
    errors = 0;
    warnings = 0;
    last = null;
    badge();
    if (full) quiet(cdp('Runtime.releaseObjectGroup', { objectGroup: 'console' }));
  }

  async function run(code) {
    add('input', [h(`<span>${esc(code)}</span>`)], '');
    history.push(code);
    hpos = history.length;
    const r = await cdp('Runtime.evaluate', {
      expression: code, objectGroup: 'console', includeCommandLineAPI: true, replMode: true,
      generatePreview: true, userGesture: true, awaitPromise: true,
    }).catch((e) => ({ exceptionDetails: { text: e.message } }));
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception;
      add('error', [document.createTextNode(`Uncaught ${ex ? ex.description || ex.value : r.exceptionDetails.text}`)], '');
    } else {
      add('result', [renderValue(r.result)], '');
    }
  }

  input.addEventListener('keydown', (e) => {
    const atStart = input.selectionStart === 0;
    const atEnd = input.selectionEnd === input.value.length;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      input.value = '';
      autosize();
      run(code);
    } else if (e.key === 'ArrowUp' && atStart && hpos > 0) {
      e.preventDefault();
      input.value = history[--hpos];
      autosize();
    } else if (e.key === 'ArrowDown' && atEnd && hpos < history.length) {
      e.preventDefault();
      input.value = history[++hpos] ?? '';
      autosize();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      reset(false);
    }
  });
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
  input.addEventListener('input', autosize);
  out.addEventListener('click', (e) => { if (!getSelection().toString() && !e.target.closest('details, .node-ref')) input.focus(); });

  $('#con-clear').addEventListener('click', () => reset(false));
  $('#con-levels').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    level = b.dataset.level;
    for (const x of $$('#con-levels button')) x.classList.toggle('on', x === b);
    for (const el of out.children) el.hidden = !visible(el);
  });
  $('#con-filter').addEventListener('input', () => { for (const el of out.children) el.hidden = !visible(el); });

  return { reset, focus: () => input.focus() };
})();

// ---- network ---------------------------------------------------------------------
const networkView = (() => {
  const rows = $('#net-rows');
  const reqs = new Map();
  let order = [];
  let t0 = 0;
  let type = 'all';
  let selected = null;
  let sub = 'headers';
  let frame = 0;

  const typeKey = (t) => ({ XHR: 'xhr', Fetch: 'xhr', EventSource: 'xhr', Script: 'script', Stylesheet: 'stylesheet', Image: 'image', Media: 'media', Font: 'font', Document: 'document', WebSocket: 'websocket' }[t] || 'other');
  const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1048576).toFixed(1)} MB`);
  const ms = (s) => (s == null ? '' : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);

  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }

  function shown(r) {
    const q = $('#net-filter').value.trim().toLowerCase();
    if (q && !r.url.toLowerCase().includes(q)) return false;
    if (type === 'all') return true;
    if (type === 'blocked') return r.blocked;
    return typeKey(r.type) === type;
  }

  function render() {
    const list = order.map((id) => reqs.get(id)).filter(shown);
    const end = Math.max(t0 + 0.001, ...order.map((id) => { const r = reqs.get(id); return r.end || r.start; }));
    const span = end - t0;
    const html = list.slice(-2000).map((r) => {
      const name = fileOf(r.url) + (r.url.includes('?') ? '?' : '');
      const status = r.blocked ? 'blocked' : r.failed ? (r.canceled ? '(canceled)' : '(failed)') : r.status ?? 'pending';
      const left = ((r.start - t0) / span) * 100;
      const width = Math.max(0.3, (((r.end || end) - r.start) / span) * 100);
      const cls = `${r.blocked ? ' blocked' : ''}${r.failed && !r.blocked ? ' failed' : ''}${selected === r.id ? ' sel' : ''}`;
      return `<div class="net-row${cls}" data-id="${esc(r.id)}" title="${esc(r.url)}">
        <span class="name">${esc(name)}</span>
        <span${r.status >= 400 ? ' style="color:#d93025"' : ''}>${esc(status)}</span>
        <span class="muted">${esc((r.type || '').toLowerCase())}</span>
        <span class="muted">${r.cached ? '(cache)' : esc(size(r.size))}</span>
        <span class="muted">${r.end ? esc(ms(r.end - r.start)) : ''}</span>
        <span class="wf"><i class="${r.blocked ? 'blocked' : r.end ? '' : 'pending'}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></i></span>
      </div>`;
    }).join('');
    const stick = rows.scrollTop + rows.clientHeight >= rows.scrollHeight - 30;
    rows.innerHTML = html;
    if (stick) rows.scrollTop = rows.scrollHeight;
    const all = order.map((id) => reqs.get(id));
    const bytes = all.reduce((n, r) => n + (r.size || 0), 0);
    const blocked = all.filter((r) => r.blocked).length;
    $('#net-status').innerHTML = `<span>${list.length} / ${all.length} requests</span><span>${esc(size(bytes))} transferred</span>${blocked ? `<span style="color:var(--accent)">${blocked} blocked by Shield</span>` : ''}${all.length ? `<span>Finish: ${esc(ms(span))}</span>` : ''}`;
  }

  on('Network.requestWillBeSent', (p) => {
    if (!t0) t0 = p.timestamp;
    const prev = reqs.get(p.requestId);
    if (prev && p.redirectResponse) {
      // A redirect: keep the hop as its own row.
      const hop = { ...prev, id: `${prev.id}:${order.length}`, status: p.redirectResponse.status, end: p.timestamp };
      reqs.set(hop.id, hop);
      order.splice(order.indexOf(prev.id), 0, hop.id);
    }
    reqs.set(p.requestId, {
      id: p.requestId, url: p.request.url, method: p.request.method, type: p.type, start: p.timestamp,
      reqHeaders: p.request.headers, postData: p.request.postData, initiator: p.initiator && p.initiator.type,
    });
    if (!prev) order.push(p.requestId);
    schedule();
  });
  on('Network.responseReceived', (p) => {
    const r = reqs.get(p.requestId);
    if (!r) return;
    Object.assign(r, {
      status: p.response.status, statusText: p.response.statusText, mime: p.response.mimeType,
      resHeaders: p.response.headers, remote: p.response.remoteIPAddress, protocol: p.response.protocol,
      cached: p.response.fromDiskCache || p.response.fromServiceWorker, type: r.type || p.type,
    });
    if (p.response.status === 403 && /Seoran Shield/.test(p.response.statusText || '')) r.blocked = true;
    schedule();
  });
  on('Network.requestServedFromCache', (p) => { const r = reqs.get(p.requestId); if (r) r.cached = true; });
  on('Network.loadingFinished', (p) => {
    const r = reqs.get(p.requestId);
    if (!r) return;
    r.end = p.timestamp;
    r.size = p.encodedDataLength;
    schedule();
    if (selected === p.requestId) detail();
  });
  on('Network.loadingFailed', (p) => {
    const r = reqs.get(p.requestId);
    if (!r) return;
    Object.assign(r, { end: p.timestamp, failed: true, canceled: p.canceled, errorText: p.errorText, blockedReason: p.blockedReason });
    schedule();
  });
  on('Network.webSocketCreated', (p) => {
    reqs.set(p.requestId, { id: p.requestId, url: p.url, type: 'WebSocket', start: t0 || 0, status: 101 });
    order.push(p.requestId);
    schedule();
  });
  on('Page.frameNavigated', ({ frame: f }) => {
    if (!f.parentId && !$('#net-preserve').checked) {
      // Keep the document request that started this navigation.
      const doc = order.map((id) => reqs.get(id)).reverse().find((r) => r.type === 'Document' && r.url === f.url);
      reset(false);
      if (doc) { reqs.set(doc.id, doc); order.push(doc.id); t0 = doc.start; schedule(); }
    }
  });

  function headersTable(obj) {
    return Object.entries(obj || {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `<div class="kv"><span class="t-key">${esc(k)}</span><span>${esc(v)}</span></div>`).join('') || '<div class="empty">None</div>';
  }

  async function detail() {
    const r = reqs.get(selected);
    const body = $('#net-body');
    if (!r) { $('#net-side').hidden = true; return; }
    $('#net-side').hidden = false;
    for (const b of $$('#net-tabs button[data-sub]')) b.classList.toggle('on', b.dataset.sub === sub);
    if (sub === 'headers') {
      body.innerHTML = `
        <div class="hsec"><h4>General</h4>
          <div class="kv"><span class="t-key">URL</span><span>${esc(r.url)}</span></div>
          <div class="kv"><span class="t-key">Method</span><span>${esc(r.method || 'GET')}</span></div>
          <div class="kv"><span class="t-key">Status</span><span>${r.blocked ? 'Blocked by Seoran Shield' : esc(`${r.status ?? ''} ${r.statusText ?? ''}`)}${r.errorText ? ` · ${esc(r.errorText)}` : ''}</span></div>
          ${r.remote ? `<div class="kv"><span class="t-key">Remote address</span><span>${esc(r.remote)}</span></div>` : ''}
          ${r.protocol ? `<div class="kv"><span class="t-key">Protocol</span><span>${esc(r.protocol)}</span></div>` : ''}
          ${r.initiator ? `<div class="kv"><span class="t-key">Initiator</span><span>${esc(r.initiator)}</span></div>` : ''}
        </div>
        <div class="hsec"><h4>Response headers</h4>${headersTable(r.resHeaders)}</div>
        <div class="hsec"><h4>Request headers</h4>${headersTable(r.reqHeaders)}</div>
        ${r.postData ? `<div class="hsec"><h4>Request body</h4><pre class="body">${esc(r.postData)}</pre></div>` : ''}`;
      return;
    }
    if (r.blocked || r.failed) { body.innerHTML = '<div class="empty">No response: the request did not complete.</div>'; return; }
    if (!r.end) { body.innerHTML = '<div class="empty">Still loading…</div>'; return; }
    body.innerHTML = '<div class="empty">Loading…</div>';
    const res = await quiet(cdp('Network.getResponseBody', { requestId: r.id }));
    if (selected !== r.id) return;
    if (!res) { body.innerHTML = '<div class="empty">The response body is no longer available.</div>'; return; }
    if (res.base64Encoded && /^image\//.test(r.mime || '')) {
      body.innerHTML = `<img class="preview-img" src="data:${esc(r.mime)};base64,${res.body}" alt="">`;
      return;
    }
    let text = res.base64Encoded ? '(binary data)' : res.body;
    if (/json/.test(r.mime || '')) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch {} }
    body.innerHTML = `<pre class="body">${esc(short(text, 400000))}</pre>`;
  }

  rows.addEventListener('click', (e) => {
    const row = e.target.closest('.net-row');
    if (!row) return;
    selected = row.dataset.id;
    render();
    detail();
  });
  $('#net-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-sub]'); if (b) { sub = b.dataset.sub; detail(); } });
  $('#net-close').addEventListener('click', () => { selected = null; $('#net-side').hidden = true; render(); });
  $('#net-clear').addEventListener('click', () => reset(false));
  $('#net-filter').addEventListener('input', schedule);
  $('#net-types').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    type = b.dataset.type;
    for (const x of $$('#net-types button')) x.classList.toggle('on', x === b);
    schedule();
  });

  function reset() {
    reqs.clear();
    order = [];
    t0 = 0;
    selected = null;
    $('#net-side').hidden = true;
    schedule();
  }
  return { reset };
})();

// ---- elements ---------------------------------------------------------------------
const elementsView = (() => {
  const tree = $('#dom');
  const nodes = new Map(); // nodeId -> node (with .parentId, .children ids)
  const open = new Set();
  let root = null;
  let selected = null;
  let sub = 'styles';
  let frame = 0;
  let picking = false;

  function register(node, parentId) {
    node.parentId = parentId;
    nodes.set(node.nodeId, node);
    if (node.children) {
      node.children = node.children.map((c) => { register(c, node.nodeId); return c.nodeId; });
    }
    for (const c of [...(node.shadowRoots || []), ...(node.contentDocument ? [node.contentDocument] : [])]) register(c, node.nodeId);
    if (node.shadowRoots || node.contentDocument) {
      node.children = [...(node.contentDocument ? [node.contentDocument.nodeId] : []), ...(node.shadowRoots || []).map((s) => s.nodeId), ...(node.children || [])];
    }
  }

  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); };

  function attrsHtml(n) {
    const a = n.attributes || [];
    let s = '';
    for (let i = 0; i < a.length; i += 2) {
      s += ` <span class="t-attr">${esc(a[i])}</span>${a[i + 1] !== '' ? `=<span class="t-val">"${esc(short(a[i + 1], 140))}"</span>` : ''}`;
    }
    return s;
  }

  function line(n, depth, out) {
    const pad = depth * 14;
    const kids = n.children || [];
    const has = kids.length > 0 || n.childNodeCount > 0;
    const isOpen = open.has(n.nodeId);
    const sel = n.nodeId === selected ? ' sel' : '';
    const tw = has ? `<span class="tw">${isOpen ? '▼' : '▶'}</span>` : '<span class="tw"></span>';
    let body;
    switch (n.nodeType) {
      case 1: {
        const tag = n.localName || n.nodeName.toLowerCase();
        const onlyText = kids.length === 1 && nodes.get(kids[0])?.nodeType === 3 && nodes.get(kids[0]).nodeValue.length < 80;
        if (onlyText && !isOpen) {
          body = `<span class="t-tag">&lt;${esc(tag)}</span>${attrsHtml(n)}<span class="t-tag">&gt;</span>${esc(nodes.get(kids[0]).nodeValue)}<span class="t-tag">&lt;/${esc(tag)}&gt;</span>`;
          out.push(`<div class="dn${sel}" data-id="${n.nodeId}" style="padding-left:${pad}px"><span class="tw"></span><span>${body}</span></div>`);
          return;
        }
        body = `<span class="t-tag">&lt;${esc(tag)}</span>${attrsHtml(n)}<span class="t-tag">&gt;</span>${has && !isOpen ? `<span class="t-null">…</span><span class="t-tag">&lt;/${esc(tag)}&gt;</span>` : ''}`;
        break;
      }
      case 3: {
        const v = n.nodeValue.trim();
        if (!v) return;
        body = `"${esc(short(v, 200))}"`;
        break;
      }
      case 8: body = `<span class="t-com">&lt;!--${esc(short(n.nodeValue, 120))}--&gt;</span>`; break;
      case 10: body = `<span class="t-com">&lt;!DOCTYPE ${esc(n.nodeName)}&gt;</span>`; break;
      case 11: body = `<span class="t-com">#shadow-root${n.shadowRootType ? ` (${esc(n.shadowRootType)})` : ''}</span>`; break;
      case 9: body = '<span class="t-com">#document</span>'; break;
      default: body = esc(n.nodeName);
    }
    out.push(`<div class="dn${sel}" data-id="${n.nodeId}" style="padding-left:${pad}px">${tw}<span>${body}</span></div>`);
    if (isOpen) {
      for (const id of kids) { const c = nodes.get(id); if (c) line(c, depth + 1, out); }
      if (n.nodeType === 1 && has) {
        out.push(`<div class="dn" data-id="${n.nodeId}" style="padding-left:${pad}px"><span class="tw"></span><span class="t-tag">&lt;/${esc(n.localName || n.nodeName.toLowerCase())}&gt;</span></div>`);
      }
    }
  }

  function render() {
    if (!root) { tree.innerHTML = '<div class="empty">Loading…</div>'; return; }
    const out = [];
    for (const id of root.children || []) { const c = nodes.get(id); if (c) line(c, 0, out); }
    const top = tree.scrollTop;
    tree.innerHTML = out.join('');
    tree.scrollTop = top;
    crumbs();
  }

  function crumbs() {
    const path = [];
    let n = nodes.get(selected);
    while (n && n.nodeType === 1) { path.unshift(n); n = nodes.get(n.parentId); }
    $('#crumbs').innerHTML = path.map((x) => {
      const id = (x.attributes || []).reduce((acc, v, i, a) => (i % 2 === 0 && v === 'id' ? `#${a[i + 1]}` : acc), '');
      return `<span data-id="${x.nodeId}">${esc(x.localName)}${esc(id)}</span>`;
    }).join(' › ');
  }

  async function load() {
    nodes.clear();
    root = null;
    render();
    const r = await quiet(cdp('DOM.getDocument', { depth: 3, pierce: false }));
    if (!r) { tree.innerHTML = '<div class="empty">Could not read the page.</div>'; return; }
    register(r.root, 0);
    root = r.root;
    const html = (root.children || []).map((id) => nodes.get(id)).find((n) => n && n.localName === 'html');
    if (html) {
      open.add(html.nodeId);
      const body = (html.children || []).map((id) => nodes.get(id)).find((n) => n && n.localName === 'body');
      if (body) { open.add(body.nodeId); await expand(body.nodeId); }
    }
    render();
  }

  async function expand(id) {
    const n = nodes.get(id);
    if (!n) return;
    open.add(id);
    if (!n.children && n.childNodeCount) await quiet(cdp('DOM.requestChildNodes', { nodeId: id, depth: 1 }));
    schedule();
  }

  on('DOM.setChildNodes', ({ parentId, nodes: list }) => {
    const p = nodes.get(parentId);
    if (!p) return;
    p.children = list.map((c) => { register(c, parentId); return c.nodeId; });
    schedule();
  });
  on('DOM.childNodeInserted', ({ parentNodeId, previousNodeId, node }) => {
    const p = nodes.get(parentNodeId);
    if (!p) return;
    register(node, parentNodeId);
    p.children = p.children || [];
    const at = previousNodeId ? p.children.indexOf(previousNodeId) + 1 : 0;
    p.children.splice(at, 0, node.nodeId);
    p.childNodeCount = p.children.length;
    schedule();
  });
  on('DOM.childNodeRemoved', ({ parentNodeId, nodeId }) => {
    const p = nodes.get(parentNodeId);
    if (p && p.children) { p.children = p.children.filter((x) => x !== nodeId); p.childNodeCount = p.children.length; }
    nodes.delete(nodeId);
    if (selected === nodeId) selected = null;
    schedule();
  });
  on('DOM.attributeModified', ({ nodeId, name, value }) => {
    const n = nodes.get(nodeId);
    if (!n) return;
    const a = n.attributes || (n.attributes = []);
    const i = a.findIndex((v, k) => k % 2 === 0 && v === name);
    if (i >= 0) a[i + 1] = value; else a.push(name, value);
    schedule();
  });
  on('DOM.attributeRemoved', ({ nodeId, name }) => {
    const n = nodes.get(nodeId);
    if (!n || !n.attributes) return;
    const i = n.attributes.findIndex((v, k) => k % 2 === 0 && v === name);
    if (i >= 0) n.attributes.splice(i, 2);
    schedule();
  });
  on('DOM.characterDataModified', ({ nodeId, characterData }) => { const n = nodes.get(nodeId); if (n) { n.nodeValue = characterData; schedule(); } });
  on('DOM.childNodeCountUpdated', ({ nodeId, childNodeCount }) => { const n = nodes.get(nodeId); if (n) { n.childNodeCount = childNodeCount; schedule(); } });
  on('DOM.documentUpdated', () => { clearTimeout(load.t); load.t = setTimeout(load, 150); });

  tree.addEventListener('click', (e) => {
    const row = e.target.closest('.dn');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (e.target.classList.contains('tw')) {
      if (open.has(id)) { open.delete(id); schedule(); } else expand(id);
      return;
    }
    choose(id);
  });
  tree.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.dn');
    if (!row) return;
    const id = Number(row.dataset.id);
    if (open.has(id)) { open.delete(id); schedule(); } else expand(id);
  });
  tree.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.dn');
    const id = row ? Number(row.dataset.id) : 0;
    if (id === tree._hover) return;
    tree._hover = id;
    if (id) quiet(cdp('Overlay.highlightNode', { nodeId: id, highlightConfig: HIGHLIGHT }));
  });
  tree.addEventListener('mouseleave', () => { tree._hover = 0; quiet(cdp('Overlay.hideHighlight')); });
  tree.addEventListener('keydown', (e) => {
    if (!selected) return;
    const n = nodes.get(selected);
    if (e.key === 'ArrowRight') { e.preventDefault(); expand(selected); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (open.has(selected)) { open.delete(selected); schedule(); } else if (n && nodes.get(n.parentId)?.nodeType === 1) choose(n.parentId); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ids = $$('.dn', tree).map((r) => Number(r.dataset.id));
      const i = ids.indexOf(selected);
      const next = ids[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) choose(next);
    } else if (e.key === 'Delete' && n && n.nodeType === 1) {
      e.preventDefault();
      quiet(cdp('DOM.removeNode', { nodeId: selected }));
    } else if (e.key === 'h' && n && n.nodeType === 1) {
      // Toggle visibility, like Chrome's "h".
      quiet(cdp('DOM.resolveNode', { nodeId: selected })).then((r) => r && quiet(cdp('Runtime.callFunctionOn', {
        objectId: r.object.objectId,
        functionDeclaration: 'function(){this.style.visibility = this.style.visibility === "hidden" ? "" : "hidden";}',
      })));
    }
  });
  $('#crumbs').addEventListener('click', (e) => { const s = e.target.closest('span[data-id]'); if (s) revealNode(Number(s.dataset.id)); });

  function choose(id) {
    selected = id;
    render();
    $(`.dn[data-id="${id}"]`, tree)?.scrollIntoView({ block: 'nearest' });
    side();
    // $0 in the console refers to the selected element, as in Chrome.
    quiet(cdp('DOM.setInspectedNode', { nodeId: id }));
  }

  async function revealNode(id) {
    let n = nodes.get(id);
    if (!n) return;
    for (let p = nodes.get(n.parentId); p; p = nodes.get(p.parentId)) open.add(p.nodeId);
    choose(id);
    tree.focus();
  }

  async function revealBackend(backendNodeId) {
    const r = await quiet(cdp('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] }));
    const id = r && r.nodeIds && r.nodeIds[0];
    if (id) { select('elements'); revealNode(id); }
  }

  async function pick(onOff) {
    picking = onOff;
    $('#pick').classList.toggle('on', onOff);
    if (onOff) select('elements');
    await quiet(cdp('Overlay.setInspectMode', { mode: onOff ? 'searchForNode' : 'none', highlightConfig: HIGHLIGHT }));
  }
  on('Overlay.inspectNodeRequested', ({ backendNodeId }) => { pick(false); revealBackend(backendNodeId); });

  async function inspectAt({ x, y }) {
    // The engine reports device pixels; the protocol wants CSS pixels.
    const m = await quiet(cdp('Runtime.evaluate', { expression: 'devicePixelRatio', returnByValue: true }));
    const dpr = (m && m.result && m.result.value) || 1;
    for (let i = 0; i < 20 && !root; i++) await new Promise((r) => setTimeout(r, 50));
    const r = await quiet(cdp('DOM.getNodeForLocation', { x: Math.round(x / dpr), y: Math.round(y / dpr), includeUserAgentShadowDOM: false, ignorePointerEventsNone: true }));
    if (r) revealBackend(r.backendNodeId);
  }

  // Side panel: styles, computed, box model.
  async function side() {
    for (const b of $$('#el-tabs button')) b.classList.toggle('on', b.dataset.sub === sub);
    const body = $('#el-body');
    const n = nodes.get(selected);
    $('#style-filter').parentNode.hidden = sub === 'box';
    if (!n || n.nodeType !== 1) { body.innerHTML = '<div class="empty">Select an element.</div>'; return; }
    const id = selected;
    const q = $('#style-filter').value.trim().toLowerCase();
    const match = (s) => !q || s.toLowerCase().includes(q);
    if (sub === 'computed') {
      const r = await quiet(cdp('CSS.getComputedStyleForNode', { nodeId: id }));
      if (id !== selected) return;
      body.innerHTML = r ? r.computedStyle.filter((p) => match(p.name) || match(p.value))
        .map((p) => `<div class="kv"><span class="t-key">${esc(p.name)}</span><span>${esc(p.value)}</span></div>`).join('') : '<div class="empty">Unavailable.</div>';
      return;
    }
    if (sub === 'box') {
      const r = await quiet(cdp('DOM.getBoxModel', { nodeId: id }));
      if (id !== selected) return;
      if (!r) { body.innerHTML = '<div class="empty">This element is not rendered.</div>'; return; }
      const m = r.model;
      const d = (a, b, i) => Math.round(Math.abs(a[i] - b[i]));
      const edges = (outer, inner) => ({ t: d(inner, outer, 1), r: d(outer, inner, 2), b: d(outer, inner, 5), l: d(inner, outer, 0) });
      const mg = edges(m.margin, m.border);
      const bd = edges(m.border, m.padding);
      const pd = edges(m.padding, m.content);
      const ring = (cls, label, e, inner) => `<div class="${cls}"><span class="lbl">${label}</span><span class="n t">${e.t || '–'}</span><span class="n r">${e.r || '–'}</span><span class="n b">${e.b || '–'}</span><span class="n l">${e.l || '–'}</span>${inner}</div>`;
      body.innerHTML = `<div class="box">${ring('margin', 'margin', mg, ring('border', 'border', bd, ring('padding', 'padding', pd, `<div class="content">${Math.round(m.width)} × ${Math.round(m.height)}</div>`)))}</div>`;
      return;
    }
    const r = await quiet(cdp('CSS.getMatchedStylesForNode', { nodeId: id }));
    if (id !== selected) return;
    if (!r) { body.innerHTML = '<div class="empty">Unavailable.</div>'; return; }
    const block = (selector, origin, props, ua) => {
      // Show what the author wrote; the engine also lists every longhand a
      // shorthand expands to (without source text), which would repeat.
      const authored = (props || []).some((p) => p.text);
      const list = (props || []).filter((p) => (authored ? p.text : !p.implicit) && p.value !== undefined && (match(p.name) || match(p.value) || match(selector)));
      if (!list.length) return '';
      return `<div class="rule${ua ? ' ua' : ''}"><div class="sel-text mono"><span>${esc(selector)} {</span><span class="origin">${esc(origin)}</span></div>
        ${list.map((p) => `<div class="prop mono${p.disabled ? ' off' : ''}"><span class="t-key">${esc(p.name)}</span>: ${esc(p.value)}${p.important ? ' !important' : ''};</div>`).join('')}
        <div class="mono">}</div></div>`;
    };
    let html = '';
    if (r.inlineStyle) html += block('element.style', '', r.inlineStyle.cssProperties);
    for (const m of [...(r.matchedCSSRules || [])].reverse()) {
      const rule = m.rule;
      const origin = rule.origin === 'user-agent' ? 'user agent stylesheet' : rule.origin === 'injected' ? 'injected' : rule.styleSheetId ? 'stylesheet' : '';
      html += block(rule.selectorList.text, origin, rule.style.cssProperties, rule.origin === 'user-agent');
    }
    for (const inh of r.inherited || []) {
      const rules = (inh.matchedCSSRules || []).filter((m) => m.rule.origin !== 'user-agent');
      const inherited = rules.map((m) => block(m.rule.selectorList.text, 'inherited', m.rule.style.cssProperties.filter((p) => INHERITED.has(p.name)))).join('');
      if (inherited) html += inherited;
    }
    body.innerHTML = html || '<div class="empty">No matching rules.</div>';
  }
  const INHERITED = new Set(['color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'visibility', 'white-space', 'word-spacing', 'cursor', 'direction', 'list-style', 'quotes']);

  $('#el-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { sub = b.dataset.sub; side(); } });
  $('#style-filter').addEventListener('input', () => side());

  function reset() {
    nodes.clear();
    open.clear();
    root = null;
    selected = null;
    $('#el-body').innerHTML = '<div class="empty">Select an element.</div>';
    render();
  }

  return { load, reset, pick, inspectAt, revealNode, get picking() { return picking; } };
})();

// ---- storage ----------------------------------------------------------------------
const storageView = (() => {
  let kind = 'cookies';
  let items = [];

  function table() {
    const q = $('#st-filter').value.trim().toLowerCase();
    const rows = items.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
    if (kind === 'cookies') {
      $('#st-table').innerHTML = rows.length ? `<table class="data"><thead><tr><th>Name</th><th>Value</th><th>Domain</th><th>Path</th><th>Expires</th><th style="width:60px">Size</th><th style="width:70px">HttpOnly</th><th style="width:60px">Secure</th><th style="width:70px">SameSite</th><th class="act"></th></tr></thead><tbody>${
        rows.map((c, i) => `<tr><td title="${esc(c.name)}">${esc(c.name)}</td><td title="${esc(c.value)}">${esc(c.value)}</td><td>${esc(c.domain)}</td><td>${esc(c.path)}</td><td>${c.session ? 'Session' : esc(new Date(c.expires * 1000).toISOString().slice(0, 19).replace('T', ' '))}</td><td>${c.size}</td><td>${c.httpOnly ? '✓' : ''}</td><td>${c.secure ? '✓' : ''}</td><td>${esc(c.sameSite || '')}</td><td class="act"><button data-i="${items.indexOf(c)}" title="Delete">${icon('trash', 13)}</button></td></tr>`).join('')
      }</tbody></table>` : '<div class="empty">No cookies for this page.</div>';
      return;
    }
    $('#st-table').innerHTML = rows.length ? `<table class="data"><thead><tr><th style="width:35%">Key</th><th>Value</th><th class="act"></th></tr></thead><tbody>${
      rows.map((r) => `<tr><td title="${esc(r[0])}">${esc(r[0])}</td><td title="${esc(short(r[1], 2000))}">${esc(short(r[1], 400))}</td><td class="act"><button data-i="${items.indexOf(r)}" title="Delete">${icon('trash', 13)}</button></td></tr>`).join('')
    }</tbody></table>` : `<div class="empty">${kind === 'local' ? 'Local' : 'Session'} storage is empty.</div>`;
  }

  const store = () => (kind === 'local' ? 'localStorage' : 'sessionStorage');

  async function load() {
    if (!target) return;
    $('#st-table').innerHTML = '<div class="empty">Loading…</div>';
    if (kind === 'cookies') {
      const r = await quiet(cdp('Network.getCookies', { urls: [target.url] }));
      items = (r && r.cookies) || [];
    } else {
      const r = await quiet(cdp('Runtime.evaluate', { expression: `JSON.stringify(Object.entries(${store()}))`, returnByValue: true }));
      try { items = JSON.parse(r.result.value); } catch { items = []; }
    }
    table();
  }

  $('#st-kinds').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    kind = b.dataset.kind;
    for (const x of $$('#st-kinds button')) x.classList.toggle('on', x === b);
    load();
  });
  $('#st-table').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    if (kind === 'cookies') await quiet(cdp('Network.deleteCookies', { name: it.name, domain: it.domain, path: it.path }));
    else await quiet(cdp('Runtime.evaluate', { expression: `${store()}.removeItem(${JSON.stringify(it[0])})` }));
    load();
  });
  $('#st-clear').addEventListener('click', async () => {
    if (kind === 'cookies') {
      for (const c of items) await quiet(cdp('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path }));
    } else {
      await quiet(cdp('Runtime.evaluate', { expression: `${store()}.clear()` }));
    }
    load();
  });
  $('#st-refresh').addEventListener('click', load);
  $('#st-filter').addEventListener('input', table);
  return { load };
})();

// ---- shield --------------------------------------------------------------------------
const shieldView = (() => {
  let timer = 0;
  function render(r) {
    clearTimeout(timer);
    if (current === 'shield') timer = setTimeout(() => send({ t: 'shield' }), 1500);
    const body = $('#sh-body');
    const blocked = r.blocked || [];
    $('#b-shield').hidden = !blocked.length;
    $('#b-shield').textContent = blocked.length;
    if (!r.url) { body.innerHTML = '<div class="empty">Nothing inspected.</div>'; return; }
    if (body.firstElementChild && body.firstElementChild.id !== 'sh-cards') body.innerHTML = '';
    const byDomain = new Map();
    for (const b of blocked) {
      let d = b.url;
      try { d = new URL(b.url).hostname; } catch {}
      byDomain.set(d, (byDomain.get(d) || 0) + 1);
    }
    const top = [...byDomain].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = top.length ? top[0][1] : 1;
    const first = blocked.length ? blocked[0].at : 0;
    // The readout persists between refreshes so its digits can roll.
    if (!$('#sh-cards')) {
      body.innerHTML = `<div id="sh-cards">
        <div class="sh-state" id="sh-state"></div>
        <div class="lcd sh-lcd">
          <div class="sh-reg"><span id="sh-n1"></span><span class="silk">blocked on this page</span></div>
          <div class="sh-reg"><span id="sh-n2"></span><span class="silk">scriptlet rules</span></div>
          <div class="sh-reg"><span id="sh-n3"></span><span class="silk">cosmetic rules</span></div>
        </div>
      </div><div id="sh-rest"></div>`;
    }
    odometer($('#sh-n1'), blocked.length);
    odometer($('#sh-n2'), (r.scriptlets || []).reduce((n, s) => n + s[1], 0));
    odometer($('#sh-n3'), r.cosmetic || 0);
    $('#sh-state').innerHTML = `<span><b>${r.site ? esc(r.site) : 'This page'}</b> ${!r.site ? "Seoran's own pages load nothing to block" : !r.enabled ? 'Shield is off on every site' : r.active ? 'Shield is on' : 'Shield is off for this site'}</span>
      ${r.site && r.enabled ? `<button class="btn" id="sh-toggle">${r.active ? 'Turn off for this site' : 'Turn on for this site'}</button>` : ''}`;
    $('#sh-rest').innerHTML = `
      ${(r.scriptlets || []).length ? `<h3 class="sec">Scriptlets</h3><div class="chips">${r.scriptlets.map(([n, c]) => `<span>${esc(n)} ×${c}</span>`).join('')}</div>` : ''}
      ${top.length ? `<h3 class="sec">Most blocked</h3><div class="bars">${top.map(([d, n]) => `<div class="bar"><span class="dom" title="${esc(d)}">${esc(d)}</span><span class="track"><span class="fill" style="display:block;width:${(n / max) * 100}%"></span></span><span class="num">${n}</span></div>`).join('')}</div>` : ''}
      <h3 class="sec">Blocked requests</h3>
      ${blocked.length ? `<table class="data"><thead><tr><th style="width:70px">Time</th><th style="width:110px">Type</th><th>URL</th></tr></thead><tbody>${
        blocked.slice().reverse().map((b) => `<tr><td>+${((b.at - first) / 1000).toFixed(2)}s</td><td>${esc(b.type)}</td><td title="${esc(b.url)}">${esc(b.url)}</td></tr>`).join('')
      }</tbody></table>` : '<div class="empty">Nothing blocked on this page yet.</div>'}
      <h3 class="sec" style="margin-top:14px">Filter lists</h3><div class="chips">${(r.lists || []).map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;
    $('#sh-toggle')?.addEventListener('click', () => { send({ t: 'shieldSite', on: !r.active }); setTimeout(() => send({ t: 'shield' }), 600); });
  }
  return { render };
})();

// ---- start -----------------------------------------------------------------------------
let saved = 'elements';
try { saved = localStorage.getItem('sd.view') || 'elements'; } catch {}
select(saved);
send({ t: 'ready' });
