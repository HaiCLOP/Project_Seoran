// Rolling counts: a number whose changed digits roll in when it updates.
(() => {
  const fmt = (n) => Math.max(0, Math.floor(n)).toLocaleString('en-US');
  window.odometer = (el, value) => {
    const text = typeof value === 'number' ? fmt(value) : String(value);
    if (el.dataset.v === text) return;
    const prev = el.dataset.v || '';
    el.dataset.v = text;
    el.setAttribute('aria-label', text);
    el.classList.add('roll');
    if (prev.length !== text.length || !el.children.length) {
      el.innerHTML = [...text].map((c) => `<span class="cell" aria-hidden="true"><i>${c}</i></span>`).join('');
      return;
    }
    [...text].forEach((c, i) => {
      if (prev[i] === c) return;
      const cell = el.children[i];
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
