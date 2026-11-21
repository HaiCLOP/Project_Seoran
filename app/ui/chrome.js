// Seoran browser chrome. Renders state pushed from the Rust shell and sends
// user intent back over IPC. The shell owns all browser state.
'use strict';

const $ = (s) => document.querySelector(s);
const send = (m) => window.ipc.postMessage(JSON.stringify(m));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;
let open = null; // 'suggest' | 'shield' | 'menu' | 'palette'
let lastPanels = '[]';

// Update an element only when its content actually changes, so state
// pushes never re-create icons (that is what made the toolbar flicker).
function put(el, key, html) {
  if (el._key === key) return;
  el._key = key;
  el.innerHTML = html;
}

// ---- static icons ------------------------------------------------------
$('#newtab').innerHTML = icon('plus');
$('#back').innerHTML = icon('back');
$('#forward').innerHTML = icon('forward');
$('#reload').innerHTML = icon('reload');
$('#star').innerHTML = icon('star', 16);
$('#menu-btn').innerHTML = icon('menu', 18);
$('.pal-ic').innerHTML = icon('search', 18);

// ---- helpers -------------------------------------------------------------
const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
const POPS = ['volt', 'hot', 'sky', 'tang', 'lilac', 'mint'];
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const monogram = (title, url) => {
  const base = hostOf(url) || title || '?';
  const letter = (base.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  return `<span class="fav mono ink-${POPS[hue(base) % POPS.length]}">${esc(letter)}</span>`;
};
const prettyUrl = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

// ---- panels over the page ------------------------------------------------------
// This view covers the whole window but is clipped (a native window region)
// to the toolbar plus the rectangles reported here. The page underneath
// stays live; nothing is resized or hidden when a menu opens.
const RADIUS = 12;
function syncOverlay() {
  const rects = [];
  const add = (el, r = RADIUS) => {
    const b = el.getBoundingClientRect();
    if (b.width && b.height) rects.push([b.left, b.top, b.width, b.height, r].map((v) => Math.round(v * 100) / 100));
  };
  const panel = open && { suggest: '#suggest', shield: '#shield-pop', menu: '#menu', palette: '#palette' }[open];
  if (panel) add($(panel));
  for (const t of $('#toasts').children) add(t, 8);
  const key = JSON.stringify(rects);
  if (key === lastPanels) return;
  lastPanels = key;
  send({ t: 'panels', rects });
}

// Clicking the page moves focus out of this view: close any menu.
window.addEventListener('blur', () => {
  if (open) closePanels();
});

// ---- rendering ---------------------------------------------------------------
const tabEls = new Map();

function favicon(t) {
  if (t.internal) return '<span class="fav"><img src="/logo.svg" alt=""></span>';
  if (t.favicon) {
    return `<span class="fav"><img src="${esc(t.favicon)}" alt="" onerror="this.parentNode.outerHTML=window.__mono(${esc(JSON.stringify(t.title))},${esc(JSON.stringify(t.url))})"></span>`;
  }
  return monogram(t.title, t.url);
}
window.__mono = monogram;

// Tabs animate like a real tab strip: new tabs grow in, closed tabs
// collapse, and when the order changes every tab glides to its new slot
// (FLIP: measure, reorder, invert, play).
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let tabsBooted = false;
let dropPending = false;

function renderTabs() {
  const box = $('#tabs');
  const animate = tabsBooted && !reduceMotion.matches;
  const first = new Map();
  for (const [id, el] of tabEls) first.set(id, el.getBoundingClientRect().left);

  const seen = new Set();
  const order = [];
  let structural = dropPending;
  for (const t of S.tabs) {
    seen.add(t.id);
    let el = tabEls.get(t.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tab';
      el.setAttribute('role', 'tab');
      el.dataset.id = t.id;
      el.innerHTML = '<span class="fav-slot"></span><span class="title"></span><button class="close" tabindex="-1" aria-label="Close tab"></button>';
      el.querySelector('.close').innerHTML = icon('x', 14);
      tabEls.set(t.id, el);
      structural = true;
      if (animate) {
        el.classList.add('opening');
        el.addEventListener('animationend', () => el.classList.remove('opening'), { once: true });
      }
    }
    const favKey = `${t.internal}|${t.favicon}|${t.url}`;
    if (el.dataset.fav !== favKey) {
      el.dataset.fav = favKey;
      el.querySelector('.fav-slot').innerHTML = favicon(t);
    }
    el.querySelector('.title').textContent = t.title;
    el.title = t.sleeping ? `${t.title}\n(sleeping to save memory)` : t.title;
    el.classList.toggle('active', t.id === S.active);
    el.classList.toggle('loading', t.loading && !t.sleeping);
    el.classList.toggle('sleeping', t.sleeping && t.id !== S.active);
    el.setAttribute('aria-selected', t.id === S.active);
    order.push(el);
  }

  for (const [id, el] of tabEls) {
    if (seen.has(id)) continue;
    tabEls.delete(id);
    structural = true;
    if (!animate) { el.remove(); continue; }
    el.classList.add('closing');
    el.setAttribute('aria-hidden', 'true');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }

  const live = [...box.children].filter((el) => !el.classList.contains('closing'));
  const sameOrder = live.length === order.length && live.every((el, i) => el === order[i]);
  if (!sameOrder) {
    // A reorder: drop any collapsing tab at once so nothing jumps.
    for (const el of box.querySelectorAll('.tab.closing')) el.remove();
    for (const el of order) box.appendChild(el);
    structural = true;
  }

  if (structural) {
    dropPending = false;
    for (const el of tabEls.values()) {
      el.style.transition = 'none';
      el.style.transform = '';
    }
    if (animate) {
      for (const [id, el] of tabEls) {
        const was = first.get(id);
        if (was === undefined) continue;
        const dx = was - el.getBoundingClientRect().left;
        if (Math.abs(dx) < 1) continue;
        el.style.transform = `translateX(${dx}px)`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = 'transform 0.22s var(--ease)';
          el.style.transform = '';
        }));
      }
    }
  }
  tabsBooted = true;
  requestAnimationFrame(fitTabs);
}

