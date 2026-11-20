function jsonPruneFetchResponse(rawPrunePaths = '', rawNeedlePaths = '', ...extra) {
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
    if (!isObj(root)) { return false; }
    if (needles.length !== 0 && !needles.every((n) => has(root, n))) { return false; }
    let changed = false;
    for (const p of prunePaths) { if (has(root, p)) { del(root, p); changed = true; } }
    return changed;
  };
  const urlOf = (input) => {
    try {
      if (typeof input === 'string') { return input; }
      if (input instanceof Request) { return input.url; }
      return String(input);
    } catch (e) { return ''; }
  };
  window.fetch = new Proxy(window.fetch, {
    apply(target, thisArg, args) {
      const pending = Reflect.apply(target, thisArg, args);
      if (!matches(urlOf(args[0]))) { return pending; }
      return pending.then((resp) => resp.clone().text().then((text) => {
        let obj;
        try { obj = JSON.parse(text); } catch (e) { return resp; }
        if (!prune(obj)) { return resp; }
        const out = new Response(JSON.stringify(obj), {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
        });
        try {
          Object.defineProperties(out, {
            url: { value: resp.url },
            type: { value: resp.type },
            redirected: { value: resp.redirected },
          });
        } catch (e) {}
        return out;
      }).catch(() => resp));
    },
  });
}
