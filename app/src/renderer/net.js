// Panel «Red»: peticiones de todas las vistas (método, estado, tipo, tamaño, tiempo), con filtros y fallos destacados.
const Net = (() => {
  const MAX = 1500;
  const TYPE_LABEL = {
    mainFrame: 'doc', subFrame: 'iframe', stylesheet: 'css', script: 'js', image: 'img', font: 'font', xhr: 'xhr', fetch: 'fetch',
    media: 'media', webSocket: 'ws', ping: 'ping', cspReport: 'csp', other: 'otro'
  };
  const GROUPS = { all: 'Todo', doc: 'Documentos', css: 'CSS', js: 'JS', img: 'Imágenes', font: 'Fuentes', xhr: 'XHR/Fetch', other: 'Otros' };
  const groupOf = (t) => (t === 'doc' || t === 'iframe' ? 'doc' : t === 'xhr' || t === 'fetch' ? 'xhr' : GROUPS[t] ? t : 'other');

  let rows = [];       // { id, device, method, url, type, status, error, ms, size, mime, cc, enc, cache, start }
  let deviceOf = () => 'vista';
  let ui = null;
  let selected = null;
  let textFilter = '';
  let typeFilter = 'all';
  let onlyFail = false;
  let keep = false;
  let wf = false;      // vista de cascada (línea de tiempo)
  let notifyFail = () => {};
  let toast = () => {};

  const failed = (r) => !!r.error || r.status >= 400;
  const fmtSize = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
  const fmtMs = (n) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);
  const short = (u) => { try { const x = new URL(u); return (x.pathname.split('/').pop() || x.pathname) + x.search; } catch { return u; } };

  function add(batch) {
    for (const b of batch) {
      const device = deviceOf(b.wc);
      if (!device) continue;
      const r = { ...b, device, type: TYPE_LABEL[b.type] || b.type, error: b.error && b.error !== 'net::ERR_ABORTED' ? b.error.replace('net::', '') : b.error ? 'abortada' : undefined };
      if (r.error === 'abortada') continue; // cancelaciones normales (navegación, imágenes fuera de pantalla)
      rows.push(r);
      if (failed(r)) notifyFail(r);
    }
    if (rows.length > MAX) rows = rows.slice(-MAX);
    render();
  }

  function navigated(wc) {
    if (keep) return;
    const name = deviceOf(wc);
    rows = rows.filter((r) => r.device !== name);
    render();
  }

  function visible(r) {
    return (typeFilter === 'all' || groupOf(r.type) === typeFilter) && (!onlyFail || failed(r)) &&
      (!textFilter || r.url.toLowerCase().includes(textFilter) || r.device.toLowerCase().includes(textFilter));
  }

  function stats() {
    const bytes = rows.reduce((s, r) => s + (r.size || 0), 0);
    const bad = rows.filter(failed);
    const slow = [...rows].sort((a, b) => b.ms - a.ms)[0];
    return { total: rows.length, bytes, failed: bad.length, slowest: slow && { url: slow.url, ms: slow.ms } };
  }

  function render() {
    if (!ui) return;
    const st = stats();
    ui.summary.textContent = `${st.total} petición(es) · ${fmtSize(st.bytes)} (cabecera)${st.failed ? ` · ${st.failed} con fallo` : ''}`;
    ui.badge.textContent = st.failed || '';
    ui.badge.hidden = !st.failed;
    ui.list.textContent = '';
    const shown = rows.filter(visible).slice(-500).reverse();
    if (!shown.length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = rows.length ? 'Ninguna petición con este filtro.' : 'Sin peticiones. Aparecerán aquí al cargar las vistas.';
      ui.list.appendChild(h);
      return;
    }
    if (wf) { renderWf(shown); return; }
    const maxMs = Math.max(...shown.map((r) => r.ms), 1);
    for (const r of shown) ui.list.appendChild(row(r, maxMs));
  }

  /* ---------- cascada: línea de tiempo de las peticiones ---------- */
  function renderWf(shown) {
    const list = [...shown].sort((a, b) => a.start - b.start);
    const t0 = Math.min(...list.map((r) => r.start));
    const t1 = Math.max(...list.map((r) => r.start + (r.ms || 0)));
    const span = Math.max(1, t1 - t0);
    const head = document.createElement('div');
    head.className = 'net-wf-head';
    head.textContent = `${fmtMs(span)} en total · ${list.length} petición(es) · ${new Date(t0).toLocaleTimeString()}`;
    ui.list.appendChild(head);
    for (const r of list) {
      const wrap = document.createElement('div');
      wrap.className = `net-wf-row${failed(r) ? ' bad' : ''}${selected === r.id ? ' sel' : ''}`;
      const lab = document.createElement('span');
      lab.className = 'net-wf-lab';
      lab.textContent = `${r.error ? 'ERR' : r.status} ${r.method} ${short(r.url)}`;
      lab.title = `${r.url}\n${r.device} · ${fmtMs(r.ms)}`;
      const track = document.createElement('div');
      track.className = 'net-wf-track';
      const bar = document.createElement('i');
      bar.className = r.error || r.status >= 400 ? 'err' : r.status >= 300 ? 'redir' : 'ok';
      bar.style.left = `${((r.start - t0) / span) * 100}%`;
      bar.style.width = `${Math.max(0.8, ((r.ms || 0) / span) * 100)}%`;
      bar.title = `${fmtMs(r.ms)} · ${r.device}`;
      track.appendChild(bar);
      const ms = document.createElement('span');
      ms.className = 'net-wf-ms';
      ms.textContent = fmtMs(r.ms);
      wrap.append(lab, track, ms);
      wrap.onclick = () => { selected = selected === r.id ? null : r.id; render(); };
      ui.list.appendChild(wrap);
      if (selected === r.id) wrap.appendChild(detail(r));
    }
  }

  function detail(r) {
    const d = document.createElement('div');
    d.className = 'net-detail';
    const kv = [['URL', r.url], ['Vista', r.device], ['Estado', r.error ? `Fallo: ${r.error}` : String(r.status)], ['Tipo MIME', r.mime || '—'],
      ['Tamaño (Content-Length)', fmtSize(r.size)], ['Compresión', r.enc || 'ninguna'], ['Cache-Control', r.cc || '—'], ['Tiempo', fmtMs(r.ms)]];
    for (const [k, v] of kv) {
      const p = document.createElement('div');
      const b = document.createElement('b'); b.textContent = `${k}: `;
      p.append(b, document.createTextNode(v));
      d.appendChild(p);
    }
    if (r.reqH && r.reqH.length) d.appendChild(headList('Cabeceras de la petición', r.reqH));
    if (r.resH && r.resH.length) d.appendChild(headList('Cabeceras de la respuesta', r.resH));
    const copy = document.createElement('button');
    copy.textContent = 'Copiar URL';
    copy.onclick = () => navigator.clipboard.writeText(r.url);
    d.appendChild(copy);
    return d;
  }

  function headList(title, list) {
    const box = document.createElement('div');
    box.className = 'net-heads';
    const t = document.createElement('b');
    t.textContent = title;
    box.appendChild(t);
    for (const h of list.slice(0, 40)) {
      const line = document.createElement('div');
      line.textContent = `${h.name}: ${h.value}`;
      box.appendChild(line);
    }
    return box;
  }

  function row(r, maxMs) {
    const wrap = document.createElement('div');
    wrap.className = `net-row${failed(r) ? ' bad' : ''}${selected === r.id ? ' sel' : ''}`;
    const line = document.createElement('div');
    line.className = 'net-line';
    const cell = (cls, text, title) => { const c = document.createElement('span'); c.className = cls; c.textContent = text; if (title) c.title = title; line.appendChild(c); return c; };
    const sc = cell(`net-st ${r.error ? 'err' : r.status >= 400 ? 'err' : r.status >= 300 ? 'redir' : 'ok'}`, r.error ? 'ERR' : String(r.status));
    sc.title = r.error || '';
    cell('net-m', r.method);
    cell('net-name', short(r.url), r.url);
    cell('net-type', r.type);
    cell('net-size', r.cache ? 'caché' : fmtSize(r.size));
    const t = cell('net-ms', fmtMs(r.ms));
    const bar = document.createElement('i');
    bar.style.width = `${Math.max(3, (r.ms / maxMs) * 100)}%`;
    t.appendChild(bar);
    wrap.appendChild(line);
    line.onclick = () => { selected = selected === r.id ? null : r.id; render(); };
    if (selected === r.id) {
      wrap.appendChild(detail(r));
    }
    return wrap;
  }

  /* ---------- exportación HAR ---------- */
  const queryOf = (url) => {
    try {
      const u = new URL(url);
      return [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
    } catch { return []; }
  };
  function har() {
    const entries = rows.map((r) => ({
      startedDateTime: new Date(r.start).toISOString(),
      time: r.ms || 0,
      request: {
        method: r.method, url: r.url, httpVersion: 'HTTP/1.1', cookies: [],
        headers: r.reqH || [], queryString: queryOf(r.url), headersSize: -1, bodySize: 0
      },
      response: {
        status: r.status || 0, statusText: '', httpVersion: 'HTTP/1.1', cookies: [],
        headers: r.resH && r.resH.length ? r.resH : [
          { name: 'Content-Type', value: r.mime || '' },
          { name: 'Content-Length', value: r.size == null ? '' : String(r.size) },
          ...(r.cc ? [{ name: 'Cache-Control', value: r.cc }] : []),
          ...(r.enc ? [{ name: 'Content-Encoding', value: r.enc }] : [])
        ],
        content: { size: r.size || 0, mimeType: r.mime || '' },
        redirectURL: '', headersSize: -1, bodySize: r.size || 0
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: r.ms || 0, receive: 0, ssl: -1 },
      _device: r.device, _type: r.type, _error: r.error || null, _cache: !!r.cache
    }));
    return { log: { version: '1.2', creator: { name: 'LiveProject', version: '1' }, pages: [], entries } };
  }

  async function exportHar() {
    if (!rows.length) return toast('No hay peticiones que exportar');
    const r = await window.liveproject.saveHar(har());
    toast(`HAR guardado en ${r.dir}`);
  }

  function init(o) {
    ui = o;
    deviceOf = o.deviceOf;
    notifyFail = o.onFail;
    toast = o.toast || toast;
    for (const [v, l] of Object.entries(GROUPS)) { const op = document.createElement('option'); op.value = v; op.textContent = l; o.typeSel.appendChild(op); }
    o.typeSel.onchange = () => { typeFilter = o.typeSel.value; render(); };
    o.search.oninput = () => { textFilter = o.search.value.trim().toLowerCase(); render(); };
    o.failBox.onchange = () => { onlyFail = o.failBox.checked; render(); };
    o.keepBox.onchange = () => { keep = o.keepBox.checked; };
    o.clearBtn.onclick = () => { rows = []; selected = null; render(); };
    if (o.wfBtn) o.wfBtn.onclick = () => { wf = !wf; o.wfBtn.classList.toggle('active', wf); o.wfBtn.textContent = wf ? 'Lista' : 'Cascada'; render(); };
    if (o.harBtn) o.harBtn.onclick = exportHar;
    render();
  }

  const snapshot = () => ({
    ...stats(),
    failed: rows.filter(failed).slice(-100).map((r) => ({ device: r.device, method: r.method, url: r.url, status: r.status, error: r.error, type: r.type })),
    slow: [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10).map((r) => ({ device: r.device, url: r.url, ms: r.ms, size: r.size })),
    heavy: [...rows].filter((r) => r.size).sort((a, b) => b.size - a.size).slice(0, 10).map((r) => ({ device: r.device, url: r.url, size: r.size }))
  });

  return { init, add, navigated, snapshot, har, reset() { rows = []; selected = null; render(); } };
})();
