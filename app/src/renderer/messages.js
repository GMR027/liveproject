// Panel «Mensajes»: detecta errores/avisos de varios lenguajes (servidor, página y navegador)
// y los muestra con etiqueta de lenguaje y color por gravedad.
const Messages = (() => {
  const LANG_COLORS = {
    PHP: '#8892bf', Python: '#4b8bbe', JavaScript: '#f0db4f', Node: '#68a063', Ruby: '#cc342d', Go: '#00add8',
    Java: '#e76f00', 'C#': '#9b4f96', SQL: '#e38c00', HTTP: '#c084fc', Servidor: '#9a9aab', Navegador: '#5eead4'
  };
  const SEV = { error: { icon: '⛔', label: 'Error' }, warning: { icon: '⚠️', label: 'Aviso' }, notice: { icon: 'ℹ️', label: 'Nota' } };

  // Reglas de inicio de mensaje, evaluadas en orden.
  const RULES = [
    ['PHP', 'error', /\b(?:PHP )?(?:Fatal error|Parse error|Uncaught (?:Error|Exception|TypeError|\w+Exception))\b/],
    ['PHP', 'warning', /\b(?:PHP )?Warning:\s/],
    ['PHP', 'notice', /\b(?:PHP )?(?:Notice|Deprecated|Strict Standards):\s/],
    ['Python', 'error', /Traceback \(most recent call last\)/],
    ['Python', 'warning', /\b(?:Deprecation|User|Runtime|Future)Warning\b/],
    ['Node', 'error', /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError):\s|Cannot find module|npm ERR!|UnhandledPromiseRejection|EADDRINUSE|ERR_MODULE_NOT_FOUND/],
    ['Python', 'error', /^\s*(?:[\w.]+\.)?\w+(?:Error|Exception):\s|^ERROR in \w+:|\bTemplateSyntaxError\b|\bOperationalError\b/],
    ['Ruby', 'error', /\.rb:\d+:in [`']|\b(?:NoMethodError|NameError|ActionView::Template::Error|ActiveRecord::\w+)\b/],
    ['Go', 'error', /^panic:|^goroutine \d+|\.go:\d+(?::\d+)?:\s/],
    ['Java', 'error', /Exception in thread|^Caused by:|\b[\w.]+(?:Exception|Error): .*|^\s*at [\w.$<>]+\([\w$]+\.java:\d+\)/],
    ['C#', 'error', /Unhandled exception|\.cs:line \d+/],
    ['SQL', 'error', /SQLSTATE\[|You have an error in your SQL syntax|syntax error at or near|\bORA-\d{4,5}\b|no such table/i],
    ['HTTP', 'error', /\[(?:5\d\d)\]:|" 5\d\d [\d-]+\s*$/],
    ['HTTP', 'warning', /\[(?:4\d\d)\]:|" 4\d\d [\d-]+\s*$/],
    ['Servidor', 'error', /Address already in use|command not found|Permission denied|Proceso terminado \((?!0\))|Error al lanzar/i],
    ['Servidor', 'error', /\b(?:fatal|exception|panic)\b|\berror\b[:\]]/i],
    ['Servidor', 'warning', /\bwarn(?:ing)?\b[:\]]/i]
  ];
  const CONT = /^\s+\S|^#\d+ |^Stack trace:|^\s*thrown in|^\s*\^+|^Caused by:|^\s*(?:at |File ")|^\s*\d+\. |^\s*\.\.\. \d+ more/;

  const items = []; // { key, lang, sev, origin, title, detail[], count, time, el }
  let open = null;  // último mensaje abierto por stream para unir trazas de varias líneas
  let sevFilter = 'all';
  let langFilter = null;
  let aiOn = false;
  let aiLocal = false;
  let autoExplain = (() => { try { return localStorage.getItem('lp-auto-explain') !== '0'; } catch { return true; } })();
  const AUTO_MAX = 20; // tope de explicaciones automáticas por sesión
  let autoCount = 0;
  const queue = [];
  let busy = false;
  let ui = null;
  let openAiSettings = () => {};
  let changeCb = () => {};

  function classify(line) {
    for (const [lang, sev, re] of RULES) if (re.test(line)) return { lang, sev };
    return null;
  }

  const norm = (s) => s.replace(/^\[[^\]]*\]\s*/, '').replace(/^PHP /, '').replace(/\s+/g, ' ').replace(/\d{2}:\d{2}:\d{2}/g, '').trim();

  function add({ lang, sev, origin, line }) {
    const key = `${lang}|${norm(line)}`;
    const now = Date.now();
    let it = items.find((x) => x.key === key);
    if (it) {
      // el mismo error visto casi a la vez desde otro origen (servidor + página + varios dispositivos) cuenta una vez
      if (!(now - it.time < 5000 && !it.origins.includes(origin))) it.count++;
      it.time = now;
      if (!it.origins.includes(origin)) it.origins.push(origin);
    }
    else {
      it = { key, lang, sev, origins: [origin], title: line.trim(), detail: [], count: 1, time: now };
      items.unshift(it);
      if (items.length > 300) items.pop();
    }
    render();
    scheduleAuto(it);
    return it;
  }

  /* ---------- explicación con IA (manual y proactiva) ---------- */
  async function explain(it) {
    it.ai = { state: 'loading' };
    render();
    const r = await window.liveproject.aiAsk(
      `Lenguaje: ${it.lang}\nMensaje de error:\n${[it.title, ...it.detail].join('\n')}\n\nExplica la causa probable y cómo solucionarlo.`);
    it.ai = { state: 'done', ok: r.ok, text: r.text };
    render();
  }

  // Solo errores nuevos y solo con IA local (gratis): una consulta cada vez para no saturar el modelo.
  function scheduleAuto(it) {
    if (!autoExplain || !aiOn || !aiLocal || it.sev !== 'error' || it.ai || it.count > 1 || autoCount >= AUTO_MAX) return;
    it.ai = { state: 'queued' };
    queue.push(it);
    pump();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const it = queue.shift();
      if (!items.includes(it) || !aiOn) { it.ai = null; continue; }
      await new Promise((r) => setTimeout(r, 1200)); // deja que termine de llegar la traza completa
      autoCount++;
      await explain(it);
    }
    busy = false;
    render();
  }

  // Líneas de salida del servidor / texto de la página, con unión de trazas.
  function feedText(text, origin, stream) {
    const state = (feedText.state ||= {});
    const sk = `${origin}:${stream === 'err' ? 'err' : 'out'}`;
    const prev = state[sk];
    const buf = ((prev && prev.rest) || '') + text;
    const lines = buf.split(/\r?\n/);
    const rest = lines.pop();
    state[sk] = { rest, open: prev && prev.open, openAt: prev && prev.openAt };
    for (const line of lines) {
      if (!line.trim()) continue;
      let hit = classify(line);
      // los 4xx/5xx de las peticiones ya los registra el panel Red (con el dispositivo): evitar duplicados
      if (hit && hit.lang === 'HTTP' && origin === 'servidor') hit = null;
      const s = state[sk];
      if (hit && s.open && s.open.lang === hit.lang && s.open.title.startsWith('Traceback') && Date.now() - s.openAt < 1500 && !CONT.test(line)) {
        // última línea de un traceback de Python: es el mensaje real
        s.open.detail.push(s.open.title);
        s.open.title = line.trim();
        s.open.key = `Python|${norm(line)}`;
        s.open = null;
        render();
      } else if (hit &&!(s.open && s.open.lang === hit.lang && CONT.test(line))) {
        s.open = add({ ...hit, origin, line });
        s.openAt = Date.now();
      } else if (s.open && Date.now() - s.openAt < 1500 && (CONT.test(line) || /^\w+(?:Error|Exception)\b/.test(line))) {
        if (s.open.detail.length < 60 && s.open.count === 1) s.open.detail.push(line);
        s.openAt = Date.now();
        render();
      } else {
        s.open = null;
      }
    }
  }

  function fromConsole(device, level, message, source, lineNo) {
    const lv = typeof level === 'string' ? level : ['verbose', 'info', 'warning', 'error'][level];
    if ((lv !== 'error' && lv !== 'warning') || /Electron Security Warning/.test(message)) return;
    const where = source ? ` (${source.split('/').pop()}:${lineNo})` : '';
    const it = add({ lang: 'JavaScript', sev: lv === 'error' ? 'error' : 'warning', origin: device, line: `${message}${where}` });
    return it;
  }

  function fromLoadFailure(device, code, desc, url) {
    add({ lang: 'Navegador', sev: 'error', origin: device, line: `No se pudo cargar ${url} — ${desc} (${code})` });
  }

  function fromNetwork(device, method, url, status, error) {
    if (/favicon\.ico(?:$|\?)/.test(url)) return;
    const what = error ? `fallo de red (${error})` : `HTTP ${status}`;
    add({ lang: 'HTTP', sev: error || status >= 500 ? 'error' : 'warning', origin: device, line: `${method} ${url} — ${what}` });
  }

  // Error de JavaScript notificado por un dispositivo remoto conectado por la red local.
  function fromRemote(e) {
    const where = e.source ? ` (${e.source.split('/').pop()}:${e.line})` : '';
    add({ lang: 'JavaScript', sev: 'error', origin: `${e.device} ${e.size}`, line: `${e.message}${where}` });
  }

  const snapshot = () => items.map((i) => ({
    lang: i.lang, sev: i.sev, origins: i.origins, title: i.title, detail: i.detail, count: i.count, time: i.time,
    ai: i.ai && i.ai.state === 'done' && i.ai.ok ? i.ai.text : undefined
  }));

  function reset() { items.length = 0; queue.length = 0; autoCount = 0; langFilter = null; render(); }

  // Errores que PHP/otros imprimen dentro del propio HTML de la página.
  function fromPageText(device, text) {
    const lines = text.split('\n').slice(0, 400);
    for (const line of lines) {
      const hit = classify(line);
      if (hit && hit.lang !== 'Servidor' && hit.lang !== 'HTTP') add({ ...hit, origin: `página · ${device}`, line });
    }
  }

  /* ---------- UI ---------- */
  const fmtTime = (t) => new Date(t).toLocaleTimeString();

  function visible(it) {
    return (sevFilter === 'all' || it.sev === sevFilter) && (!langFilter || it.lang === langFilter);
  }

  function chip(lang) {
    const c = document.createElement('span');
    c.className = 'lang-tag';
    c.textContent = lang;
    const col = LANG_COLORS[lang] || '#9a9aab';
    c.style.background = col;
    return c;
  }

  function render() {
    changeCb();
    if (!ui) return;
    const errors = items.filter((i) => i.sev === 'error').length;
    ui.badge.textContent = errors || '';
    ui.badge.hidden = !errors;
    ui.counts.textContent = `${items.length} mensaje(s)`;

    // filtros por lenguaje
    ui.langs.textContent = '';
    for (const lang of [...new Set(items.map((i) => i.lang))]) {
      const b = chip(lang);
      b.classList.add('filter');
      if (langFilter === lang) b.classList.add('sel');
      b.onclick = () => { langFilter = langFilter === lang ? null : lang; render(); };
      ui.langs.appendChild(b);
    }

    ui.list.textContent = '';
    const shown = items.filter(visible);
    if (!shown.length) {
      const e = document.createElement('div');
      e.className = 'hint';
      e.textContent = items.length ? 'Ningún mensaje con este filtro.' : 'Sin mensajes. Los errores de PHP, Python, Node, JavaScript, SQL… aparecerán aquí.';
      ui.list.appendChild(e);
      return;
    }
    for (const it of shown) ui.list.appendChild(row(it));
  }

  function row(it) {
    const r = document.createElement('div');
    r.className = `msg sev-${it.sev}`;
    const head = document.createElement('div');
    head.className = 'msg-head';
    const icon = document.createElement('span'); icon.textContent = SEV[it.sev].icon; icon.title = SEV[it.sev].label;
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = `${it.origins.join(', ')} · ${fmtTime(it.time)}`;
    head.append(icon, chip(it.lang), meta);
    if (it.count > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = `×${it.count}`; head.appendChild(c); }
    const title = document.createElement('div');
    title.className = 'msg-title';
    title.textContent = it.title;
    r.append(head, title);
    if (it.detail.length) {
      const pre = document.createElement('pre');
      pre.className = 'msg-detail';
      pre.textContent = it.detail.join('\n');
      pre.hidden = !it.expanded;
      title.classList.add('expandable');
      title.onclick = () => { it.expanded = !it.expanded; pre.hidden = !it.expanded; };
      r.appendChild(pre);
    }
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copy = document.createElement('button'); copy.textContent = 'Copiar';
    copy.onclick = () => navigator.clipboard.writeText([it.title, ...it.detail].join('\n'));
    const explainBtn = document.createElement('button'); explainBtn.textContent = '💡 Explicar con IA';
    const out = document.createElement('div'); out.className = 'msg-ai'; out.hidden = !it.ai;
    if (it.ai) {
      out.classList.toggle('failed', it.ai.state === 'done' && !it.ai.ok);
      out.textContent = it.ai.state === 'queued' ? 'En cola para explicarse…' : it.ai.state === 'loading' ? 'Consultando a la IA…' : it.ai.text;
    }
    explainBtn.onclick = () => {
      if (!aiOn) {
        out.hidden = false; out.classList.add('failed'); out.textContent = '';
        out.append('No hay una IA conectada (o falta elegir un modelo). ');
        const b = document.createElement('button'); b.textContent = 'Abrir ajustes de IA'; b.onclick = openAiSettings;
        out.appendChild(b);
        return;
      }
      if (!it.ai || it.ai.state === 'done') explain(it);
    };
    actions.append(copy, explainBtn);
    r.append(actions, out);
    return r;
  }

  function init({ badge, counts, langs, list, sevSelect, clearBtn, autoBox, toast, openAi }) {
    ui = { badge, counts, langs, list, toast };
    autoBox.checked = autoExplain;
    autoBox.onchange = () => {
      autoExplain = autoBox.checked;
      try { localStorage.setItem('lp-auto-explain', autoExplain ? '1' : '0'); } catch { /* sin almacenamiento */ }
    };
    openAiSettings = openAi || openAiSettings;
    sevSelect.onchange = () => { sevFilter = sevSelect.value; render(); };
    clearBtn.onclick = reset;
    render();
  }

  return { init, feedText, fromConsole, fromLoadFailure, fromPageText, fromNetwork, fromRemote, snapshot, reset, onChange: (cb) => { changeCb = cb; }, setAi: (v, local) => { aiOn = v; aiLocal = !!local; }, classify };
})();
