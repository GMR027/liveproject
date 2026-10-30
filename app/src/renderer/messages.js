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
  let showLogs = (() => { try { return localStorage.getItem('lp-show-logs') === '1'; } catch { return false; } })();
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

  function add({ lang, sev, origin, line, keyExtra }) {
    const key = `${lang}|${norm(line)}${keyExtra ? `|${keyExtra}` : ''}`;
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
    hydrate(it);
    render();
    scheduleAuto(it);
    return it;
  }

  /* ---------- datos estructurados (arrays / objetos / JSON) ---------- */
  // Busca el primer objeto o array JSON dentro de un texto (aunque lleve prefijo, como
  // «local.ERROR: ... {"exception":...}») y lo convierte en datos expandibles.
  function jsonEnd(s, start) {
    const open = s[start], close = open === '{' ? '}' : ']';
    let depth = 0, str = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (str) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') str = false;
        continue;
      }
      if (c === '"') str = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function extractJson(text) {
    if (!text || text.length > 200000) return undefined;
    let tries = 0;
    for (let i = 0; i < text.length && tries < 20; i++) {
      const c = text[i];
      if (c !== '{' && c !== '[') continue;
      tries++;
      const end = jsonEnd(text, i);
      if (end < 0) continue;
      const chunk = text.slice(i, end + 1);
      if (chunk.length < 2) continue;
      try {
        const v = JSON.parse(chunk);
        if (v && typeof v === 'object') return v;
      } catch { /* no es JSON válido: se sigue buscando */ }
    }
    return undefined;
  }

  // Convierte en datos el JSON que venga en el título o en el detalle de un mensaje.
  function hydrate(it) {
    if (it.data !== undefined || it.dataParsed) return;
    const v = extractJson([it.title, ...it.detail].join('\n'));
    if (v !== undefined) {
      it.data = v; it.dataParsed = true; it.dataExpanded = new Set();
    }
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
  // Ruido interno de Chromium/Electron (p. ej. GPU/VSync) cuando el «servidor» es otra app Electron: no es un error del proyecto.
  const CHROMIUM_LOG = /^\[\d+:\d{4}\/\d{6}(?:\.\d+)?:(?:ERROR|WARNING|INFO):[\w.]+\(\d+\)\]/;

  function feedText(text, origin, stream) {
    const state = (feedText.state ||= {});
    const sk = `${origin}:${stream === 'err' ? 'err' : 'out'}`;
    const prev = state[sk];
    const buf = ((prev && prev.rest) || '') + text;
    const lines = buf.split(/\r?\n/);
    const rest = lines.pop();
    state[sk] = { rest, open: prev && prev.open, openAt: prev && prev.openAt, json: prev && prev.json };
    for (const line of lines) {
      if (!line.trim()) continue;
      if (CHROMIUM_LOG.test(line)) continue;
      let hit = classify(line);
      // los 4xx/5xx de las peticiones ya los registra el panel Red (con el dispositivo): evitar duplicados
      if (hit && hit.lang === 'HTTP' && origin === 'servidor') hit = null;
      const s = state[sk];
      const trimmed = line.trim();
      // Bloques JSON que vienen en las líneas siguientes a un mensaje (Laravel, Node, etc.).
      if (s.json) {
        s.json.lines.push(line);
        const joined = s.json.lines.join('\n');
        const end = jsonEnd(joined, s.json.start);
        if (end >= 0) {
          if (s.json.it) { s.json.it.detail.push(joined); hydrate(s.json.it); render(); }
          s.json = null; s.openAt = Date.now();
        } else if (joined.length > 200000 || s.json.lines.length > 500) {
          s.json = null;
        }
        continue;
      }
      if (s.open && Date.now() - s.openAt < 4000 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        if (jsonEnd(trimmed, 0) >= 0) {
          s.open.detail.push(trimmed);
          s.openAt = Date.now();
          hydrate(s.open);
          render();
          continue;
        }
        s.json = { lines: [line], it: s.open, start: line.indexOf(trimmed[0]) };
        s.openAt = Date.now();
        continue;
      }
      if (hit && s.open && s.open.lang === hit.lang && s.open.title.startsWith('Traceback') && Date.now() - s.openAt < 1500 && !CONT.test(line)) {
        // última línea de un traceback de Python: es el mensaje real
        const openIt = s.open;
        openIt.detail.push(openIt.title);
        openIt.title = line.trim();
        openIt.key = `Python|${norm(line)}`;
        s.open = null;
        hydrate(openIt);
        render();
      } else if (hit &&!(s.open && s.open.lang === hit.lang && CONT.test(line))) {
        s.open = add({ ...hit, origin, line });
        s.openAt = Date.now();
      } else if (s.open && Date.now() - s.openAt < 1500 && (CONT.test(line) || /^\w+(?:Error|Exception)\b/.test(line))) {
        if (s.open.detail.length < 60 && s.open.count === 1) s.open.detail.push(line);
        s.openAt = Date.now();
        hydrate(s.open);
        render();
      } else {
        s.open = null;
      }
    }
  }

  function fromConsole(device, level, message, source, lineNo) {
    const lv = typeof level === 'string' ? level : ['verbose', 'info', 'warning', 'error'][level];
    const isErr = lv === 'error';
    const isWarn = lv === 'warning';
    // Por defecto solo se recogen errores y avisos; con la opción activa también los log/info.
    if (!isErr && !isWarn && !(showLogs && (lv === 'info' || lv === 'verbose' || lv === 'debug'))) return;
    if (/Electron Security Warning/.test(message)) return;
    const where = source ? ` (${source.split('/').pop()}:${lineNo})` : '';
    const sev = isErr ? 'error' : isWarn ? 'warning' : 'notice';
    const it = add({ lang: 'JavaScript', sev, origin: device, line: `${message}${where}` });
    return it;
  }

  // Consola estructurada enviada por el preload de la vista: conserva arrays y objetos
  // reales (el evento console-message de Electron solo da «[object Object]»).
  function fromConsoleData(device, payload) {
    if (!payload || typeof payload !== 'object') return;
    const lv = payload.level === 'warn' ? 'warning' : payload.level;
    const isErr = lv === 'error';
    const isWarn = lv === 'warning';
    if (!isErr && !isWarn && !(showLogs && (lv === 'info' || lv === 'log' || lv === 'verbose' || lv === 'debug'))) return;
    const where = payload.source ? ` (${String(payload.source).split('/').pop().split('?')[0]}:${payload.line || 0})` : '';
    const sev = isErr ? 'error' : isWarn ? 'warning' : 'notice';
    const args = Array.isArray(payload.args) ? payload.args : [];
    // Los objetos/arrays distintos registrados desde la misma línea no deben fusionarse.
    const keyExtra = args.length ? JSON.stringify(args).slice(0, 1000) : '';
    const it = add({ lang: 'JavaScript', sev, origin: device, line: `${payload.text || '(objeto)'}${where}`, keyExtra });
    if (!it) return;
    if (args.length) {
      it.data = args.length === 1 ? args[0] : { args };
      it.dataParsed = true;
      if (!it.dataExpanded) it.dataExpanded = new Set();
      render();
    }
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

  function reset() { items.length = 0; queue.length = 0; autoCount = 0; langFilter = null; feedText.state = {}; render(); }

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

  /* ---------- visor de arrays y objetos ---------- */
  const SPECIAL = {
    undefined: (v) => v.value || 'undefined',
    function: (v) => v.value || '[Function]',
    error: (v) => `${v.name || 'Error'}: ${v.message || ''}`,
    date: (v) => `Date(${v.value})`,
    regexp: (v) => v.value || '',
    element: (v) => v.value || '[Element]',
    node: (v) => v.value || '[Nodo]',
    window: () => '[Window]',
    circular: () => '[Circular]',
    truncated: (v) => v.value || '…',
    bigint: (v) => v.value || '',
    symbol: (v) => v.value || '',
    number: (v) => v.value || ''
  };
  const isDataObject = (v) => v !== null && typeof v === 'object';
  const isContainer = (v) => isDataObject(v) && !v.__lpType;

  function specialText(v) {
    const f = SPECIAL[v.__lpType];
    return f ? f(v) : JSON.stringify(v);
  }

  function jsonSummary(v) {
    if (Array.isArray(v)) return `Array(${v.length})`;
    const n = Object.keys(v).length;
    return `{${n}}`;
  }

  function addJsonValue(parent, value, key, path, depth, it, budget) {
    if (budget.n-- <= 0) return;
    const row = document.createElement('div');
    row.className = 'json-row';
    const keyEl = document.createElement('span');
    keyEl.className = 'json-key';
    keyEl.textContent = key;
    parent.appendChild(row);
    if (!isContainer(value)) {
      row.appendChild(keyEl);
      const val = document.createElement('span');
      if (value === null) { val.className = 'json-null'; val.textContent = 'null'; }
      else if (typeof value === 'string') { val.className = 'json-str'; val.textContent = `"${value}"`; }
      else if (typeof value === 'number') { val.className = 'json-num'; val.textContent = String(value); }
      else if (typeof value === 'boolean') { val.className = 'json-bool'; val.textContent = String(value); }
      else { val.className = 'json-special'; val.textContent = specialText(value); }
      if (value && value.__lpType === 'error' && value.stack) val.title = value.stack;
      row.appendChild(val);
      return;
    }
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    const open = it.dataExpanded.has(path) || depth === 0;
    const tog = document.createElement('span');
    tog.className = 'json-tog';
    tog.textContent = entries.length ? (open ? '▾' : '▸') : '·';
    const sum = document.createElement('span');
    sum.className = 'json-summ';
    sum.textContent = jsonSummary(value);
    row.append(tog, keyEl, sum);
    if (!entries.length) return;
    const kids = document.createElement('div');
    kids.className = 'json-children';
    kids.hidden = !open;
    parent.appendChild(kids);
    row.title = open ? 'Contraer' : 'Expandir';
    row.onclick = () => {
      const nowOpen = kids.hidden;
      kids.hidden = !nowOpen;
      tog.textContent = nowOpen ? '▾' : '▸';
      row.title = nowOpen ? 'Contraer' : 'Expandir';
      if (nowOpen) it.dataExpanded.add(path); else it.dataExpanded.delete(path);
    };
    for (const [k, v] of entries) {
      addJsonValue(kids, v, Array.isArray(value) ? `${k}:` : `${k}:`, `${path}.${k}`, depth + 1, it, budget);
      if (budget.n <= 0) { const more = document.createElement('div'); more.className = 'json-summ'; more.textContent = '… (demasiados datos)'; kids.appendChild(more); break; }
    }
  }

  function fillData(it, box) {
    if (!it.dataExpanded) it.dataExpanded = new Set();
    box.textContent = '';
    const bar = document.createElement('div');
    bar.className = 'json-bar';
    const copy = document.createElement('button');
    copy.textContent = '⧉ Copiar JSON';
    copy.onclick = () => {
      const text = JSON.stringify(it.data, null, 2);
      navigator.clipboard.writeText(text).then(() => ui && ui.toast && ui.toast('JSON copiado'), () => {});
    };
    const hint = document.createElement('span');
    hint.className = 'muted';
    hint.textContent = Array.isArray(it.data) ? `${it.data.length} elementos · pulsa para desplegar` : 'pulsa cada fila para desplegar';
    bar.append(copy, hint);
    box.appendChild(bar);
    const tree = document.createElement('div');
    tree.className = 'json-tree';
    box.appendChild(tree);
    const rootKey = '';
    addJsonValue(tree, it.data, rootKey, '$', 0, it, { n: 2500 });
  }

  function dataBlock(it) {
    const box = document.createElement('div');
    box.className = 'msg-data';
    box.hidden = !it.dataOpen;
    if (it.dataOpen) fillData(it, box);
    return box;
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
    if (it.data !== undefined) {
      if (!it.dataExpanded) it.dataExpanded = new Set();
      const dataBtn = document.createElement('button');
      dataBtn.textContent = it.dataOpen ? '🧾 Ocultar datos' : '🧾 Ver datos';
      dataBtn.title = 'Mostrar el array u objeto como árbol desplegable';
      dataBtn.classList.toggle('active', !!it.dataOpen);
      dataBtn.onclick = () => { it.dataOpen = !it.dataOpen; render(); };
      actions.append(dataBtn);
    }
    r.append(actions, out);
    if (it.data !== undefined) r.appendChild(dataBlock(it));
    return r;
  }

  function init({ badge, counts, langs, list, sevSelect, clearBtn, autoBox, logsBox, toast, openAi }) {
    ui = { badge, counts, langs, list, toast };
    autoBox.checked = autoExplain;
    autoBox.onchange = () => {
      autoExplain = autoBox.checked;
      try { localStorage.setItem('lp-auto-explain', autoExplain ? '1' : '0'); } catch { /* sin almacenamiento */ }
    };
    if (logsBox) {
      logsBox.checked = showLogs;
      logsBox.onchange = () => {
        showLogs = logsBox.checked;
        try { localStorage.setItem('lp-show-logs', showLogs ? '1' : '0'); } catch { /* sin almacenamiento */ }
        render();
      };
    }
    openAiSettings = openAi || openAiSettings;
    sevSelect.onchange = () => { sevFilter = sevSelect.value; render(); };
    clearBtn.onclick = reset;
    render();
  }

  return { init, feedText, fromConsole, fromConsoleData, fromLoadFailure, fromPageText, fromNetwork, fromRemote, snapshot, reset, onChange: (cb) => { changeCb = cb; }, setAi: (v, local) => { aiOn = v; aiLocal = !!local; }, classify };
})();
