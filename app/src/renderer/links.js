// Comprobador de enlaces y recursos: recoge enlaces, imágenes, scripts, estilos, iframes y medios de la página
// y comprueba cada URL (HEAD/GET) desde el proceso principal; además valida los anclajes #id de la propia página.

/* ======== se ejecuta DENTRO de la página ======== */
function pageCollectLinks() {
  const out = [];
  const anchors = [];
  const base = document.baseURI;
  const abs = (u) => { try { return new URL(u, base).href; } catch { return null; } };
  const label = (el) => (el.textContent || el.getAttribute('alt') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  const add = (kind, el, attr) => {
    const raw = el.getAttribute(attr);
    if (!raw || !raw.trim()) return;
    const u = abs(raw.trim());
    if (!u) return;
    out.push({ kind, url: u, raw: raw.trim(), tag: el.tagName.toLowerCase(), text: label(el) });
  };
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href').trim();
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1));
      if (id && id !== 'top' && !document.getElementById(id) && !document.getElementsByName(id).length) anchors.push({ raw: href, text: label(a) });
    } else add('enlace', a, 'href');
  });
  document.querySelectorAll('img[src]').forEach((e) => add('imagen', e, 'src'));
  document.querySelectorAll('img[srcset], source[srcset]').forEach((e) => {
    e.getAttribute('srcset').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).forEach((s) => {
      const u = abs(s); if (u) out.push({ kind: 'imagen', url: u, raw: s, tag: e.tagName.toLowerCase(), text: '' });
    });
  });
  document.querySelectorAll('script[src]').forEach((e) => add('script', e, 'src'));
  document.querySelectorAll('link[href]').forEach((e) => {
    const rel = (e.getAttribute('rel') || '').toLowerCase();
    if (/stylesheet|preload|icon|manifest|modulepreload/.test(rel)) add(/stylesheet/.test(rel) ? 'estilo' : 'recurso', e, 'href');
  });
  document.querySelectorAll('iframe[src], video[src], audio[src], source[src], embed[src], object[data]').forEach((e) => add(e.tagName === 'IFRAME' ? 'iframe' : 'medio', e, e.hasAttribute('src') ? 'src' : 'data'));
  const seen = new Set();
  const items = out.filter((i) => { const k = `${i.kind}|${i.url}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const secure = location.protocol === 'https:';
  return { page: location.href, origin: location.origin, items, anchors, mixed: secure ? items.filter((i) => i.url.startsWith('http:')).map((i) => i.url) : [] };
}

const Links = (() => {
  let ui = null;
  let getView = () => null;
  let deviceName = () => '';
  let result = null; // { page, device, at, checked[], anchors[], mixed[] }
  let filter = 'all';
  let busy = false;

  const same = (r) => result && r.url.startsWith(result.origin);

  async function run() {
    if (busy) return;
    const v = getView();
    if (!v) { ui.status.textContent = 'No hay una vista cargada.'; return; }
    busy = true; ui.btn.disabled = true;
    ui.status.textContent = 'Recogiendo enlaces…';
    try {
      const data = await v.executeJavaScript(`(${pageCollectLinks.toString()})()`);
      ui.status.textContent = `Comprobando ${data.items.length} URL…`;
      const checked = await window.liveproject.checkLinks(data.items.map((i) => i.url));
      const byUrl = new Map(checked.map((c) => [c.url, c]));
      const rows = data.items.map((i) => ({ ...i, ...(byUrl.get(i.url) || { skipped: true }) }));
      result = { page: data.page, origin: data.origin, device: deviceName(), at: Date.now(), rows, anchors: data.anchors, mixed: data.mixed };
      ui.status.textContent = `${deviceName()} · ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      ui.status.textContent = 'No se pudo analizar la página.';
    }
    busy = false; ui.btn.disabled = false;
    render();
    ui.onDone && ui.onDone();
  }

  const broken = (r) => !r.skipped && !r.ok;
  const issues = () => (result ? result.rows.filter(broken).length + result.anchors.length + result.mixed.length : 0);

  function render() {
    if (!ui) return;
    ui.list.textContent = '';
    const mk = (cls, text, parent) => { const e = document.createElement('div'); e.className = cls; e.textContent = text; (parent || ui.list).appendChild(e); return e; };
    if (!result) { mk('hint', 'Pulsa «Comprobar» para revisar enlaces, imágenes, scripts y estilos de la vista seleccionada.'); ui.badge.hidden = true; return; }
    const bad = result.rows.filter(broken);
    const redirects = result.rows.filter((r) => r.ok && r.redirected);
    const slow = result.rows.filter((r) => r.ok && r.ms > 2000);
    ui.badge.textContent = issues() || '';
    ui.badge.hidden = !issues();
    mk('links-sum', `${result.rows.length} URL · ${bad.length} rota(s) · ${result.anchors.length} anclaje(s) roto(s) · ${redirects.length} redirección(es)`);

    const section = (title, sev, list, fn) => {
      if (!list.length) return;
      mk('links-h', `${title} (${list.length})`);
      for (const x of list) {
        const d = mk(`issue sev-${sev}`, '');
        fn(d, x);
      }
    };
    const two = (d, a, b) => { const t = document.createElement('span'); t.textContent = a; const s = document.createElement('small'); s.textContent = b; d.append(t, s); };
    if (filter !== 'ok') {
      section('Rotos', 'error', bad, (d, r) => two(d, `${r.error || r.status} · ${r.kind}${r.text ? ` «${r.text}»` : ''}`, r.url));
      section('Anclajes rotos', 'error', result.anchors, (d, a) => two(d, `${a.raw} no existe en la página`, a.text ? `«${a.text}»` : ''));
      section('Contenido mixto (http en página https)', 'warning', result.mixed, (d, u) => two(d, 'Recurso inseguro', u));
      section('Redirecciones', 'notice', redirects, (d, r) => two(d, `${r.status} → ${r.finalUrl}`, r.url));
      section('Lentos (> 2 s)', 'notice', slow, (d, r) => two(d, `${r.ms} ms · ${r.kind}`, r.url));
    }
    if (filter === 'all' || filter === 'ok') {
      const okRows = result.rows.filter((r) => r.ok && !r.redirected && r.ms <= 2000);
      if (!bad.length && !result.anchors.length && filter === 'all') mk('ok links-ok', '✔ No se encontraron enlaces ni recursos rotos.');
      if (filter === 'ok') section('Correctos', 'notice', okRows, (d, r) => two(d, `${r.status} · ${r.kind}`, r.url));
    }
  }

  function init(o) {
    ui = o; getView = o.getView; deviceName = o.deviceName;
    o.btn.onclick = run;
    o.filterSel.onchange = () => { filter = o.filterSel.value; render(); };
    render();
  }

  const snapshot = () => result && {
    page: result.page, device: result.device, at: result.at, total: result.rows.length,
    broken: result.rows.filter(broken).map((r) => ({ kind: r.kind, url: r.url, status: r.status, error: r.error, text: r.text })),
    anchors: result.anchors, mixed: result.mixed,
    redirects: result.rows.filter((r) => r.ok && r.redirected).map((r) => ({ url: r.url, to: r.finalUrl, status: r.status }))
  };

  return { init, run, snapshot, issues, reset() { result = null; render(); } };
})();
