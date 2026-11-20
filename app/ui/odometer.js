// The odometer: a count in fixed digit cells; when it changes, only the
// digits that changed roll in. Shared by the browser UI and kite pages.
(() => {
  const fmt = (n) => Math.max(0, Math.floor(n)).toLocaleString('en-US');
  window.odometer = (el, value) => {
    const text = typeof value === 'number' ? fmt(value) : String(value);
    if (el.dataset.v === text) return;
    const prev = el.dataset.v || '';
    el.dataset.v = text;
    el.setAttribute('aria-label', text);
    el.classList.add('odo');
    // Rebuild cells only when the length changes; otherwise roll in place.
    if (prev.length !== text.length || !el.children.length) {
      el.innerHTML = [...text].map((c) =>
        /\d/.test(c) ? `<span class="cell" aria-hidden="true"><i>${c}</i></span>` : `<span class="sep" aria-hidden="true">${c}</span>`,
      ).join('');
      return;
    }
    [...text].forEach((c, i) => {
      const cell = el.children[i];
      if (!cell.classList.contains('cell') || prev[i] === c) return;
      for (const old of cell.querySelectorAll('i.out')) old.remove();
      const cur = cell.querySelector('i');
      if (cur) {
        cur.className = 'out';
        cur.addEventListener('animationend', () => cur.remove(), { once: true });
      }
      const next = document.createElement('i');
      next.className = 'in';
      next.textContent = c;
      cell.appendChild(next);
    });
  };
})();
