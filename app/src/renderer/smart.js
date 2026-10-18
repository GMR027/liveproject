// Inspector inteligente: analiza la página de una vista y la muestra de forma gráfica
// (árbol con barras de tamaño, modelo de caja, resumen, problemas de accesibilidad/responsive).

/* ======== funciones que se ejecutan DENTRO de la página (sin dependencias externas) ======== */
function pageAnalyze() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'BR']);
  const vw = window.innerWidth;
  const pathOf = (el) => {
    if (el === document.documentElement) return 'html';
    if (el === document.body) return 'body';
    const parts = [];
    for (let n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${Array.prototype.indexOf.call(n.parentElement.children, n) + 1})`);
    }
    return 'body > ' + parts.join(' > ');
  };
  const cls = (el) => (typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '');
  let budget = 1500;
  const build = (el, depth) => {
    const r = el.getBoundingClientRect();
    let txt = '';
    for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) { txt = c.textContent.trim().slice(0, 32); break; }
    const node = { t: el.tagName.toLowerCase(), id: el.id || '', c: cls(el), p: pathOf(el), w: Math.round(r.width), h: Math.round(r.height), txt, n: 0, ch: [] };
    if (depth < 16) {
      for (const child of el.children) {
        if (SKIP.has(child.tagName)) continue;
        if (budget-- <= 0) break;
        const sub = build(child, depth + 1);
        node.n += 1 + sub.n;
        node.ch.push(sub);
      }
    }
    return node;
  };

  const all = Array.from(document.querySelectorAll('body, body *')).slice(0, 4000);
  const count = (sel) => document.querySelectorAll(sel).length;
  let maxDepth = 0;
  for (const el of all) {
    let d = 0;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) d++;
    if (d > maxDepth) maxDepth = d;
  }

  // fuentes y colores
  const fonts = {}, texts = {}, bgs = {};
  for (const el of all.slice(0, 600)) {
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (fam) fonts[fam] = (fonts[fam] || 0) + 1;
    texts[cs.color] = (texts[cs.color] || 0) + 1;
    if (!/rgba\(.*,\s*0\)|transparent/.test(cs.backgroundColor)) bgs[cs.backgroundColor] = (bgs[cs.backgroundColor] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));

  // contraste
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const issues = [];
  const add = (sev, title, detail, el) => issues.push({ sev, title, detail, p: el ? pathOf(el) : '' });

  if (!document.documentElement.lang) add('warning', 'Falta el atributo lang en <html>', 'Lectores de pantalla y traductores lo necesitan.');
  if (!document.title.trim()) add('warning', 'La página no tiene <title>', '');
  if (!document.querySelector('meta[name=viewport]')) add('error', 'Falta <meta name="viewport">', 'Sin ella los móviles renderizan la página como escritorio.');
  const h1 = count('h1');
  if (h1 === 0) add('notice', 'No hay ningún <h1>', '');
  if (h1 > 1) add('notice', `Hay ${h1} elementos <h1>`, 'Se recomienda uno por página.');

  document.querySelectorAll('img').forEach((el) => {
    if (!el.hasAttribute('alt')) add('warning', 'Imagen sin atributo alt', el.getAttribute('src') || '', el);
    else if (!el.hasAttribute('width') && !el.hasAttribute('height') && issues.filter((i) => i.title.startsWith('Imagen sin tamaño')).length < 5) add('notice', 'Imagen sin width/height (provoca saltos de diseño)', el.getAttribute('src') || '', el);
  });
  document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').forEach((el) => {
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (!labelled) add('warning', 'Campo de formulario sin etiqueta', `<${el.tagName.toLowerCase()}${el.name ? ` name="${el.name}"` : ''}>`, el);
  });
  document.querySelectorAll('button, a[href]').forEach((el) => {
    if (!el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title') && !el.querySelector('img[alt]')) add('warning', `${el.tagName === 'A' ? 'Enlace' : 'Botón'} sin texto accesible`, '', el);
  });

  // desbordamiento horizontal (clave en responsive)
  const over = [];
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') over.push({ el, by: Math.round(r.right - vw) });
  }
  if (document.documentElement.scrollWidth > vw + 1) {
    add('error', `Scroll horizontal: la página mide ${document.documentElement.scrollWidth}px en una pantalla de ${vw}px`, 'Revisa los elementos que desbordan.');
  }
  over.sort((a, b) => b.by - a.by).slice(0, 8).forEach((o) => add('error', `Desborda ${o.by}px a la derecha`, `<${o.el.tagName.toLowerCase()}${o.el.id ? '#' + o.el.id : ''}>`, o.el));

  // contraste del texto
  let lowc = 0;
  for (const el of all) {
    if (lowc >= 8) break;
    const own = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    if (ratio < (big ? 3 : 4.5)) { add('warning', `Contraste bajo (${ratio.toFixed(1)}:1)`, `${cs.color} sobre ${bg.r},${bg.g},${bg.b}`, el); lowc++; }
  }
  // objetivos táctiles pequeños en pantallas estrechas
  if (vw <= 820) {
    let small = 0;
    document.querySelectorAll('a[href], button, input:not([type=hidden]), select').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (small < 6 && r.width > 0 && (r.width < 24 || r.height < 24)) { add('notice', `Objetivo táctil pequeño (${Math.round(r.width)}×${Math.round(r.height)}px)`, 'Mínimo recomendado: 24×24 (ideal 44×44).', el); small++; }
    });
  }

  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 60)
    .map((h) => ({ l: +h.tagName[1], t: h.textContent.trim().slice(0, 60), p: pathOf(h) }));

  return {
    url: location.href, title: document.title, lang: document.documentElement.lang || '',
    viewport: { w: vw, h: window.innerHeight, dpr: window.devicePixelRatio, meta: (document.querySelector('meta[name=viewport]') || {}).content || '' },
    doc: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    counts: {
      elements: document.querySelectorAll('*').length, depth: maxDepth, images: count('img'), scripts: count('script'),
      styles: count('link[rel=stylesheet], style'), links: count('a[href]'), forms: count('form'), inputs: count('input, select, textarea'),
      buttons: count('button'), iframes: count('iframe'), semantic: count('header, nav, main, section, article, aside, footer')
    },
    perf: nav ? {
      ttfb: Math.round(nav.responseStart), dom: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
      size: Math.round((nav.transferSize || 0) + res.reduce((s, r) => s + (r.transferSize || 0), 0)), requests: res.length + 1
    } : null,
    fonts: top(fonts, 5), textColors: top(texts, 6), bgColors: top(bgs, 6), headings, issues,
    tree: build(document.body, 0)
  };
}

function pageDescribe(path) {
  const el = path === 'html' ? document.documentElement : document.querySelector(path);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const px = (v) => parseFloat(v) || 0;
  const r = el.getBoundingClientRect();
  const box = (p) => ['Top', 'Right', 'Bottom', 'Left'].map((s) => px(cs[p + s]));
  const borders = ['Top', 'Right', 'Bottom', 'Left'].map((s) => px(cs['border' + s + 'Width']));
  const props = ['display', 'position', 'width', 'height', 'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color',
    'z-index', 'overflow', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'gap', 'opacity', 'cursor'];
  return {
    tag: el.tagName.toLowerCase(), id: el.id, classes: typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [],
    rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
    margin: box('margin'), padding: box('padding'), border: borders,
    content: { w: Math.round((r.width - px(cs.paddingLeft) - px(cs.paddingRight) - borders[1] - borders[3]) * 10) / 10, h: Math.round((r.height - px(cs.paddingTop) - px(cs.paddingBottom) - borders[0] - borders[2]) * 10) / 10 },
    styles: props.map((p) => [p, cs.getPropertyValue(p)]).filter(([, v]) => v && v !== 'auto' && v !== 'normal' && v !== 'none'),
    attrs: Array.from(el.attributes).slice(0, 12).map((a) => [a.name, a.value.slice(0, 80)]),
    role: el.getAttribute('role') || '', name: el.getAttribute('aria-label') || el.getAttribute('alt') || '',
    snippet: el.outerHTML.slice(0, 220)
  };
}

function pageHighlight(path) {
  let o = document.getElementById('__lp_overlay');
  if (!path) { if (o) o.remove(); return; }
  const el = path === 'html' ? document.documentElement : document.querySelector(path);
  if (!el) return;
  if (!o) {
    o = document.createElement('div');
    o.id = '__lp_overlay';
    o.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;left:0;top:0;';
    o.innerHTML = '<div data-k="m" style="position:absolute;background:rgba(246,178,107,.45)"></div><div data-k="b" style="position:absolute;background:rgba(111,168,220,.55);outline:1px solid #2b6cb0"></div>';
    document.documentElement.appendChild(o);
  }
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const m = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs['margin' + s]) || 0);
  const place = (n, x, y, w, h) => { n.style.left = x + 'px'; n.style.top = y + 'px'; n.style.width = Math.max(0, w) + 'px'; n.style.height = Math.max(0, h) + 'px'; };
  place(o.querySelector('[data-k=m]'), r.left + scrollX - m[3], r.top + scrollY - m[0], r.width + m[1] + m[3], r.height + m[0] + m[2]);
  place(o.querySelector('[data-k=b]'), r.left + scrollX, r.top + scrollY, r.width, r.height);
  if (arguments[1]) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function pagePick() {
  return new Promise((resolve) => {
    const pathOf = (el) => {
      if (el === document.documentElement) return 'html';
      if (el === document.body) return 'body';
      const parts = [];
      for (let n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
        parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${Array.prototype.indexOf.call(n.parentElement.children, n) + 1})`);
      }
      return 'body > ' + parts.join(' > ');
    };
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:rgba(111,168,220,.45);outline:2px solid #6c8cff;';
    document.documentElement.appendChild(box);
    const done = (v) => {
      document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true); box.remove(); window.__lpCancel = null; resolve(v);
    };
    const move = (e) => {
      const r = e.target.getBoundingClientRect();
      box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    };
    const click = (e) => { e.preventDefault(); e.stopPropagation(); done(pathOf(e.target)); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    window.__lpCancel = () => done(null);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  });
}

