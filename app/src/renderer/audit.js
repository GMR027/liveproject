// Auditoría de la página: SEO (metadatos), accesibilidad básica y estructura,
// revisada en la vista seleccionada. Los avisos traen su corrección sugerida.
const Audit = (() => {
  let ui = null;
  let getView = () => null;
  let toast = () => {};
  let deviceName = () => '';
  let openAi = () => {};
  let aiOn = false;
  let findings = [];

  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---- comprobaciones dentro de la página ---- */
  function pageAudit() {
    const out = [];
    const add = (sev, title, detail, fix) => out.push({ sev, title, detail, fix });
    const text = (el) => (el.textContent || '').trim();
    const visible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      return el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    };

    // --- SEO / metadatos ---
    const title = document.title;
    if (!title) add('error', 'Falta el título de la página', 'document.title está vacío', 'Añade <title> con el nombre del sitio o de la sección');
    else if (title.length > 60) add('warning', `Título largo (${title.length} caracteres)`, title, 'Google muestra unos 60 caracteres: acórtalo');
    if (title.length < 15) add('notice', 'Título muy corto', title, 'Un título descriptivo mejora el SEO y la pestaña del navegador');

    const desc = document.querySelector('meta[name=description]');
    if (!desc) add('warning', 'Falta la meta descripción', 'No hay <meta name="description">', 'Añádela: es el texto que muestran Google y las redes sociales');
    else if (!desc.content.trim()) add('warning', 'Meta descripción vacía', '<meta name="description" content="">', 'Rellena el contenido');
    else if (desc.content.length > 160) add('notice', `Meta descripción larga (${desc.content.length})`, desc.content.slice(0, 80) + '…', 'Deja unas 150-160 caracteres');

    const vp = document.querySelector('meta[name=viewport]');
    if (!vp) add('error', 'Falta la meta viewport', 'Sin <meta name="viewport"> el móvil no escala bien', 'Añade <meta name="viewport" content="width=device-width, initial-scale=1">');
    else if (!/width\s*=\s*device-width/.test(vp.content || '')) add('warning', 'Viewport sin width=device-width', vp.content, 'Usa width=device-width para que la página se adapte al ancho real');

    if (!document.documentElement.getAttribute('lang')) add('warning', 'Falta el atributo lang', '<html> no declara el idioma', 'Añade lang="es" (o el idioma del contenido)');
    if (!document.querySelector('link[rel=canonical]')) add('notice', 'Falta el enlace canonical', 'Sin <link rel="canonical">', 'Añádelo para evitar contenido duplicado');
    if (!document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')) add('notice', 'Sin etiquetas Open Graph', 'No hay og:title ni twitter:title', 'Añade las etiquetas og:* para que se vea bien al compartir el enlace');
    if (!document.querySelector('link[rel~="icon"]')) add('notice', 'Sin favicon', 'No hay <link rel="icon">', 'Añade un icono para la pestaña del navegador');

    // --- estructura y contenido ---
    const h1 = [...document.querySelectorAll('h1')].filter(visible);
    if (!h1.length) add('error', 'No hay ningún <h1> visible', 'La página necesita un encabezado principal', 'Añade un único <h1> con el título de la página');
    else if (h1.length > 1) add('warning', `${h1.length} encabezados <h1>`, h1.map((h) => text(h)).join(' · ').slice(0, 120), 'Deja un solo <h1> por página');
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => +h.tagName[1]);
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        add('notice', 'Salto en la jerarquía de encabezados', `h${levels[i - 1]} → h${levels[i]}`, 'No saltes niveles: usa h2, h3… en orden');
        break;
      }
    }
    const imgs = [...document.querySelectorAll('img')];
    const sinAlt = imgs.filter((i) => !i.hasAttribute('alt'));
    if (sinAlt.length) add('warning', `${sinAlt.length} imagen(es) sin atributo alt`, sinAlt.slice(0, 3).map((i) => i.getAttribute('src') || '(sin src)').join(' · '), 'Añade alt="" (decorativas) o una descripción (informativas)');
    const svgSin = [...document.querySelectorAll('svg')].filter((s) => !s.getAttribute('aria-hidden') && !s.getAttribute('role') && !s.querySelector('title'));
    if (svgSin.length) add('notice', `${svgSin.length} icono(s) SVG sin nombre accesible`, 'Los SVG decorativos deben tener aria-hidden="true"', 'Añade aria-hidden="true" o un <title> dentro');

    // --- enlaces y botones ---
    const links = [...document.querySelectorAll('a[href]')];
    const vacios = links.filter((a) => !text(a) && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])'));
    if (vacios.length) add('warning', `${vacios.length} enlace(s) sin texto`, vacios.slice(0, 3).map((a) => a.getAttribute('href')).join(' · '), 'Añade texto visible o aria-label');
    const externos = links.filter((a) => /^https?:\/\//i.test(a.getAttribute('href') || '') && a.host !== location.host);
    if (externos.length) add('notice', `${externos.length} enlace(s) externos`, externos.slice(0, 3).map((a) => a.host).join(' · '), 'Considera rel="noopener" y marca los que llevan a otra web');
    const botones = [...document.querySelectorAll('button, [role=button]')];
    const btnSin = botones.filter((b) => !text(b) && !b.getAttribute('aria-label') && !b.getAttribute('title'));
    if (btnSin.length) add('warning', `${btnSin.length} botón(es) sin nombre accesible`, 'Un botón sin texto no se puede leer con un lector de pantalla', 'Añade texto o aria-label');

    // --- formularios ---
    const campos = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')];
    const sinEtiqueta = campos.filter((c) => {
      if (c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')) return false;
      if (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) return false;
      if (c.closest('label')) return false;
      if (c.getAttribute('title')) return false;
      return true;
    });
    if (sinEtiqueta.length) add('error', `${sinEtiqueta.length} campo(s) de formulario sin etiqueta`, sinEtiqueta.slice(0, 3).map((c) => c.name || c.type || c.tagName).join(' · '), 'Añade <label for="…">, aria-label o un title');
    const reqSin = campos.filter((c) => c.required && !c.getAttribute('aria-required'));
    if (reqSin.length) add('notice', `${reqSin.length} campo(s) obligatorios sin aria-required`, 'required no siempre lo anuncian los lectores de pantalla', 'Añade aria-required="true"');
    const inputsNombre = campos.filter((c) => /^(name|email|tel|user|pwd)/i.test(c.name || '') && c.type !== 'hidden' && !c.autocomplete);
    if (inputsNombre.length) add('notice', `${inputsNombre.length} campo(s) sin autocomplete`, 'El navegador no puede rellenar los datos de contacto', 'Añade autocomplete="name|email|tel"');

    // --- idioma y otros ---
    if (!document.querySelector('link[rel=manifest]')) add('notice', 'Sin manifiesto PWA', 'No hay <link rel="manifest">', 'Añádelo si la web se instala como aplicación');
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    if (scripts.some((s) => s && s.startsWith('http://'))) add('warning', 'Scripts cargados por HTTP (sin cifrar)', scripts.filter((s) => s && s.startsWith('http://')).join(' · '), 'Cambia a https:// para evitar el aviso de contenido mixto');

    return out;
  }

  /* ---- robots.txt y sitemap.xml ---- */
  async function checkServerFiles() {
    const out = [];
    const base = (() => { try { return new URL(ui.baseUrl()); } catch { return null; } })();
    if (!base) return out;
    const url = new URL('/robots.txt', base.origin).toString();
    const r = await window.liveproject.fetchText(url).catch(() => null);
    if (!r || !r.ok) out.push({ sev: 'notice', title: 'No se encontró robots.txt', detail: url, fix: 'Crea robots.txt en la raíz del sitio (no es obligatorio)' });
    else if (!/sitemap/i.test(r.text || '')) out.push({ sev: 'notice', title: 'robots.txt no declara ningún sitemap', detail: (r.text || '').slice(0, 200), fix: 'Añade la línea Sitemap: https://tu-sitio/sitemap.xml' });
    const sm = await window.liveproject.fetchText(new URL('/sitemap.xml', base.origin).toString()).catch(() => null);
    if (!sm || !sm.ok) out.push({ sev: 'notice', title: 'No se encontró sitemap.xml', detail: new URL('/sitemap.xml', base.origin).toString(), fix: 'Genera un sitemap para que los buscadores indexen todas tus páginas' });
    return out;
  }

  /* ---- comparación entre dos dispositivos ---- */
  function pageCompare() {
    const tags = {};
    for (const e of document.querySelectorAll('*')) {
      const t = e.tagName.toLowerCase();
      tags[t] = (tags[t] || 0) + 1;
    }
    const mq = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) if (r.type === 4 && r.conditionText) mq.add(r.conditionText.trim());
    }
    return {
      title: document.title,
      total: document.querySelectorAll('*').length,
      tags,
      heads: [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 40)}`),
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input,select,textarea').length,
      imgs: document.querySelectorAll('img').length,
      scripts: document.querySelectorAll('script').length,
      mq: [...mq],
      lang: document.documentElement.lang || '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      viewport: `${window.innerWidth}×${window.innerHeight}`
    };
  }

  async function compareDevices() {
    const a = $('cmp-a').value;
    const b = $('cmp-b').value;
    if (!a || !b || a === b) return toast('Elige dos dispositivos distintos');
    const box = $('cmp-out');
    box.textContent = '';
    const fa = ui.frameById(a);
    const fb = ui.frameById(b);
    if (!fa || !fb) return toast('Ese dispositivo no está disponible');
    let da;
    let db;
    try { da = await fa.view.executeJavaScript(`(${pageCompare.toString()})()`); } catch { da = null; }
    try { db = await fb.view.executeJavaScript(`(${pageCompare.toString()})()`); } catch { db = null; }
    if (!da || !db) return toast('No se pudieron leer las dos vistas');

    const row = (label, va, vb, diff) => {
      const r = el('div', `cmp-row${diff ? ' diff' : ''}`, box);
      el('span', 'cmp-lab', r, label);
      el('span', 'cmp-a', r, String(va));
      el('span', 'cmp-b', r, String(vb));
    };
    const head = el('div', 'cmp-row head', box);
    el('span', 'cmp-lab', head, '');
    el('span', 'cmp-a', head, ui.deviceNameOf(a));
    el('span', 'cmp-b', head, ui.deviceNameOf(b));

    row('Elementos', da.total, db.total, da.total !== db.total);
    row('Encabezados', da.heads.length, db.heads.length, da.heads.length !== db.heads.length);
    row('Formularios', da.forms, db.forms, da.forms !== db.forms);
    row('Campos', da.inputs, db.inputs, da.inputs !== db.inputs);
    row('Imágenes', da.imgs, db.imgs, da.imgs !== db.imgs);
    row('Scripts', da.scripts, db.scripts, da.scripts !== db.scripts);
    row('Desborda', da.overflow ? 'sí' : 'no', db.overflow ? 'sí' : 'no', da.overflow !== db.overflow);
    row('Viewport', da.viewport, db.viewport, da.viewport !== db.viewport);

    // media queries que se activan en uno y no en el otro
    const ma = new Set(da.mq);
    const mb = new Set(db.mq);
    const soloA = [...ma].filter((x) => !mb.has(x));
    const soloB = [...mb].filter((x) => !ma.has(x));
    const mqBox = el('div', 'cmp-mq', box);
    el('h5', '', mqBox, 'Media queries');
    if (!soloA.length && !soloB.length) el('div', 'muted', mqBox, 'Las mismas en los dos dispositivos.');
    else {
      for (const x of soloA) el('div', 'cmp-only a', mqBox, `Solo en ${ui.deviceNameOf(a)}: ${x}`);
      for (const x of soloB) el('div', 'cmp-only b', mqBox, `Solo en ${ui.deviceNameOf(b)}: ${x}`);
    }
    // encabezados distintos
    const ha = new Set(da.heads);
    const hb = new Set(db.heads);
    const difH = [...ha].filter((x) => !hb.has(x)).concat([...hb].filter((x) => !ha.has(x)));
    if (difH.length) {
      const hb2 = el('div', 'cmp-mq', box);
      el('h5', '', hb2, 'Encabezados que solo aparecen en uno');
      for (const x of difH.slice(0, 12)) el('div', 'muted', hb2, x);
    }
  }

  /* ---- interfaz ---- */
  function render() {
    if (!ui) return;
    ui.list.textContent = '';
    const errors = findings.filter((f) => f.sev === 'error').length;
    const warns = findings.filter((f) => f.sev === 'warning').length;
    ui.status.textContent = findings.length
      ? `${findings.length} hallazgo(s) · ${errors} error(es) · ${warns} aviso(s)`
      : 'Sin hallazgos: la página pasa la auditoría básica';
    if (!findings.length) {
      const ok = el('div', 'hint', ui.list, 'Todo correcto: metadatos, estructura, enlaces, botones y formularios están bien.');
      return;
    }
    const order = { error: 0, warning: 1, notice: 2 };
    for (const f of [...findings].sort((a, b) => order[a.sev] - order[b.sev])) {
      const box = el('div', `issue sev-${f.sev}`, ui.list);
      el('b', '', box, `${f.sev === 'error' ? '⛔' : f.sev === 'warning' ? '⚠️' : 'ℹ️'} ${f.title}`);
      if (f.detail) el('small', '', box, f.detail);
      if (f.fix) el('small', 'aud-fix', box, `→ ${f.fix}`);
    }
  }

  async function run() {
    if (!ui) return;
    const v = getView();
    if (!v) return toast('Carga una vista primero');
    ui.status.textContent = 'Auditando…';
    findings = [];
    let page = [];
    try { page = await v.executeJavaScript(`(${pageAudit.toString()})()`); } catch (e) { page = []; }
    findings = page || [];
    const extra = await checkServerFiles();
    findings = findings.concat(extra);
    render();
  }

  async function reviewAi() {
    if (!aiOn) return toast('Conecta una IA en Ajustes para usar la revisión');
    if (!findings.length) return toast('No hay hallazgos que revisar');
    const r = await window.liveproject.aiAsk(
      `Audita esta página (${deviceName()}) y prioriza los problemas. Lista de hallazgos:\n${findings.map((f) => `- [${f.sev}] ${f.title}: ${f.detail || ''} → ${f.fix || ''}`).join('\n')}\n\nResponde con una lista priorizada y el código/solución concreta para cada problema importante.`);
    ui.aiOut.hidden = false;
    ui.aiOut.textContent = r.ok ? r.text : 'No se pudo consultar la IA';
    ui.aiOut.classList.toggle('failed', !r.ok);
  }

  function init(o) {
    ui = o;
    getView = o.getView;
    toast = o.toast;
    openAi = o.openAi || openAi;
    o.btn.onclick = run;
    o.aiBtn.onclick = reviewAi;
    if (o.cmpBtn) o.cmpBtn.onclick = compareDevices;
    if (o.cmpA) {
      o.cmpA.onchange = () => { /* refresca al comparar */ };
      const fill = () => {
        const opts = o.devices().map((d) => [d.id, d.name]);
        for (const [sel, def] of [[o.cmpA, 0], [o.cmpB, 1]]) {
          const cur = sel.value;
          sel.textContent = '';
          opts.forEach(([id, name], i) => {
            const op = document.createElement('option');
            op.value = id;
            op.textContent = name;
            sel.appendChild(op);
          });
          if (opts[def]) sel.value = opts[def][0];
          if (cur && opts.some(([id]) => id === cur)) sel.value = cur;
        }
      };
      fill();
      o.onDevices && o.onDevices(fill);
    }
    render();
  }

  return { init, run, setAi: (v) => { aiOn = v; }, snapshot: () => findings };
})();
