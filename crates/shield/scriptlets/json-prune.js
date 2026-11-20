function jsonPrune(rawPrunePaths = '', rawNeedlePaths = '') {
  const prunePaths = rawPrunePaths.split(/ +/).filter(Boolean).map((p) => p.split('.'));
  if (prunePaths.length === 0) { return; }
  const needles = rawNeedlePaths.split(/ +/).filter(Boolean).map((p) => p.split('.'));
  const isObj = (v) => v !== null && typeof v === 'object';
  const has = (obj, parts) => {
    if (parts.length === 0) { return true; }
    if (!isObj(obj)) { return false; }
    const [head, ...rest] = parts;
    if (head === '[]' || head === '[-]') {
      return Object.keys(obj).some((k) => has(obj[k], rest));
    }
    return Object.prototype.hasOwnProperty.call(obj, head) && has(obj[head], rest);
  };
  const del = (obj, parts) => {
    if (!isObj(obj) || parts.length === 0) { return; }
    const [head, ...rest] = parts;
    if (head === '[]' || head === '[-]') {
      for (const k of Object.keys(obj)) {
        if (rest.length === 0) { delete obj[k]; } else { del(obj[k], rest); }
      }
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
  JSON.parse = new Proxy(JSON.parse, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      try { prune(result); } catch (e) {}
      return result;
    },
  });
  Response.prototype.json = new Proxy(Response.prototype.json, {
    apply(target, thisArg, args) {
      return Reflect.apply(target, thisArg, args).then((result) => {
        try { prune(result); } catch (e) {}
        return result;
      });
    },
  });
}