function fitTabs() {
  const each = $('#tabs').clientWidth / Math.max(1, S.tabs.length);
  for (const el of tabEls.values()) el.classList.toggle('narrow', each < 76);
}
new ResizeObserver(() => S && fitTabs()).observe(document.body);

function renderToolbar() {
  $('#back').disabled = !S.canBack;
  $('#forward').disabled = !S.canForward;
  put($('#reload'), S.loading ? 'stop' : 'reload', icon(S.loading ? 'stop' : 'reload'));
  $('#reload').title = S.loading ? 'Stop (Esc)' : 'Reload (Ctrl+R)';

  const addr = $('#address');
  const focused = document.activeElement === addr;
  if (!focused) addr.value = S.internal ? S.url : prettyUrl(S.url);
  else if (!sug.editing && addr.value !== S.url) { addr.value = S.url; addr.select(); }

  if (!focused || !sug.editing) {
    const badge = $('#site-badge');
    const kind = S.internal ? 'internal' : !S.url ? 'empty' : S.secure ? 'secure' : 'insecure';
    badge.className = kind === 'secure' || kind === 'insecure' ? kind : '';
    badge.title = kind === 'secure' ? 'Secure connection' : kind === 'insecure' ? 'Not secure' : '';
    put(badge, kind, {
      internal: '<img src="/logo.svg" alt="">',
      empty: icon('search', 15),
      secure: icon('lock', 14),
      insecure: icon('warn', 14),
    }[kind]);
  }

  const star = $('#star');
  star.hidden = S.internal || !S.url;
  star.classList.toggle('on', S.bookmarked);
  put(star, S.bookmarked ? 'on' : 'off', icon(S.bookmarked ? 'starFill' : 'star', 16));

  // The shield chip: the icon, plus this page's count once anything is blocked.
  const sh = S.shield;
  const btn = $('#shield');
  const count = sh.siteActive ? sh.blocked : 0;
  btn.classList.toggle('active', sh.siteActive);
  btn.classList.toggle('counting', count > 0);
  put(btn.querySelector('.shield-ic'), sh.siteActive || !sh.site ? 'up' : 'down', icon(sh.siteActive || !sh.site ? 'shieldCheck' : 'shieldOff', 17));
  const chip = $('#shield-count');
  chip.hidden = count === 0;
  if (count) odometer(chip, count > 999 ? '999+' : count);
  const label = !sh.site ? 'Seoran Shield'
    : sh.siteActive ? `Seoran Shield: ${count} blocked on this page`
      : `Seoran Shield is off for ${sh.site}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);

  document.body.classList.toggle('maximized', S.maximized);
  put($('[data-win="max"]'), S.maximized, S.maximized ? '&#xE923;' : '&#xE922;');
  applyLook(S);

  if (open === 'shield') renderShield();
  if (open === 'menu' && $('#menu')._look !== `${S.theme}|${S.plastic}|${S.bookmarked}|${S.closedCount}`) renderMenu();
}

function applyLook({ theme, plastic }) {
  const root = document.documentElement;
  if (theme && theme !== 'system') root.dataset.theme = theme;
  else delete root.dataset.theme;
  if (plastic && plastic !== 'volt') root.dataset.signal = plastic;
  else delete root.dataset.signal;
}

function render() {
  if (!S) return;
  renderTabs();
  renderToolbar();
}

// ---- panels -----------------------------------------------------------------
function anchor(panel, el, align = 'left') {
  const r = el.getBoundingClientRect();
  const p = $(panel);
  const w = p.offsetWidth || 300;
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  p.style.left = `${left}px`;
}

function openPanel(name) {
  if (open === name) return;
  closePanels(false);
  open = name;
  if (name === 'shield') { renderShield(); $('#shield-pop').hidden = false; anchor('#shield-pop', $('#shield'), 'right'); }
  if (name === 'menu') { renderMenu(); $('#menu').hidden = false; anchor('#menu', $('#menu-btn'), 'right'); }
  if (name === 'palette') { $('#palette').hidden = false; $('#pal-q').value = ''; renderPalette(); $('#pal-q').focus(); }
  if (name === 'suggest') { $('#suggest').hidden = false; }
  requestAnimationFrame(syncOverlay);
}

function closePanels(sync = true) {
  for (const id of ['#suggest', '#shield-pop', '#menu', '#palette']) $(id).hidden = true;
  const was = open;
  open = null;
  $('#address').setAttribute('aria-expanded', 'false');
  if (sync) syncOverlay();
  return was;
}


// ---- shield popover ------------------------------------------------------------
// Brave-style shield panel: the site, the up/down switch, then the count.
function renderShield() {
  const sh = S.shield;
  const tab = S.tabs.find((t) => t.id === S.active);
  $('#sp-site').textContent = sh.site || (S.internal ? 'Seoran page' : 'This page');
  put($('#sp-fav'), `${tab && tab.favicon}|${S.internal}`, S.internal ? '<img src="/logo.svg" alt="">'
    : tab && tab.favicon ? `<img src="${esc(tab.favicon)}" alt="">` : icon('globe', 16));
  $('#sp-site-sub').textContent = !sh.site ? "Seoran's own pages load no ads or trackers"
    : !sh.enabled ? 'Shield is off on every site'
      : sh.siteActive ? 'Shield on' : 'Shield off for this site';
  const st = $('#sp-site-toggle');
  st.hidden = !sh.site || !sh.enabled;
  st.setAttribute('aria-checked', String(sh.siteActive));
  $('#sp-main').hidden = !sh.site || !sh.enabled;
  $('#sp-main').classList.toggle('off', !sh.siteActive);
  odometer($('#sp-blocked'), sh.siteActive ? sh.blocked : 0);
  $('#sp-count-label').textContent = sh.siteActive ? 'blocked on this page' : 'blocked (shield is off here)';
  const top = sh.siteActive ? sh.top || [] : [];
  put($('#sp-list'), JSON.stringify(top), top.map(([host, n]) =>
    `<li><span class="host" title="${esc(host)}">${esc(host)}</span><span class="n">${n}</span></li>`).join(''));
  $('#sp-hint').textContent = sh.siteActive
    ? 'If the page breaks, switch the shield off for this site.'
    : 'Ads and trackers load normally on this site.';
  $('#sp-global').setAttribute('aria-checked', String(sh.enabled));
  $('#sp-total').textContent = `${sh.total.toLocaleString()} blocked since install`;
  $('#sp-total').title = `${sh.lists.length} filter lists: ${sh.lists.join(', ')}`;
}

$('#sp-settings').addEventListener('click', () => { closePanels(); send({ t: 'action', a: 'settings' }); });

$('#shield').addEventListener('click', () => (open === 'shield' ? closePanels() : openPanel('shield')));
$('#sp-site-toggle').addEventListener('click', () => send({ t: 'shieldSite', on: !S.shield.siteActive }));
$('#sp-global').addEventListener('click', () => send({ t: 'shieldGlobal', on: !S.shield.enabled }));
$('#sp-update').addEventListener('click', () => { send({ t: 'updateFilters' }); closePanels(); });

// ---- menu ----------------------------------------------------------------------
const themeLabel = { system: 'System', light: 'Light', dark: 'Dark' };
// Accent colours.
const SIGNALS = [
  ['volt', 'Volt'],
  ['hot', 'Hot pink'],
  ['sky', 'Sky'],
  ['tang', 'Tangerine'],
  ['lilac', 'Lilac'],
  ['mint', 'Mint'],
];
function renderMenu() {
  const item = (a, ic, label, key = '', disabled = false) =>
    `<button class="mi" role="menuitem" data-a="${a}" ${disabled ? 'disabled' : ''}>${icon(ic)}<span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
  const current = S.plastic || 'volt';
  $('#menu')._look = `${S.theme}|${S.plastic}|${S.bookmarked}|${S.closedCount}`;
  void current;
  $('#menu').innerHTML = [
    item('newTab', 'plus', 'New tab', 'Ctrl+T'),
    item('reopen', 'undo', 'Reopen closed tab', 'Ctrl+Shift+T', !S.closedCount),
    '<div class="sep"></div>',
    item('bookmark', S.bookmarked ? 'starFill' : 'star', S.bookmarked ? 'Remove bookmark' : 'Bookmark this tab', 'Ctrl+D', S.internal),
    item('palette', 'command', 'Search tabs and commands', 'Ctrl+K'),
    '<div class="sep"></div>',
    item('theme', S.theme === 'dark' ? 'moon' : 'sun', `Appearance: ${themeLabel[S.theme] || 'System'}`),
    item('settings', 'settings', 'Settings', 'Ctrl+,'),
    item('devtools', 'code', 'Developer tools', 'F12'),
  ].join('');
}

