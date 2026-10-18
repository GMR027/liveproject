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
  let notifyFail = () => {};

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
    const maxMs = Math.max(...shown.map((r) => r.ms), 1);
    for (const r of shown) ui.list.appendChild(row(r, maxMs));
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
      const copy = document.createElement('button');
      copy.textContent = 'Copiar URL';
      copy.onclick = () => navigator.clipboard.writeText(r.url);
      d.appendChild(copy);
      wrap.appendChild(d);
    }
    return wrap;
  }

  function init(o) {
    ui = o;
    deviceOf = o.deviceOf;
    notifyFail = o.onFail;
    for (const [v, l] of Object.entries(GROUPS)) { const op = document.createElement('option'); op.value = v; op.textContent = l; o.typeSel.appendChild(op); }
    o.typeSel.onchange = () => { typeFilter = o.typeSel.value; render(); };
    o.search.oninput = () => { textFilter = o.search.value.trim().toLowerCase(); render(); };
    o.failBox.onchange = () => { onlyFail = o.failBox.checked; render(); };
    o.keepBox.onchange = () => { keep = o.keepBox.checked; };
    o.clearBtn.onclick = () => { rows = []; selected = null; render(); };
    render();
  }

  const snapshot = () => ({
    ...stats(),
    failed: rows.filter(failed).slice(-100).map((r) => ({ device: r.device, method: r.method, url: r.url, status: r.status, error: r.error, type: r.type })),
    slow: [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10).map((r) => ({ device: r.device, url: r.url, ms: r.ms, size: r.size })),
    heavy: [...rows].filter((r) => r.size).sort((a, b) => b.size - a.size).slice(0, 10).map((r) => ({ device: r.device, url: r.url, size: r.size }))
  });

  return { init, add, navigated, snapshot, reset() { rows = []; selected = null; render(); } };
})();
