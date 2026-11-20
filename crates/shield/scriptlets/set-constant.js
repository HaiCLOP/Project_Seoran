function setConstant(chain = '', rawValue = '') {
  if (chain === '') { return; }
  const NONE = {};
  const value = (() => {
    switch (rawValue) {
      case 'undefined': return undefined;
      case 'false': return false;
      case 'true': return true;
      case 'null': return null;
      case '': case "''": case 'emptyStr': return '';
      case '[]': case 'emptyArr': return [];
      case '{}': case 'emptyObj': return {};
      case 'noopFunc': return function () {};
      case 'trueFunc': return function () { return true; };
      case 'falseFunc': return function () { return false; };
      default: {
        const n = Number(rawValue);
        if (rawValue !== '' && !Number.isNaN(n) && Math.abs(n) <= 0x7FFF) { return n; }
        return NONE;
      }
    }
  })();
  if (value === NONE) { return; }
  const isObj = (v) => v !== null && (typeof v === 'object' || typeof v === 'function');
  const pin = (owner, prop) => {
    try {
      const d = Object.getOwnPropertyDescriptor(owner, prop);
      if (d && d.configurable === false) { return; }
      Object.defineProperty(owner, prop, {
        configurable: true,
        enumerable: d ? d.enumerable : true,
        get() { return value; },
        set() {},
      });
    } catch (e) {}
  };
  const trap = (owner, path) => {
    const dot = path.indexOf('.');
    if (dot === -1) { pin(owner, path); return; }
    const prop = path.slice(0, dot);
    const rest = path.slice(dot + 1);
    let current;
    try { current = owner[prop]; } catch (e) { return; }
    if (isObj(current)) { trap(current, rest); return; }
    try {
      const d = Object.getOwnPropertyDescriptor(owner, prop);
      if (d && d.configurable === false) { return; }
      // Another rule may already trap this property: chain to its accessor
      // so every rule on the same root object still applies.
      const prevGet = d && d.get;
      const prevSet = d && d.set;
      Object.defineProperty(owner, prop, {
        configurable: true,
        enumerable: true,
        get() { return prevGet ? prevGet.call(this) : current; },
        set(next) {
          if (prevSet) { prevSet.call(this, next); }
          current = next;
          if (isObj(next)) { trap(next, rest); }
        },
      });
    } catch (e) {}
  };
  trap(window, chain);
}