$('#menu').addEventListener('click', (e) => {
  const sw = e.target.closest('.sig');
  if (sw) { send({ t: 'plastic', value: sw.dataset.signal }); return; }
  const b = e.target.closest('.mi');
  if (!b || b.disabled) return;
  const a = b.dataset.a;
  if (a === 'theme') { cycleTheme(); return; }
  closePanels();
  if (a === 'palette') openPanel('palette');
  else send({ t: 'action', a });
});
$('#menu-btn').addEventListener('click', () => (open === 'menu' ? closePanels() : openPanel('menu')));
$('#brand').addEventListener('click', () => (open === 'menu' ? closePanels() : openPanel('menu')));

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(S.theme) + 1) % order.length];
  send({ t: 'theme', value: next });
}

// ---- tabs: click, middle-click, drag to reorder, drag window --------------------
let drag = null;
$('#tabs').addEventListener('pointerdown', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) { if (e.button === 0) startWindowDrag(e); return; }
  if (e.target.closest('.close')) return;
  if (e.button !== 0) return;
  const id = Number(tab.dataset.id);
  if (id !== S.active) send({ t: 'activate', id });
  const tabsNow = [...$('#tabs').children].filter((el) => !el.classList.contains('closing'));
  drag = {
    id,
    el: tab,
    x0: e.clientX,
    moved: false,
    from: tabsNow.indexOf(tab),
    to: tabsNow.indexOf(tab),
    tabs: tabsNow,
    // Slot centres before anything moves.
    centres: tabsNow.map((el) => el.getBoundingClientRect().left + el.offsetWidth / 2),
  };
  tab.setPointerCapture(e.pointerId);
});

