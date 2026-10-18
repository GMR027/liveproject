// Linter de CSS responsive: analiza cada dispositivo activo (viewport real) y propone correcciones, con ayuda opcional de la IA.

/* ======== se ejecuta DENTRO de la página ======== */
function pageCssLint(touch) {
  const vw = window.innerWidth;
  const found = new Map();
  const add = (id, sev, title, detail, fix, example, rule) => {
    let f = found.get(id);
    if (!f) { f = { id, sev, title, detail, fix, count: 0, examples: [], rules: [] }; found.set(id, f); }
    f.count++;
    if (example && f.examples.length < 6) f.examples.push(example);
    if (rule && f.rules.length < 4 && !f.rules.includes(rule)) f.rules.push(rule);
  };
  const pathOf = (el) => {
    if (el === document.documentElement) return 'html';
    if (el === document.body) return 'body';
    const parts = [];
    for (let n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${Array.prototype.indexOf.call(n.parentElement.children, n) + 1})`);
    }
    return 'body > ' + parts.join(' > ');
  };
  const name = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (c ? `.${c}` : '');
  };
  const ex = (el, info) => ({ path: pathOf(el), label: name(el), info: info || '' });
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

  /* hojas de estilo: solo se consideran las reglas cuyo @media/@supports se cumple en este viewport */
  const breakpoints = new Set();
  let inaccessible = 0, rulesSeen = 0;
  const applicable = [];
  const walk = (rules, ctx, sheetName) => {
    for (const rule of rules) {
      if (rule.media) {
        const text = rule.media.mediaText;
        for (const m of text.matchAll(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)/g)) breakpoints.add(`${m[1]}-width:${Math.round(parseFloat(m[2]) * (m[3] === 'px' ? 1 : 16))}`);
        if (/device-(?:width|height)/.test(text)) add('deprecated-device-width', 'notice', '@media con device-width / device-height (obsoleto)', `Consulta «${text}»`, 'Usa width / height (viewport), no las dimensiones de la pantalla física.', null, `@media ${text}`);
        if (window.matchMedia(text).matches) walk(rule.cssRules, ctx, sheetName);
      } else if (rule.selectorText !== undefined) {
        rulesSeen++;
        applicable.push({ rule, sheetName });
      } else if (rule.cssRules && (rule.conditionText === undefined || CSS.supports(rule.conditionText))) {
        walk(rule.cssRules, ctx, sheetName);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { inaccessible++; continue; }
    walk(rules, '', sheet.href ? sheet.href.split('/').pop() : '<style>');
  }
  const excerpt = (r, sheet) => `/* ${sheet} */\n${r.cssText.slice(0, 400)}`;
  const px = (v) => { const m = /^(\d+(?:\.\d+)?)px$/.exec((v || '').trim()); return m ? parseFloat(m[1]) : null; };
  const matched = (sel) => { try { return sel ? Array.from(document.querySelectorAll(sel)).slice(0, 3) : []; } catch { return []; } };

  for (const { rule, sheetName } of applicable) {
    const st = rule.style;
    const els = () => matched(rule.selectorText);
    for (const prop of ['width', 'min-width']) {
      const v = px(st.getPropertyValue(prop));
      if (v !== null && v > vw + 1) {
        const e = els();
        if (e.length && visible(e[0])) {
          add(`fixed-${prop}`, 'warning', `${prop} fijo en px mayor que la pantalla`, `Viewport ${vw}px; la regla fuerza ${v}px.`,
            prop === 'width' ? 'Sustituye por max-width: 100% (o width: min(100%, Npx)) para que el elemento se encoja.' : 'Usa min-width: 0 o un valor relativo; con flex/grid añade min-width: 0 al hijo.',
            ex(e[0], `${prop}: ${v}px`), excerpt(rule, sheetName));
        }
      }
    }
    const h = st.getPropertyValue('height');
    if (touch && /(^|\s)100vh\b/.test(h + ' ' + st.getPropertyValue('min-height'))) {
      const e = els();
      if (e.length) add('100vh', 'notice', '100vh en móvil/tableta', 'En navegadores móviles 100vh incluye la barra de direcciones y corta el contenido.', 'Usa 100dvh (o 100svh) con 100vh como alternativa anterior.', ex(e[0], 'height: 100vh'), excerpt(rule, sheetName));
    }
    const fs = px(st.getPropertyValue('font-size'));
    if (touch && fs !== null && fs < 12) {
      const e = els();
      if (e.length) add('tiny-font-rule', 'notice', 'Tamaño de fuente muy pequeño (< 12px)', `font-size: ${fs}px`, 'Usa rem/clamp() y mantén ≥ 14px para texto principal.', ex(e[0], `${fs}px`), excerpt(rule, sheetName));
    }
    if (/(^|[^-])\bvw\b/.test(st.getPropertyValue('font-size')) && !/clamp|min|max|calc/.test(st.getPropertyValue('font-size'))) {
      const e = els();
      if (e.length) add('vw-font', 'notice', 'font-size solo en vw', 'No escala bien: ilegible en móviles y gigante en monitores, y no respeta el zoom.', 'Usa clamp(1rem, 2.5vw + .5rem, 2rem).', ex(e[0], st.getPropertyValue('font-size')), excerpt(rule, sheetName));
    }
  }

  const meta = document.querySelector('meta[name=viewport]');
  if (!meta) add('no-viewport', 'error', 'Falta <meta name="viewport">', 'Sin ella los móviles renderizan a ~980px y reducen la página.', 'Añade <meta name="viewport" content="width=device-width, initial-scale=1"> en el <head>.');
  else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(meta.content)) add('no-zoom', 'warning', 'El viewport impide hacer zoom', meta.content, 'Quita user-scalable=no y maximum-scale=1: perjudica la accesibilidad.');

  /* elementos que desbordan horizontalmente */
  const doc = document.documentElement;
  const overflowing = doc.scrollWidth > vw + 1;
  const all = Array.from(document.querySelectorAll('body *')).slice(0, 3000);
  const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body && n !== doc; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o !== 'visible') return true; } return false; };
  if (overflowing) {
    add('h-scroll', 'error', 'La página tiene scroll horizontal', `scrollWidth ${doc.scrollWidth}px > viewport ${vw}px (+${doc.scrollWidth - vw}px).`, 'Localiza los elementos de abajo: suelen tener width/min-width fijos, imágenes sin max-width:100%, tablas o texto sin saltos (overflow-wrap:anywhere).');
    let n = 0;
    for (const el of all) {
      if (n >= 8) break;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && r.width > 0 && getComputedStyle(el).position !== 'fixed' && !clipped(el)) {
        const rules = [];
        for (const { rule, sheetName } of applicable) { try { if (el.matches(rule.selectorText) && /width|margin|padding|left|right|flex|grid/.test(rule.style.cssText)) rules.push(excerpt(rule, sheetName)); } catch { /* selector no válido */ } if (rules.length >= 2) break; }
        add('overflow-el', 'error', 'Elementos que se salen de la pantalla', `Se extienden más allá de los ${vw}px del viewport.`, 'Aplica max-width:100% / box-sizing:border-box, usa flex-wrap o grid con minmax(0, 1fr), y min-width:0 en hijos flex.', ex(el, `${Math.round(r.left)}→${Math.round(r.right)}px, ancho ${Math.round(r.width)}px`), rules[0]);
        n++;
      }
    }
    const hidden = [document.body, doc].find((e) => getComputedStyle(e).overflowX === 'hidden');
    if (hidden) add('overflow-hidden-mask', 'warning', 'overflow-x: hidden en html/body', 'Oculta el desborde en lugar de corregirlo y puede romper position:sticky.', 'Corrige el elemento que desborda y retira overflow-x:hidden (o usa overflow-x:clip).', ex(hidden));
  }

  /* objetivos táctiles, fuentes, imágenes, texto cortado */
  const interactive = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [onclick]')).slice(0, 800);
  for (const el of interactive) {
    if (!touch || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) add('tap-small', 'warning', 'Objetivos táctiles menores de 24×24 px (WCAG 2.2)', 'Difíciles de pulsar con el dedo.', 'Da al elemento min-width/min-height de 44px (o padding) y separa los objetivos contiguos.', ex(el, `${Math.round(r.width)}×${Math.round(r.height)}px`));
    else if (r.width < 44 || r.height < 44) add('tap-medium', 'notice', 'Objetivos táctiles menores de 44×44 px', 'Recomendación de Apple/Google para pulsación cómoda.', 'min-height: 44px; min-width: 44px (el área clicable puede crecer con padding).', ex(el, `${Math.round(r.width)}×${Math.round(r.height)}px`));
  }
  if (touch) {
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')) {
      if (visible(el) && parseFloat(getComputedStyle(el).fontSize) < 16) add('ios-zoom', 'notice', 'Campos con fuente menor de 16px', 'iOS Safari hace zoom automático al enfocarlos.', 'font-size: 16px en input, select y textarea.', ex(el, getComputedStyle(el).fontSize));
    }
  }
  let imgNoDim = 0;
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    const r = img.getBoundingClientRect();
    const p = img.parentElement;
    if (p && r.width > p.clientWidth + 1 && p.clientWidth > 0 && getComputedStyle(p).display !== 'flex') add('img-wider', 'warning', 'Imágenes más anchas que su contenedor', 'Sobresalen al reducir el viewport.', 'img { max-width: 100%; height: auto; }', ex(img, `${Math.round(r.width)}px en contenedor de ${p.clientWidth}px`));
    if (img.naturalWidth && r.width && img.naturalWidth > r.width * 2.5 && img.naturalWidth > 600) add('img-big', 'notice', 'Imágenes mucho mayores que su tamaño en pantalla', 'Gastan datos en móviles.', 'Usa srcset/sizes (o <picture>) con versiones más pequeñas.', ex(img, `natural ${img.naturalWidth}px → ${Math.round(r.width)}px`));
    if (!img.getAttribute('width') && !img.getAttribute('height') && getComputedStyle(img).aspectRatio === 'auto') imgNoDim++;
  }
  if (imgNoDim) add('img-no-dim', 'notice', 'Imágenes sin width/height ni aspect-ratio', 'Provocan saltos de diseño (CLS) al cargar.', 'Añade width y height al <img> o aspect-ratio en CSS.', null);
  const found2 = found.get('img-no-dim'); if (found2) found2.count = imgNoDim;
  for (const el of all) {
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && visible(el)) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'hidden' && cs.whiteSpace === 'nowrap') add('clipped-text', 'notice', 'Texto cortado (overflow:hidden + nowrap)', 'El contenido no cabe y se recorta sin avisar.', 'Añade text-overflow: ellipsis o permite el salto con white-space: normal.', ex(el, `contenido ${el.scrollWidth}px en ${el.clientWidth}px`));
    }
  }
  if (touch) {
    let tiny = 0;
    for (const el of all.slice(0, 1500)) {
      let direct = false;
      for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim().length > 2) { direct = true; break; }
      if (direct && visible(el) && parseFloat(getComputedStyle(el).fontSize) < 12) { tiny++; add('tiny-font', 'warning', 'Texto menor de 12px en pantalla táctil', 'Difícil de leer sin zoom.', 'Sube a ≥ 14px (usa rem) y revisa el escalado con clamp().', ex(el, getComputedStyle(el).fontSize)); }
      if (tiny > 40) break;
    }
  }
  if (!applicable.length && inaccessible === 0) add('no-css', 'notice', 'No se encontró CSS accesible', '', '');
  if (rulesSeen && !breakpoints.size) add('no-mq', 'notice', 'Ninguna media query aplicable ni declarada', 'Si el diseño no es fluido, se romperá en otros tamaños.', 'Añade breakpoints (p. ej. @media (min-width: 768px)) o usa unidades fluidas, flex-wrap, grid auto-fit y clamp().');

  return { vw, vh: window.innerHeight, rules: rulesSeen, inaccessible, breakpoints: [...breakpoints], findings: [...found.values()].map((f) => { const { id, ...rest } = f; return { id, ...rest }; }) };
}

const CssLint = (() => {
  let ui = null;
  let framesFn = () => [];     // () => [{ id, name, type, w, h, view }]
  let highlight = () => {};
  let aiOn = false;
  let openAi = () => {};
  let report = null;           // { at, devices: [{ name, vw, rules, ... }], findings: [...] }
  const SEV = { error: 0, warning: 1, notice: 2 };
  const ICON = { error: '⛔', warning: '⚠️', notice: 'ℹ️' };

  async function analyze() {
    const frames = framesFn();
    if (!frames.length) { ui.status.textContent = 'No hay vistas cargadas.'; return; }
    ui.btn.disabled = true;
    ui.status.textContent = 'Analizando…';
    const merged = new Map();
    const devices = [];
    for (const f of frames) {
      let r;
      try { r = await f.view.executeJavaScript(`(${pageCssLint.toString()})(${f.touch})`); } catch { r = null; }
      if (!r) continue;
      devices.push({ id: f.id, name: f.name, vw: r.vw, rules: r.rules, inaccessible: r.inaccessible, breakpoints: r.breakpoints });
      for (const fi of r.findings) {
        let m = merged.get(fi.id);
        if (!m) { m = { ...fi, count: 0, devs: [], examples: [], rules: fi.rules.slice() }; merged.set(fi.id, m); }
        m.devs.push({ id: f.id, name: f.name, count: fi.count });
        m.count = Math.max(m.count, fi.count);
        for (const e of fi.examples) if (m.examples.length < 8) m.examples.push({ ...e, dev: f.id, devName: f.name });
        for (const rl of fi.rules) if (m.rules.length < 4 && !m.rules.includes(rl)) m.rules.push(rl);
      }
    }
    report = { at: Date.now(), devices, findings: [...merged.values()].sort((a, b) => SEV[a.sev] - SEV[b.sev] || b.devs.length - a.devs.length) };
    ui.btn.disabled = false;
    ui.status.textContent = `${devices.length} dispositivo(s) · ${new Date().toLocaleTimeString()}`;
    render();
    ui.onDone && ui.onDone();
  }

  const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; };

  async function askAi(prompt, out, btn) {
    if (!aiOn) {
      out.hidden = false; out.className = 'msg-ai failed'; out.textContent = 'No hay una IA conectada (o falta elegir un modelo). ';
      const b = el('button', '', out, 'Abrir ajustes de IA'); b.onclick = openAi;
      return;
    }
    out.hidden = false; out.className = 'msg-ai'; out.textContent = 'Consultando a la IA…';
    btn.disabled = true;
    const r = await window.liveproject.aiAsk(prompt);
    btn.disabled = false;
    out.textContent = r.text; out.classList.toggle('failed', !r.ok);
  }

  function findingPrompt(f) {
    return `Problema de CSS responsive detectado automáticamente.\nDispositivos: ${f.devs.map((d) => d.name).join(', ')}\nProblema: ${f.title}\nDetalle: ${f.detail}\n` +
      `Elementos: ${f.examples.map((e) => `${e.label} (${e.info})`).join('; ') || '—'}\nReglas CSS implicadas:\n${f.rules.join('\n\n') || '(no accesibles)'}\n\n` +
      'Propón el CSS corregido, concreto y mínimo (mobile-first si procede), explicando brevemente el cambio.';
  }

  function render() {
    if (!ui) return;
    ui.list.textContent = '';
    if (!report) { el('div', 'hint', ui.list, 'Pulsa «Analizar» para revisar el CSS en cada dispositivo activo: desbordes, anchos fijos, objetivos táctiles, tipografía, imágenes y media queries.'); ui.badge.hidden = true; return; }
    const counts = { error: 0, warning: 0, notice: 0 };
    report.findings.forEach((f) => counts[f.sev]++);
    ui.badge.textContent = counts.error || ''; ui.badge.hidden = !counts.error;
    const cards = el('div', 'cards', ui.list);
    [['Errores', counts.error], ['Avisos', counts.warning], ['Notas', counts.notice]].forEach(([l, n]) => { const c = el('div', 'card', cards); el('b', '', c, String(n)); el('span', '', c, l); });
    const bps = [...new Set(report.devices.flatMap((d) => d.breakpoints))].sort((a, b) => parseInt(a.split(':')[1], 10) - parseInt(b.split(':')[1], 10));
    el('div', 'muted csl-meta', ui.list, `Breakpoints en uso: ${bps.length ? bps.map((b) => b.replace('-width:', ' ')).join(' · ') : 'ninguno'}${report.devices.some((d) => d.inaccessible) ? ` · ${report.devices[0].inaccessible} hoja(s) externas no analizables` : ''}`);
    if (!report.findings.length) el('div', 'ok csl-ok', ui.list, '✔ No se detectaron problemas de CSS responsive en los dispositivos activos.');
    for (const f of report.findings) {
      const card = el('div', `issue csl sev-${f.sev}`, ui.list);
      const head = el('div', 'csl-head', card);
      el('span', '', head, ICON[f.sev]);
      el('b', '', head, f.title);
      if (f.count > 1) el('span', 'count', head, `×${f.count}`);
      const devs = el('div', 'csl-devs', card);
      f.devs.forEach((d) => el('span', 'lang-tag', devs, d.name));
      if (f.detail) el('div', '', card, f.detail);
      if (f.fix) el('div', 'csl-fix', card, `💡 ${f.fix}`);
      for (const e of f.examples) {
        const row = el('div', 'csl-ex', card);
        el('code', '', row, e.label);
        el('small', '', row, `${e.info}${f.devs.length > 1 ? ` · ${e.devName}` : ''}`);
        row.title = 'Resaltar en la página';
        row.onclick = () => highlight(e.dev, e.path);
      }
      if (f.rules.length) { const d = el('details', 'csl-rules', card); el('summary', '', d, 'Reglas CSS implicadas'); el('pre', 'snippet', d, f.rules.join('\n\n')); }
      const out = el('div', 'msg-ai', card); out.hidden = true;
      const btn = el('button', 'csl-ai', card, '💡 Corregir con IA');
      btn.onclick = () => askAi(findingPrompt(f), out, btn);
    }
  }

  async function reviewAll() {
    if (!report || !report.findings.length) { ui.status.textContent = 'Analiza primero para tener qué revisar.'; return; }
    const summary = report.findings.slice(0, 14).map((f) => `- [${f.sev}] ${f.title} · ${f.devs.map((d) => d.name).join(', ')} · ${f.detail}\n  elementos: ${f.examples.slice(0, 3).map((e) => `${e.label} (${e.info})`).join('; ')}\n  ${f.rules.slice(0, 2).join('\n  ').slice(0, 500)}`).join('\n');
    ui.aiOut.hidden = false;
    await askAi(`Revisión de CSS responsive de un proyecto web. Dispositivos: ${report.devices.map((d) => `${d.name} (${d.vw}px)`).join(', ')}.\nHallazgos:\n${summary}\n\nPriorízalos y entrega un único bloque de CSS con las correcciones más importantes (explica cada cambio en una línea).`.slice(0, 19000), ui.aiOut, ui.aiBtn);
  }

  function init(o) {
    ui = o; framesFn = o.frames; highlight = o.highlight; openAi = o.openAi || openAi;
    o.btn.onclick = analyze;
    o.aiBtn.onclick = reviewAll;
    render();
  }

  const snapshot = () => report && {
    at: report.at, devices: report.devices.map((d) => ({ name: d.name, vw: d.vw })),
    findings: report.findings.map((f) => ({ sev: f.sev, title: f.title, detail: f.detail, fix: f.fix, count: f.count, devices: f.devs.map((d) => d.name), examples: f.examples.slice(0, 4).map((e) => `${e.label} (${e.info})`) }))
  };

  return { init, analyze, snapshot, setAi: (v) => { aiOn = v; }, reset() { report = null; render(); } };
})();
