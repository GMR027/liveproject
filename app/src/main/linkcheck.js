// Comprueba enlaces y recursos con HEAD (y GET si el servidor no lo admite).
const SKIP = /^(?:mailto:|tel:|javascript:|data:|blob:|about:|sms:)/i;

async function checkOne(url, timeout = 10000) {
  const t0 = Date.now();
  const attempt = async (method) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, redirect: 'follow', signal: ctl.signal,
        headers: { 'User-Agent': 'LiveProject-LinkCheck/0.1', ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) }
      });
      if (res.body) res.body.cancel().catch(() => {});
      return { status: res.status, redirected: res.redirected, finalUrl: res.url };
    } finally { clearTimeout(timer); }
  };
  try {
    let r = await attempt('HEAD');
    if (r.status === 405 || r.status === 501 || r.status === 403 || r.status === 400) r = await attempt('GET');
    return { url, ...r, ok: r.status < 400, ms: Date.now() - t0 };
  } catch (e) {
    try {
      const r = await attempt('GET');
      return { url, ...r, ok: r.status < 400, ms: Date.now() - t0 };
    } catch (e2) {
      const c = e2.cause || {};
      const code = c.code || (c.errors && c.errors[0] && c.errors[0].code) || (e2.name === 'AbortError' ? 'AbortError' : c.message || e2.message);
      const nice = { AbortError: 'Tiempo de espera agotado', ENOTFOUND: 'Dominio no encontrado', ECONNREFUSED: 'Conexión rechazada' };
      return { url, status: 0, ok: false, error: nice[code] || String(code), ms: Date.now() - t0 };
    }
  }
}

async function checkLinks(urls, onProgress) {
  const list = [...new Set(urls)].filter((u) => /^https?:/i.test(u) && !SKIP.test(u)).slice(0, 400);
  const out = [];
  let i = 0, done = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      out.push(await checkOne(u));
      onProgress && onProgress(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

module.exports = { checkLinks };