/* ======== interfaz ======== */
const Smart = (() => {
  const CAT = {
    estructura: { color: '#6c8cff', tags: 'html body div section article aside header footer nav main form ul ol li table thead tbody tr td th' },
    texto: { color: '#4cc38a', tags: 'p span h1 h2 h3 h4 h5 h6 a label strong em b i small blockquote pre code' },
    medios: { color: '#f59e0b', tags: 'img picture video audio canvas svg iframe figure' },
    formulario: { color: '#c084fc', tags: 'input button select textarea option' }
  };
  const colorOf = (tag) => { for (const c of Object.values(CAT)) if (c.tags.split(' ').includes(tag)) return c.color; return '#9a9aab'; };

  let getView = () => null;   // () => webview del dispositivo inspeccionado
  let deviceName = () => '';
  let toast = () => {};
  let openAi = () => {};
  let aiOn = false;
  let data = null;
  let selected = null;
  let picking = false;
  const root = {};
  const collapsed = new Set();

  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };
  const run = (fn, ...args) => {
    const v = getView();
    if (!v) return Promise.resolve(null);
    return v.executeJavaScript(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`).catch(() => null);
  };
  const hl = (path, scroll) => run(pageHighlight, path || '', !!scroll);

  /* ---- árbol ---- */
  function renderTree() {
    const box = root.tree;
    if (!box) return;
    box.textContent = '';
    if (!data) { el('div', 'hint', box, 'Pulsa «Analizar» o espera a que cargue la vista.'); return; }
    const vw = data.viewport.w;
    const walk = (n, depth) => {
      const row = el('div', 'tn', box);
      row.style.paddingLeft = `${depth * 14 + 4}px`;
      row.dataset.path = n.p;
      if (n.p === selected) row.classList.add('sel');
      const tog = el('span', 'tog', row, n.ch.length ? (collapsed.has(n.p) ? '▸' : '▾') : '·');
      const tag = el('span', 'tag', row, n.t);
      tag.style.background = colorOf(n.t);
      let label = n.id ? `#${n.id}` : n.c ? `.${n.c}` : '';
      if (n.txt && !label && n.t !== 'body' && n.t !== 'html') label = `“${n.txt}”`;
      el('span', 'tl', row, label);
      if (n.n) el('span', 'cnt', row, String(n.n));
      const bar = el('span', 'bar', row);
      const fill = el('i', n.w > vw + 1 ? 'over' : '', bar);
      fill.style.width = `${Math.min(100, Math.round((n.w / vw) * 100))}%`;
      fill.style.background = n.w > vw + 1 ? '' : colorOf(n.t);
      bar.title = `${n.w}×${n.h}px`;
      el('span', 'dim', row, `${n.w}×${n.h}`);
      row.onmouseenter = () => hl(n.p);
      row.onmouseleave = () => hl('');
      row.onclick = (e) => {
        if (e.target === tog && n.ch.length) { collapsed.has(n.p) ? collapsed.delete(n.p) : collapsed.add(n.p); renderTree(); return; }
        select(n.p, true);
      };
      if (!collapsed.has(n.p)) n.ch.forEach((c) => walk(c, depth + 1));
    };
    const defaultCollapse = (n, d) => { if (d >= 3 && n.ch.length) collapsed.add(n.p); n.ch.forEach((c) => defaultCollapse(c, d + 1)); };
    if (!root.init) { defaultCollapse(data.tree, 0); root.init = true; }
    walk(data.tree, 0);
  }

  /* ---- detalle: modelo de caja ---- */
  async function select(path, scroll) {
    selected = path;
    root.tree.querySelectorAll('.tn').forEach((r) => r.classList.toggle('sel', r.dataset.path === path));
    hl(path, scroll);
    const d = await run(pageDescribe, path);
    const box = root.detail;
    box.textContent = '';
    if (!d) { el('div', 'hint', box, 'El elemento ya no existe.'); return; }
    const head = el('div', 'dhead', box);
    const tag = el('span', 'tag', head, d.tag); tag.style.background = colorOf(d.tag);
    el('span', '', head, `${d.id ? '#' + d.id : ''}${d.classes.map((c) => '.' + c).join('')}`);
    el('div', 'muted', box, `${d.rect.w} × ${d.rect.h} px · posición (${d.rect.x}, ${d.rect.y})`);

    const bm = el('div', 'boxmodel', box);
    const layer = (cls, name, vals, inner) => {
      const l = el('div', `bm ${cls}`, null);
      el('span', 'bm-name', l, name);
      const [t, r, b, lf] = vals;
      el('span', 'bm-v t', l, String(t)); el('span', 'bm-v r', l, String(r));
      el('span', 'bm-v b', l, String(b)); el('span', 'bm-v l', l, String(lf));
      l.appendChild(inner);
      return l;
    };
    const content = el('div', 'bm bm-content', null, `${d.content.w} × ${d.content.h}`);
    bm.appendChild(layer('bm-margin', 'margin', d.margin, layer('bm-border', 'border', d.border, layer('bm-padding', 'padding', d.padding, content))));

    if (d.styles.length) {
      const t = el('table', 'styles', box);
      for (const [k, v] of d.styles) { const tr = el('tr', '', t); el('td', 'k', tr, k); el('td', '', tr, v); }
    }
    if (d.attrs.length) {
      el('h5', '', box, 'Atributos');
      const t = el('table', 'styles', box);
      for (const [k, v] of d.attrs) { const tr = el('tr', '', t); el('td', 'k', tr, k); el('td', '', tr, v); }
    }
    el('h5', '', box, 'HTML');
    el('pre', 'snippet', box, d.snippet);
  }

  /* ---- resumen ---- */
  function renderSummary() {
    const box = root.summary;
    if (!box) return;
    box.textContent = '';
    if (!data) return;
    const card = (label, value, sub) => {
      const c = el('div', 'card', null);
      el('b', '', c, String(value)); el('span', '', c, label);
      if (sub) el('small', '', c, sub);
      return c;
    };
    const grid = el('div', 'cards', box);
    const c = data.counts;
    grid.append(
      card('Elementos', c.elements, `profundidad ${c.depth}`), card('Imágenes', c.images), card('Scripts', c.scripts),
      card('Hojas CSS', c.styles), card('Enlaces', c.links), card('Formularios', `${c.forms} (${c.inputs} campos)`)
    );
    const info = el('table', 'styles', box);
    const row = (k, v) => { const tr = el('tr', '', info); el('td', 'k', tr, k); el('td', '', tr, v); };
    row('Viewport', `${data.viewport.w}×${data.viewport.h} @${data.viewport.dpr}x`);
    row('Documento', `${data.doc.w}×${data.doc.h}px${data.doc.w > data.viewport.w ? ' ⚠ desborda' : ''}`);
    row('Título', data.title || '—'); row('Idioma', data.lang || '—');
    if (data.perf) {
      row('TTFB', `${data.perf.ttfb} ms`); row('DOM listo', `${data.perf.dom} ms`); row('Carga', `${data.perf.load} ms`);
      row('Peso / peticiones', `${(data.perf.size / 1024).toFixed(0)} KB · ${data.perf.requests}`);
    }

    el('h5', '', box, `Problemas (${data.issues.length})`);
    if (!data.issues.length) el('div', 'ok', box, '✓ Sin problemas detectados');
    for (const i of data.issues) {
      const r = el('div', `issue sev-${i.sev}`, box);
      el('b', '', r, `${{ error: '⛔', warning: '⚠️', notice: 'ℹ️' }[i.sev]} ${i.title}`);
      if (i.detail) el('small', '', r, i.detail);
      if (i.p) { r.classList.add('link'); r.onclick = () => select(i.p, true); }
    }

    el('h5', '', box, 'Paleta y tipografía');
    const pal = el('div', 'palette', box);
    for (const { k, v } of [...data.bgColors, ...data.textColors]) {
      const sw = el('span', 'sw', pal); sw.style.background = k; sw.title = `${k} (${v})`;
    }
    for (const f of data.fonts) el('div', 'muted', box, `${f.k} · ${f.v}`);

    if (data.headings.length) {
      el('h5', '', box, 'Estructura de encabezados');
      for (const h of data.headings) {
        const r = el('div', 'hd link', box, `h${h.l}  ${h.t}`);
        r.style.paddingLeft = `${(h.l - 1) * 12}px`;
        r.onclick = () => select(h.p, true);
      }
    }
    const btn = el('button', '', box, '🤖 Pedir sugerencias a la IA');
    const out = el('div', 'msg-ai', box); out.hidden = true;
    btn.onclick = async () => {
      out.hidden = false; out.classList.remove('failed'); out.textContent = '';
      if (!aiOn) {
        out.classList.add('failed');
        out.append('No hay una IA conectada (o falta elegir un modelo). ');
        const b = el('button', '', out, 'Abrir ajustes de IA'); b.onclick = openAi;
        return;
      }
      out.textContent = 'Consultando a la IA…';
      const summary = { url: data.url, viewport: data.viewport, counts: data.counts, perf: data.perf, issues: data.issues.slice(0, 25).map((i) => `${i.sev}: ${i.title} ${i.detail}`) };
      const r = await window.liveproject.aiAsk(`Analiza este informe de una página web (dispositivo: ${deviceName()}) y prioriza mejoras de responsive, accesibilidad y rendimiento:\n${JSON.stringify(summary, null, 1)}`);
      out.textContent = r.text; out.classList.toggle('failed', !r.ok);
    };
  }

  async function analyze() {
    if (!root.status) return;
    root.status.textContent = 'Analizando…';
    const d = await run(pageAnalyze);
    if (!d) { root.status.textContent = 'No se pudo analizar (¿la vista aún carga?)'; return; }
    data = d;
    root.status.textContent = `${deviceName()} · ${new Date().toLocaleTimeString()}`;
    if (selected && !root.init) selected = null;
    renderTree(); renderSummary();
    if (selected) select(selected, false);
  }

  async function pick() {
    const v = getView();
    if (!v) return;
    if (picking) { run(() => window.__lpCancel && window.__lpCancel()); return; }
    picking = true; root.pick.classList.add('active');
    const path = await run(pagePick);
    picking = false; root.pick.classList.remove('active');
    if (path) {
      if (!data) await analyze();
      // expandir ancestros en el árbol
      const parts = path.split(' > ');
      for (let i = 1; i < parts.length; i++) collapsed.delete(parts.slice(0, i).join(' > '));
      renderTree();
      select(path, false);
    }
  }

  function init(opts) {
    getView = opts.getView; deviceName = opts.deviceName; toast = opts.toast; openAi = opts.openAi || openAi;
    Object.assign(root, { tree: opts.tree, detail: opts.detail, summary: opts.summary, status: opts.status, pick: opts.pickBtn });
    opts.analyzeBtn.onclick = analyze;
    opts.pickBtn.onclick = pick;
    renderTree();
  }

  return { init, analyze, reset() { data = null; selected = null; root.init = false; collapsed.clear(); renderTree(); renderSummary(); }, setAi: (v) => { aiOn = v; } };
})();