// While dragging, the other tabs slide aside to show where it will land.
$('#tabs').addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) < 5) return;
  drag.moved = true;
  drag.el.classList.add('dragging');
  drag.el.style.transition = 'none';
  drag.el.style.transform = `translateX(${dx}px)`;
  const mid = drag.centres[drag.from] + dx;
  let to = drag.centres.findIndex((c) => mid < c);
  if (to === -1) to = drag.centres.length - 1;
  else if (to > drag.from) to -= 1;
  drag.to = to;
  const w = drag.el.offsetWidth;
  drag.tabs.forEach((el, i) => {
    if (el === drag.el) return;
    let shift = 0;
    if (drag.from < to && i > drag.from && i <= to) shift = -w;
    if (drag.from > to && i >= to && i < drag.from) shift = w;
    el.style.transition = 'transform 0.18s var(--ease)';
    el.style.transform = shift ? `translateX(${shift}px)` : '';
  });
});

$('#tabs').addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return;
  d.el.classList.remove('dragging');
  if (d.to === d.from) {
    for (const el of d.tabs) {
      el.style.transition = 'transform 0.18s var(--ease)';
      el.style.transform = '';
    }
    return;
  }
  // Leave everything where it is; the next render glides tabs into place.
  dropPending = true;
  send({ t: 'moveTab', id: d.id, to: d.to });
});

