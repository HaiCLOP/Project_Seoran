// Injected into every top-level page. Forwards Seoran's own shortcuts to the
// shell (pages capture key events, so the shell never sees them otherwise)
// and gives internal seoran:// pages a tiny message API.
(() => {
  if (window.top !== window) return;
  const post = (msg) => {
    try { window.ipc.postMessage(JSON.stringify(msg)); } catch (e) {}
  };
  const action = (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      if (e.shiftKey) {
        if (k === 't') return 'reopen';
        if (k === 'Tab') return 'prevTab';
        return null;
      }
      if (k === 't') return 'newTab';
      if (k === 'w' || k === 'F4') return 'closeTab';
      if (k === 'l') return 'focusOmnibox';
      if (k === 'k') return 'palette';
      if (k === 'd') return 'bookmark';
      if (k === 'Tab' || k === 'PageDown') return 'nextTab';
      if (k === 'PageUp') return 'prevTab';
      if (k === ',') return 'settings';
      if (/^[1-9]$/.test(k)) return 'tab:' + k;
      return null;
    }
    if (e.altKey && !mod && k === 'd') return 'focusOmnibox';
    if (k === 'F6') return 'focusOmnibox';
    return null;
  };
  window.addEventListener('keydown', (e) => {
    const a = action(e);
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    post({ t: 'key', a });
  }, true);

  if (location.protocol === 'http:' && location.hostname.startsWith('seoran.')) {
    window.seoran = { send: post };
  }
})();
