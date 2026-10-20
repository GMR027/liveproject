// Panel «Rutas»: lista las rutas disponibles del proyecto —las definidas en el código,
// las enlazadas en las páginas cargadas y las que ya has visitado— y al pulsar una la
// abre en todas las vistas (o solo en la seleccionada con Shift+clic).
// La búsqueda en el código la hace el proceso principal (src/main/routes.js).
const Routes = (() => {
  const items = new Map();   // ruta -> { path, sources[], label, file, line, param, status, error, redirect }
  const SRC = {
    archivo: { icon: '📄', label: 'Código' },
    pagina: { icon: '🔗', label: 'Página' },
    visita: { icon: '📍', label: 'Visitada' }
  };
  // Recursos estáticos: no son páginas navegables (misma lista que el escáner del proceso principal).
  const ASSET = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|css|js|mjs|cjs|json|xml|map|txt|md|woff2?|ttf|otf|eot|mp4|webm|ogv|mp3|wav|ogg|pdf|zip|gz|tar|csv|xlsx?|docx?|sql|db|sqlite3?|lock)$/i;
  const MAX_ROWS = 400;
  let ui = null;
  let used = false;     // el panel se ha abierto alguna vez
  let pending = false;  // hay proyecto abierto y faltan por buscar sus rutas
  let busy = false;
  let filter = '';

  const all = () => [...items.values()].sort((a, b) => a.path.localeCompare(b.path));

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function add(path, src, extra = {}) {
    let it = items.get(path);
    if (!it) { it = { path, sources: [], param: !!extra.param }; items.set(path, it); }
    if (!it.sources.includes(src)) it.sources.push(src);
    if (extra.file && !it.file) { it.file = extra.file; it.line = extra.line || 0; it.label = extra.label; }
    else if (!it.label && extra.label) it.label = extra.label;
    if (extra.param) it.param = true;
    return it;
  }

  // Quita una fuente (p. ej. al reexplorar el proyecto) y borra las rutas que quedan sin fuentes.
  function forget(src) {
    for (const [k, it] of items) {
      it.sources = it.sources.filter((s) => s !== src);
      if (!it.sources.length) items.delete(k);
      else if (!it.sources.includes('archivo')) { delete it.file; delete it.line; delete it.label; }
    }
  }

  function normPath(p) {
    if (!p) return null;
    if (!p.startsWith('/')) return null;
    p = p.split('#')[0].split('?')[0].replace(/\/{2,}/g, '/');
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    if (!p || p.length > 200 || ASSET.test(p)) return null;
    if (/[\s{}<>|\\^$()`*\[\]]/.test(p)) return null;
    return p;
  }

  // Normaliza una URL absoluta (navegación de una vista) manteniendo solo el mismo origen.
  function norm(href) {
    if (!href || !/^https?:/i.test(href)) return null;
    let u;
    try { u = new URL(href); } catch { return null; }
    const base = ui && ui.baseUrl();
    if (base) { try { if (u.origin !== new URL(base).origin) return null; } catch { /* sin URL base */ } }
    return normPath(u.pathname || '/');
  }

  // Se ejecuta dentro de la página: rutas del mismo origen que están enlazadas.
  function pagePaths() {
    const out = [];
    const seen = new Set();
    const addRaw = (raw) => {
      if (!raw) return;
      let u;
      try { u = new URL(raw.trim(), document.baseURI); } catch { return; }
      if (u.origin !== location.origin) return;
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (seen.has(u.pathname)) return;
      seen.add(u.pathname);
      out.push(u.pathname);
    };
    document.querySelectorAll('a[href]').forEach((a) => addRaw(a.getAttribute('href')));
    document.querySelectorAll('form[action]').forEach((f) => addRaw(f.getAttribute('action')));
    document.querySelectorAll('[data-route],[data-href],[routerlink]').forEach((e) => {
      addRaw(e.getAttribute('data-route') || e.getAttribute('data-href') || e.getAttribute('routerlink'));
    });
    return out;
  }

  /* ---------------- interfaz ---------------- */
  function render() {
    if (!ui) return;
    const list = all();
    const shown = filter
      ? list.filter((it) => it.path.toLowerCase().includes(filter)
        || (it.file || '').toLowerCase().includes(filter)
        || (it.label || '').toLowerCase().includes(filter))
      : list;
    ui.badge.textContent = list.length > 99 ? '99+' : String(list.length);
    ui.badge.hidden = !list.length;
    ui.list.textContent = '';
    if (filter) ui.status.textContent = `${shown.length} de ${list.length} ruta(s)`;

    if (!shown.length) {
      const h = el('div', 'hint', ui.list);
      if (filter) h.textContent = 'Ninguna ruta coincide con el filtro.';
      else if (busy || pending) h.textContent = 'Buscando rutas del proyecto…';
      else if (!used) h.textContent = 'Pulsa «Explorar» para buscar las rutas del proyecto (código, páginas y visitas).';
      else h.textContent = 'No se han encontrado rutas. Comprueba que el proyecto esté abierto y vuelve a pulsar «Explorar».';
      return;
    }

    for (const it of shown.slice(0, MAX_ROWS)) {
      const row = el('div', 'route-row', ui.list);
      let abs = it.path;
      try { abs = ui.abs(it.path); } catch { /* sin proyecto */ }
      row.title = `${abs}\nClic: abrir en todas las vistas · Shift+clic: solo en la vista seleccionada`;
      const top = el('div', 'route-top', row);
      el('code', 'route-path', top, it.path);
      if (it.param) el('span', 'route-tag param', top, 'parámetro');
      if (it.status) el('span', `route-tag st-${it.status < 300 ? 'ok' : it.status < 400 ? 'redir' : 'err'}`, top, String(it.status));
      else if (it.error) el('span', 'route-tag st-err', top, it.error);
      const meta = el('div', 'route-meta', row);
      it.sources.forEach((s) => {
        if (SRC[s]) el('span', `route-src src-${s}`, meta, `${SRC[s].icon} ${SRC[s].label}`);
      });
      if (it.file) el('span', 'route-file', meta, `${it.file}${it.line ? `:${it.line}` : ''}${it.label ? ` · ${it.label}` : ''}`);
      row.onclick = (e) => ui.navigate(it.path, e.shiftKey ? ui.selected() : null);
    }
    if (shown.length > MAX_ROWS) {
      el('div', 'hint', ui.list, `… y ${shown.length - MAX_ROWS} ruta(s) más. Afina el filtro para verlas.`);
    }
  }

  /* ---------------- acciones ---------------- */
  async function scan() {
    if (busy || !ui) return;
    busy = true;
    pending = false;
    ui.btn.disabled = true;
    ui.status.textContent = 'Explorando el proyecto…';
    forget('archivo');
    try {
      const r = await window.liveproject.scanRoutes();
      for (const x of r.routes || []) {
        add(x.path, 'archivo', { file: x.file, line: x.line, label: x.label, param: x.param });
      }
      ui.status.textContent = `${(r.routes || []).length} ruta(s) en el código · ${r.files} fichero(s) · ${r.ms} ms`;
    } catch {
      ui.status.textContent = 'No se pudieron buscar las rutas del proyecto.';
    }
    if (ui.pageBox.checked) await collectPage();
    busy = false;
    ui.btn.disabled = false;
    render();
  }

  async function collectFrom(f) {
    if (!f || !f.ready) return 0;
    let n = 0;
    try {
      const paths = await f.view.executeJavaScript(`(${pagePaths.toString()})()`);
      for (const p of paths || []) { const r = normPath(p); if (r) { add(r, 'pagina'); n++; } }
    } catch { /* vista sin adjuntar */ }
    if (n && ui) render();
    return n;
  }

  async function collectPage() {
    if (!ui) return;
    for (const f of ui.views()) await collectFrom(f);
  }

  async function check() {
    if (busy || !ui) return;
    const targets = all().filter((it) => !it.param);
    const skipped = all().length - targets.length;
    if (!targets.length) return;
    busy = true;
    ui.checkBtn.disabled = true;
    ui.status.textContent = `Comprobando ${targets.length} ruta(s)…`;
    try {
      const res = await window.liveproject.checkLinks(targets.map((it) => ui.abs(it.path)));
      const by = new Map(res.map((r) => [r.url, r]));
      for (const it of targets) {
        const r = by.get(ui.abs(it.path));
        if (r) { it.status = r.status; it.error = r.error; it.redirect = r.redirected ? r.finalUrl : null; }
      }
      ui.status.textContent = `${targets.length} comprobada(s)${skipped ? ` · ${skipped} con parámetros omitidas` : ''}`;
    } catch {
      ui.status.textContent = 'No se pudieron comprobar las rutas.';
    }
    busy = false;
    ui.checkBtn.disabled = false;
    render();
  }

  function show() {
    used = true;
    render();
    if (pending && !busy) scan();
  }

  function reset(root) {
    items.clear();
    filter = '';
    pending = !!root;
    busy = false;
    if (ui) {
      ui.search.value = '';
      ui.status.textContent = root ? '' : 'Sin proyecto';
      if (pending) scan();
    }
    render();
  }

  function init(o) {
    ui = o;
    o.btn.onclick = scan;
    o.checkBtn.onclick = check;
    o.clearBtn.onclick = () => { items.clear(); filter = ''; o.search.value = ''; render(); };
    o.search.oninput = () => { filter = o.search.value.trim().toLowerCase(); render(); };
    o.pageBox.onchange = () => { if (o.pageBox.checked) collectPage(); };
    render();
    if (pending) scan();
  }

  return {
    init, scan, show, reset,
    visited: (url) => { const p = norm(url); if (p) { add(p, 'visita'); if (ui && used && ui.visible()) render(); } },
    onLoaded: (f) => { if (used && ui && ui.pageBox.checked && !busy) collectFrom(f); }
  };
})();