$('#tabs').addEventListener('auxclick', (e) => {
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) send({ t: 'closeTab', id: Number(tab.dataset.id) });
});

$('#tabs').addEventListener('click', (e) => {
  const close = e.target.closest('.close');
  if (close) send({ t: 'closeTab', id: Number(close.closest('.tab').dataset.id) });
});

$('#tabs').addEventListener('dblclick', (e) => { if (!e.target.closest('.tab')) send({ t: 'win', a: 'max' }); });

function startWindowDrag(e) {
  if (e.detail === 2) { send({ t: 'win', a: 'max' }); return; }
  send({ t: 'win', a: 'drag' });
}
$('#drag').addEventListener('pointerdown', (e) => e.button === 0 && startWindowDrag(e));
$('#tabrow').addEventListener('pointerdown', (e) => {
  if (e.target === $('#tabrow') && e.button === 0) startWindowDrag(e);
});
$('#resize-top').addEventListener('pointerdown', () => send({ t: 'win', a: 'resizeTop' }));
for (const b of document.querySelectorAll('[data-win]')) {
  b.addEventListener('click', () => send({ t: 'win', a: b.dataset.win }));
}

// ---- toolbar ---------------------------------------------------------------------
$('#newtab').addEventListener('click', () => send({ t: 'action', a: 'newTab' }));
$('#back').addEventListener('click', () => send({ t: 'back' }));
$('#forward').addEventListener('click', () => send({ t: 'forward' }));
$('#reload').addEventListener('click', () => (S.loading ? send({ t: 'stop' }) : send({ t: 'action', a: 'reload' })));
$('#star').addEventListener('click', () => send({ t: 'action', a: 'bookmark' }));

// ---- omnibox -----------------------------------------------------------------------
const addr = $('#address');
const sug = { seq: 0, items: [], sel: 0, typed: '', editing: false };
let suggestTimer = 0;

addr.addEventListener('focus', () => {
  sug.editing = false;
  $('#omnibox').classList.add('focused');
  addr.value = S && !S.internal ? S.url : (S?.url ?? '');
  requestAnimationFrame(() => addr.select());
});

addr.addEventListener('blur', () => {
  sug.editing = false;
  $('#omnibox').classList.remove('focused');
  setTimeout(() => {
    if (document.activeElement !== addr && open === 'suggest') closePanels();
    if (S && document.activeElement !== addr) renderToolbar();
  }, 120);
});

