const { session } = require('electron');

// Captura las peticiones de red de todas las vistas (<webview>) y las envía al renderer por lotes.
// Solo hay un manejador por evento en webRequest, por eso se centraliza aquí.
function startNetworkCapture(send) {
  const ses = session.fromPartition('persist:liveproject');
  const pending = new Map(); // id -> { start, method, url, type, wc, size, mime, cache, enc }
  let batch = [];
  let timer = null;

  const flush = () => { timer = null; if (batch.length) { send('net:batch', batch); batch = []; } };
  const push = (rec) => { batch.push(rec); if (!timer) timer = setTimeout(flush, 150); };
  const header = (h, name) => {
    if (!h) return '';
    const k = Object.keys(h).find((x) => x.toLowerCase() === name);
    return k ? [].concat(h[k])[0] : '';
  };
  const finish = (d, extra) => {
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    push({
      id: d.id, wc: p.wc, method: p.method, url: p.url, type: p.type, start: p.start, ms: Date.now() - p.start,
      status: d.statusCode || 0, cache: !!d.fromCache, size: p.size, mime: p.mime, cc: p.cc, enc: p.enc, ...extra
    });
  };

  ses.webRequest.onBeforeRequest((d, cb) => {
    if (d.webContentsId && !d.url.startsWith('devtools:')) {
      pending.set(d.id, { start: Date.now(), method: d.method, url: d.url, type: d.resourceType, wc: d.webContentsId });
      if (d.resourceType === 'mainFrame') send('net:nav', { wc: d.webContentsId });
    }
    cb({});
  });
  ses.webRequest.onHeadersReceived((d, cb) => {
    const p = pending.get(d.id);
    if (p) {
      const len = parseInt(header(d.responseHeaders, 'content-length'), 10);
      p.size = Number.isFinite(len) ? len : null;
      p.mime = header(d.responseHeaders, 'content-type').split(';')[0];
      p.cc = header(d.responseHeaders, 'cache-control');
      p.enc = header(d.responseHeaders, 'content-encoding');
    }
    cb({});
  });
  ses.webRequest.onCompleted((d) => finish(d, {}));
  ses.webRequest.onErrorOccurred((d) => finish(d, { error: d.error }));
  return { stop() { clearTimeout(timer); } };
}

module.exports = { startNetworkCapture };
