function jsonPruneXhrResponse(rawPrunePaths = '', rawNeedlePaths = '', ...extra) {
  const prunePaths = rawPrunePaths.split(/ +/).filter(Boolean).map((p) => p.split('.'));
  if (prunePaths.length === 0) { return; }
  const needles = rawNeedlePaths.split(/ +/).filter(Boolean).map((p) => p.split('.'));
  const opts = {};
  for (let i = 0; i + 1 < extra.length; i += 2) { opts[extra[i]] = extra[i + 1]; }
  const toMatcher = (raw) => {
    if (!raw) { return () => true; }
    const s = raw.startsWith('url:') ? raw.slice(4) : raw;
    const m = /^\/(.+)\/([gimsuy]*)$/.exec(s);
    if (m) {
      try { const re = new RegExp(m[1], m[2]); return (u) => re.test(u); } catch (e) { return () => false; }
    }
    return (u) => u.includes(s);
  };
  const matches = toMatcher(opts.propsToMatch);
  const isObj = (v) => v !== null && typeof v === 'object';
  const has = (obj, parts) => {
    if (parts.length === 0) { return true; }
    if (!isObj(obj)) { return false; }
    const [head, ...rest] = parts;
    if (head === '[]' || head === '[-]') { return Object.keys(obj).some((k) => has(obj[k], rest)); }
    return Object.prototype.hasOwnProperty.call(obj, head) && has(obj[head], rest);
  };
  const del = (obj, parts) => {
    if (!isObj(obj) || parts.length === 0) { return; }
    const [head, ...rest] = parts;
    if (head === '[]' || head === '[-]') {
      for (const k of Object.keys(obj)) { if (rest.length === 0) { delete obj[k]; } else { del(obj[k], rest); } }
      return;
    }
    if (rest.length === 0) { delete obj[head]; return; }
    del(obj[head], rest);
  };
  const prune = (root) => {
    if (!isObj(root)) { return; }
    if (needles.length !== 0 && !needles.every((n) => has(root, n))) { return; }
    for (const p of prunePaths) { del(root, p); }
  };
  const tracked = new WeakMap();
  const proto = XMLHttpRequest.prototype;
  proto.open = new Proxy(proto.open, {
    apply(target, thisArg, args) {
      try { tracked.set(thisArg, { match: matches(String(args[1])), cache: undefined }); } catch (e) {}
      return Reflect.apply(target, thisArg, args);
    },
  });
  for (const prop of ['response', 'responseText']) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.get) { continue; }
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const raw = desc.get.call(this);
        const info = tracked.get(this);
        if (!info || !info.match || this.readyState !== 4) { return raw; }
        try {
          if (typeof raw === 'string') {
            if (info.cache === undefined) {
              const obj = JSON.parse(raw);
              prune(obj);
              info.cache = JSON.stringify(obj);
            }
            return info.cache;
          }
          if (isObj(raw)) { prune(raw); }
        } catch (e) {}
        return raw;
      },
    });
  }
}