addr.addEventListener('input', () => {
  sug.typed = addr.value;
  sug.editing = true;
  const badge = $('#site-badge');
  badge.className = '';
  badge.title = '';
  put(badge, 'typing', icon('search', 15));
  clearTimeout(suggestTimer);
  if (!addr.value.trim()) { if (open === 'suggest') closePanels(); return; }
  suggestTimer = setTimeout(() => send({ t: 'suggest', q: addr.value, seq: ++sug.seq }), 40);
});

const sgIcon = { search: 'search', url: 'globe', history: 'history', bookmark: 'star', tab: 'tab' };
function highlight(text, q) {
  const t = esc(text);
  const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return t;
  return t.replace(new RegExp(`(${words.map(esc).join('|')})`, 'ig'), '<mark>$1</mark>');
}

function renderSuggest() {
  const box = $('#suggest');
  box.innerHTML = sug.items.map((it, i) => `
    <div class="sg ${i === sug.sel ? 'sel' : ''}" role="option" data-i="${i}" aria-selected="${i === sug.sel}">
      <span class="sg-ic">${icon(sgIcon[it.kind] || 'globe', 15)}</span>
      <span class="sg-main"><span class="sg-title">${highlight(it.title, sug.typed)}</span><span class="sg-sub">${it.kind === 'history' || it.kind === 'bookmark' ? esc(prettyUrl(it.sub)) : esc(it.sub)}</span></span>
      <span class="sg-go">${icon(it.kind === 'tab' ? 'tab' : 'arrowRight', 15)}</span>
    </div>`).join('');
  const r = $('#omnibox').getBoundingClientRect();
  box.style.left = `${r.left}px`;
  box.style.width = `${r.width}px`;
}

function runSuggestion(it, newTab = false) {
  closePanels();
  addr.blur();
  if (it.kind === 'tab') send({ t: 'activate', id: it.tabId });
  else if (newTab) send({ t: 'openTab', url: it.url });
  else send({ t: 'navigate', input: it.url });
}

$('#suggest').addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.sg');
  if (!row) return;
  e.preventDefault();
  runSuggestion(sug.items[Number(row.dataset.i)], e.button === 1 || e.ctrlKey);
});

$('#omnibox').addEventListener('submit', (e) => e.preventDefault());
addr.addEventListener('keydown', (e) => {
  const listOpen = open === 'suggest' && sug.items.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!listOpen) return;
    e.preventDefault();
    const n = sug.items.length;
    sug.sel = (sug.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderSuggest();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const text = addr.value.trim();
    if (!text) return;
    if (listOpen && sug.sel > 0) runSuggestion(sug.items[sug.sel], e.altKey);
    else if (e.altKey) { closePanels(); addr.blur(); send({ t: 'openTab', url: text }); }
    else { closePanels(); addr.blur(); send({ t: 'navigate', input: text }); }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (open === 'suggest') { closePanels(); addr.value = S.internal ? S.url : S.url; addr.select(); }
    else { addr.blur(); send({ t: 'focusContent' }); }
  }
});

// ---- command palette ------------------------------------------------------------------
const pal = { items: [], sel: 0, history: [], hseq: 0 };

function commands() {
  const sh = S.shield;
  return [
    { a: 'newTab', label: 'New tab', ic: 'plus', key: 'Ctrl+T' },
    { a: 'closeTab', label: 'Close tab', ic: 'x', key: 'Ctrl+W' },
    { a: 'reopen', label: 'Reopen closed tab', ic: 'undo', key: 'Ctrl+Shift+T', off: !S.closedCount },
    { a: 'bookmark', label: S.bookmarked ? 'Remove bookmark' : 'Bookmark this page', ic: 'star', key: 'Ctrl+D', off: S.internal },
    { a: 'reload', label: 'Reload page', ic: 'reload', key: 'Ctrl+R' },
    { a: 'shieldSite', label: sh.siteActive ? `Turn shield off for ${sh.site}` : `Turn shield on for ${sh.site}`, ic: sh.siteActive ? 'shieldOff' : 'shieldCheck', off: !sh.site },
    { a: 'shieldGlobal', label: sh.enabled ? 'Turn shield off everywhere' : 'Turn shield on everywhere', ic: 'shield' },
    { a: 'updateFilters', label: 'Update shield filter lists', ic: 'download' },
    { a: 'theme', label: `Switch theme (now ${themeLabel[S.theme] || 'System'})`, ic: 'moon' },
    ...SIGNALS.filter(([id]) => id !== (S.plastic || 'volt')).map(([id, name]) => ({ a: `plastic:${id}`, label: `Accent colour: ${name}`, ic: 'swatch' })),
    { a: 'settings', label: 'Open settings', ic: 'settings', key: 'Ctrl+,' },
    { a: 'devtools', label: 'Developer tools', ic: 'code', key: 'F12' },
  ].filter((c) => !c.off);
}

// Subsequence match with a bonus for word starts. Returns -1 for no match.
function fuzzy(text, q) {
  if (!q) return 0;
  text = text.toLowerCase();
  let score = 0, ti = 0, streak = 0;
  for (const ch of q.toLowerCase()) {
    if (ch === ' ') continue;
    const at = text.indexOf(ch, ti);
    if (at === -1) return -1;
    streak = at === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (at === 0 || text[at - 1] === ' ' ? 4 : 0);
    ti = at + 1;
  }
  return score;
}

function renderPalette() {
  const q = $('#pal-q').value.trim();
  const groups = [];
  const rank = (list, f) => list.map((x) => [fuzzy(f(x), q), x]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).map(([, x]) => x);

  if (q) groups.push(['Go', [{ kind: 'go', label: q, sub: 'Search or open address', ic: 'search' }]]);
  const tabs = rank(S.tabs.filter((t) => t.id !== S.active), (t) => `${t.title} ${t.url}`).slice(0, 6)
    .map((t) => ({ kind: 'tab', id: t.id, label: t.title, sub: prettyUrl(t.url), ic: 'tab' }));
  if (tabs.length) groups.push(['Open tabs', tabs]);
  // With no query, list the core commands; accent colours show up when searched.
  const cmds = rank(commands().filter((c) => q || !c.a.startsWith('plastic:')), (c) => c.label).slice(0, q ? 6 : 11).map((c) => ({ kind: 'cmd', ...c }));
  if (cmds.length) groups.push(['Commands', cmds]);
  if (q && pal.history.length) {
    groups.push(['History', pal.history.slice(0, 6).map((h) => ({ kind: 'url', label: h.title || h.url, sub: prettyUrl(h.url), url: h.url, ic: h.bookmark ? 'star' : 'history' }))]);
  }

  pal.items = groups.flatMap(([, items]) => items);
  pal.sel = Math.min(pal.sel, Math.max(0, pal.items.length - 1));
  let i = 0;
  $('#pal-list').innerHTML = pal.items.length ? groups.map(([name, items]) => `
    <div class="pal-group">${name}</div>
    ${items.map((it) => {
      const n = i++;
      return `<div class="sg ${n === pal.sel ? 'sel' : ''}" data-i="${n}" role="option" aria-selected="${n === pal.sel}">
        <span class="sg-ic">${icon(it.ic, 15)}</span>
        <span class="sg-main"><span class="sg-title">${highlight(it.label, q)}</span>${it.sub ? `<span class="sg-sub">${esc(it.sub)}</span>` : ''}</span>
        ${it.key ? `<kbd>${it.key}</kbd>` : `<span class="sg-go">${icon('arrowRight', 15)}</span>`}
      </div>`;
    }).join('')}`).join('') : '<div class="pal-empty">No matches. Press Enter to search the web.</div>';
  $('#pal-list .sg.sel')?.scrollIntoView({ block: 'nearest' });
}

function runPalette(it) {
  closePanels();
  if (!it) return;
  if (it.kind === 'go') send({ t: 'navigate', input: it.label });
  else if (it.kind === 'tab') send({ t: 'activate', id: it.id });
  else if (it.kind === 'url') send({ t: 'navigate', input: it.url });
  else if (it.a === 'theme') cycleTheme();
  else if (it.a.startsWith('plastic:')) send({ t: 'plastic', value: it.a.slice(8) });
  else if (it.a === 'shieldSite') send({ t: 'shieldSite', on: !S.shield.siteActive });
  else if (it.a === 'shieldGlobal') send({ t: 'shieldGlobal', on: !S.shield.enabled });
  else if (it.a === 'updateFilters') send({ t: 'updateFilters' });
  else send({ t: 'action', a: it.a });
}

$('#pal-q').addEventListener('input', () => {
  pal.sel = 0;
  const q = $('#pal-q').value.trim();
  if (q) send({ t: 'history', q, seq: ++pal.hseq });
  else pal.history = [];
  renderPalette();
  syncOverlay();
});

$('#pal-q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = pal.items.length || 1;
    pal.sel = (pal.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    renderPalette();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const q = $('#pal-q').value.trim();
    runPalette(pal.items[pal.sel] || (q ? { kind: 'go', label: q } : null));
  }
});

$('#pal-list').addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.sg');
  if (row) { e.preventDefault(); runPalette(pal.items[Number(row.dataset.i)]); }
});

// ---- toasts --------------------------------------------------------------------------
function dismissToast(el) {
  el.remove();
  syncOverlay();
}

function toast({ text, action, actionLabel }) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = `toast${action ? '' : ' no-action'}`;
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button>${esc(actionLabel || 'Undo')}</button>` : ''}`;
  if (action) {
    el.querySelector('button').addEventListener('click', () => { send({ t: 'action', a: action }); dismissToast(el); });
  }
  box.appendChild(el);
  setTimeout(() => dismissToast(el), action ? 4200 : 2600);
  requestAnimationFrame(syncOverlay);
}

// ---- keyboard ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = e.ctrlKey || e.metaKey;
  // Never let the UI page reload or zoom itself.
  if ((mod && (k === 'r' || k === '+' || k === '-' || k === '=' || k === '0')) || k === 'F5') {
    e.preventDefault();
    if (k === 'r' || k === 'F5') send({ t: 'action', a: 'reload' });
    return;
  }
  if (k === 'Escape' && open && open !== 'suggest') { e.preventDefault(); closePanels(); send({ t: 'focusContent' }); return; }
  let a = null;
  if (mod && !e.altKey && !e.shiftKey) {
    a = { t: 'newTab', w: 'closeTab', l: 'focusOmnibox', k: 'palette', d: 'bookmark', Tab: 'nextTab', ',': 'settings' }[k] || null;
    if (/^[1-9]$/.test(k)) a = `tab:${k}`;
  } else if (mod && e.shiftKey && !e.altKey) {
    a = { t: 'reopen', Tab: 'prevTab' }[k] || null;
  } else if ((e.altKey && k === 'd') || k === 'F6') a = 'focusOmnibox';
  if (k === 'F12') a = 'devtools';
  if (!a) return;
  e.preventDefault();
  if (a === 'focusOmnibox') seoran.focusOmnibox();
  else if (a === 'palette') (open === 'palette' ? closePanels() : openPanel('palette'));
  else send({ t: 'action', a });
});

window.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input')) e.preventDefault();
});

// ---- API for the shell ------------------------------------------------------------------
window.seoran = {
  state(s) {
    S = s;
    render();
  },
  focusOmnibox() {
    closePanels();
    addr.focus();
    addr.select();
  },
  openPalette() {
    open === 'palette' ? closePanels() : openPanel('palette');
  },
  toast,
  suggestions({ seq, items }) {
    if (seq !== sug.seq || document.activeElement !== addr) return;
    sug.items = items;
    sug.sel = 0;
    if (!items.length) { if (open === 'suggest') closePanels(); return; }
    renderSuggest();
    if (open !== 'suggest') openPanel('suggest');
    else requestAnimationFrame(syncOverlay);
    addr.setAttribute('aria-expanded', 'true');
  },
  historyResults({ seq, items }) {
    if (seq !== pal.hseq || open !== 'palette') return;
    pal.history = items;
    renderPalette();
    requestAnimationFrame(syncOverlay);
  },
};

// Keep the clip region in step with the window and panel sizes.
new ResizeObserver(() => { lastPanels = ''; syncOverlay(); }).observe(document.documentElement);

send({ t: 'ready' });
