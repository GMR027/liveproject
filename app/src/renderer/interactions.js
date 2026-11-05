// Registro de interacciones: guarda los cambios del DOM producidos por clics,
// escritura y envíos de formulario, y muestra el antes/después de cada cambio.
const Interactions = (() => {
  let activeId = null;
  let recording = false;
  let continuous = false;
  let follow = true;
  let filter = '';
  let selected = null;
  let seq = 0;
  let frameById = () => null;
  let deviceNameOf = () => '';
  let targetIdOf = () => null;
  let toast = () => {};
  let highlight = () => {};
  let onSelect = () => {};
  const root = {};
  const byDevice = new Map();   // id del dispositivo -> lista de interacciones
  const MAX_RECORDS = 200;
  const originCache = new Map();
  const resolvingOrigins = new Set();

  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  const btn = (parent, text, title, fn, cls = '') => {
    const b = el('button', cls, parent, text);
    b.type = 'button';
    if (title) b.title = title;
    b.onclick = (ev) => { ev.stopPropagation(); fn(); };
    return b;
  };

  const list = () => byDevice.get(activeId) || [];
  const recordById = (id) => list().find((r) => r.id === id) || null;
  const frame = () => frameById(activeId);

  function sendTo(id, msg) {
    const f = id === activeId ? frame() : frameById(id);
    if (!f || !f.view) return;
    try { f.view.send('interact', msg); } catch { /* vista aún no adjunta */ }
  }

  function sendConfig() {
    sendTo(activeId, { type: 'config', config: { continuous } });
  }

  // Enviar «start» justo al abrir la pestaña puede coincidir con el primer clic;
  // se reenvía una vez para que el preload nunca se quede sin activar.
  function startOn(id) {
    sendTo(id, { type: 'start', config: { continuous } });
    setTimeout(() => {
      if (recording && id === activeId) sendTo(id, { type: 'start', config: { continuous } });
    }, 250);
  }

  async function copyText(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copiado`);
    } catch {
      toast('No se pudo copiar al portapapeles');
    }
  }

  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const quote = (v) => JSON.stringify(v == null ? '' : String(v));
  const baseName = (p) => String(p || '').split(/[\\/]/).pop();

  /* ---------------- origen del código ---------------- */
  const originKey = (o) => `${o.source || ''}|${o.line || 0}|${o.column || 0}`;
  const asOrigin = (o) => (o ? (o.resolved ? { ...o, ...o.resolved } : o) : null);

  function resolveOrigin(o) {
    if (!o || !o.source || o.__resolveTried) return;
    o.__resolveTried = true;
    if (o.file) return;
    const key = originKey(o);
    if (originCache.has(key)) {
      const r = originCache.get(key);
      if (r && r.ok) o.resolved = r;
      return;
    }
    if (resolvingOrigins.has(key) || !window.liveproject || !window.liveproject.resolveOrigin) return;
    resolvingOrigins.add(key);
    window.liveproject.resolveOrigin(o.source, o.line || 1, o.column || 1).then((r) => {
      originCache.set(key, r || null);
      if (r && r.ok) {
        o.resolved = r;
        if (selected) renderDetail();
      }
    }).catch(() => { originCache.set(key, null); }).finally(() => resolvingOrigins.delete(key));
  }

  async function openOrigin(o) {
    if (!o) return;
    const src = asOrigin(o);
    try {
      if (src.file) {
        const r = await window.liveproject.editorOpen(src.file, src.line || 1);
        toast(r && r.ok ? `Abierto en ${r.editor}${r.line ? ` (línea ${r.line})` : ''}` : (r && r.message) || 'No se pudo abrir el editor');
      } else if (src.source) {
        const r = await window.liveproject.editorOpenUrl(src.source, src.line || 0);
        toast(r && r.ok ? `Abierto en ${r.editor}${r.line ? ` (línea ${r.line})` : ''}` : (r && r.message) || 'No se pudo abrir el editor');
      }
    } catch (e) {
      toast(String((e && e.message) || e));
    }
  }

  async function openCss(rule) {
    if (!rule) return;
    let file = rule.file || '';
    let line = rule.line || 0;
    if (!file && window.liveproject && window.liveproject.originCss) {
      try {
        const r = await window.liveproject.originCss(rule.source || '', rule.selector || '');
        if (r && r.ok) { file = r.file; line = r.line || line; }
      } catch { /* sin resolver */ }
    }
    if (file) {
      const r = await window.liveproject.editorOpen(file, line);
      toast(r && r.ok ? `CSS abierto en ${r.editor}${r.line ? ` (línea ${r.line})` : ''}` : (r && r.message) || 'No se pudo abrir el CSS');
    } else if (rule.source) {
      const r = await window.liveproject.editorOpenUrl(rule.source, line);
      toast(r && r.ok ? `CSS abierto en ${r.editor}` : (r && r.message) || 'No se pudo abrir el CSS');
    }
  }

  function renderOrigin(parent, origin, label) {
    if (!origin) return;
    resolveOrigin(origin);
    const src = asOrigin(origin);
    const box = el('div', 'int-origin', parent);
    el('span', 'int-origin-tag', box, label);
    const where = src.file ? baseName(src.file) : baseName(src.source) || 'código de la página';
    const at = src.line ? `:${src.line}${src.column ? `:${src.column}` : ''}` : '';
    const name = src.name || src.functionName || src.fn || '';
    el('span', 'int-origin-where', box, `${where}${at}${name ? ` · ${name}` : ''}`);
    if (src.resolved && src.resolved.source && src.resolved.source !== src.source) {
      el('span', 'int-origin-mapped', box, `→ ${baseName(src.resolved.source)}:${src.resolved.line}`);
    }
    if (src.api) el('span', 'int-origin-api', box, src.api);
    const actions = el('span', 'int-origin-actions', box);
    if (src.file || src.source) btn(actions, '📝', 'Abrir en el editor en la línea del origen', () => openOrigin(origin), 'mini');
    if (src.stack) {
      const d = el('details', 'int-stack', box);
      el('summary', '', d, 'pila');
      el('pre', 'snippet', d, src.stack);
    }
  }

  function renderCss(parent, rules) {
    if (!rules || !rules.length) return;
    const box = el('div', 'int-css', parent);
    el('div', 'int-origin-head', box, 'CSS que define la clase');
    for (const rule of rules) {
      const row = el('div', 'int-css-row', box);
      const name = el('button', 'int-css-rule', row, `${baseName(rule.source) || 'CSS'}${rule.line ? `:${rule.line}` : ''} · ${rule.selector}`);
      name.type = 'button';
      name.title = 'Abrir esta regla en el editor';
      name.onclick = (e) => { e.stopPropagation(); openCss(rule); };
      el('code', 'int-css-text', row, rule.cssText || '');
    }
  }

  function renderCdp(parent, cdp) {
    if (!cdp || !cdp.frames || !cdp.frames.length) return;
    const box = el('div', 'int-cdp', parent);
    el('div', 'int-origin-head', box, 'Origen exacto con CDP');
    for (const f of cdp.frames.slice(0, 6)) {
      renderOrigin(box, { source: f.url, line: f.line, column: f.column, functionName: f.functionName, api: 'CDP' }, 'CDP');
    }
  }

  async function watchCdp(selector, kind) {
    if (!window.liveproject || !window.liveproject.cdpWatch) return toast('CDP no está disponible');
    const targetId = targetIdOf(activeId);
    if (!targetId) return toast('La vista aún no está lista');
    if (!selector) return toast('Este cambio no tiene un selector al que apuntar');
    const r = await window.liveproject.cdpWatch(targetId, selector, kind || 'attribute');
    if (!r || !r.ok) return toast((r && r.error) || 'No se pudo preparar el breakpoint DOM');
    toast('Breakpoint listo: repite la interacción en la vista para capturar el origen exacto');
  }

  function onCdp(info) {
    if (!info) return;
    if (info.error) {
      if (info.error !== 'cancel' && info.error !== 'replace') toast(`CDP: ${info.error}`);
      return;
    }
    const recs = list();
    const rec = recordById(selected) || recs[recs.length - 1];
    if (rec) {
      rec.cdp = info;
      if (rec.id === selected) renderDetail();
    }
    if (info.frames && info.frames.length) toast(`Origen exacto: ${baseName(info.frames[0].url)}:${info.frames[0].line}`);
  }

  function changeText(ch) {
    if (ch.kind === 'attribute') {
      if (ch.attr === 'class') {
        const bits = [];
        if (ch.added && ch.added.length) bits.push(`+ ${ch.added.join(' ')}`);
        if (ch.removed && ch.removed.length) bits.push(`− ${ch.removed.join(' ')}`);
        if (!bits.length) bits.push(`${quote(ch.oldValue)} → ${quote(ch.newValue)}`);
        return `clase: ${bits.join(' · ')}`;
      }
      if (ch.attr === 'style' && ch.properties && ch.properties.length) {
        return `estilo: ${ch.properties.slice(0, 4).map((p) => `${p.prop} ${p.oldValue} → ${p.newValue}`).join(' · ')}`;
      }
      return `${ch.attr}: ${quote(ch.oldValue)} → ${quote(ch.newValue)}`;
    }
    if (ch.kind === 'text') return `texto: ${quote(ch.oldValue)} → ${quote(ch.newValue)}`;
    if (ch.kind === 'childList') {
      const parts = [];
      if (ch.added && ch.added.length) parts.push(`+${ch.added.length} nodo${ch.added.length === 1 ? '' : 's'}`);
      if (ch.removed && ch.removed.length) parts.push(`−${ch.removed.length} nodo${ch.removed.length === 1 ? '' : 's'}`);
      return parts.join(' · ') || 'cambios en el DOM';
    }
    return ch.kind;
  }

  const kindName = (ch) => (ch.kind === 'attribute' ? (ch.attr === 'style' ? 'estilo' : 'atributo') : ch.kind === 'childList' ? 'DOM' : 'texto');
  const kindClass = (ch) => (ch.kind === 'attribute' ? (ch.attr === 'class' ? 'attr' : 'attr2') : ch.kind);

  function matches(r) {
    if (!filter) return true;
    const q = filter.toLowerCase();
    const hay = [r.event && r.event.type, r.event && r.event.label, r.event && r.event.selector, r.url,
      ...(r.changes || []).map((ch) => [ch.label, ch.selector, ch.attr, ch.oldValue, ch.newValue, changeText(ch)].join(' '))].join(' ').toLowerCase();
    return hay.includes(q);
  }

  /* ---------------- lista ---------------- */
  function renderList(scrollToEnd = true) {
    const box = root.list;
    if (!box) return;
    box.textContent = '';
    const rows = list().filter(matches);
    if (!rows.length) {
      el('div', 'hint', box, recording
        ? 'Haz clic, escribe o envía un formulario en la vista seleccionada. Los cambios aparecerán aquí.'
        : 'Pulsa «Grabar» para empezar a registrar interacciones.');
      return;
    }
    for (const r of rows) {
      const item = el('div', 'int-item', box);
      item.dataset.id = r.id;
      if (r.id === selected) item.classList.add('sel');
      const head = el('div', 'int-head', item);
      el('span', 'int-time', head, fmtTime(r.at));
      const typeKind = (r.event && r.event.type) || 'cambio';
      const typeText = typeKind === 'background' ? 'fondo' : typeKind === 'keyboard' ? 'teclado' : typeKind;
      el('span', `int-type ${typeKind}`, head, typeText);
      el('span', 'int-target', head, (r.event && r.event.label) || 'documento');
      el('span', 'int-count', head, `${r.changes.length}`);
      el('span', 'int-ms', head, `${r.durationMs} ms`);

      const preview = el('div', 'int-preview', item);
      for (const ch of r.changes.slice(0, 4)) {
        const line = el('div', `int-mini ${kindClass(ch)}`, preview);
        el('span', 'int-kind', line, kindName(ch));
        el('span', 'int-mini-txt', line, changeText(ch));
      }
      if (r.changes.length > 4) el('div', 'int-more', preview, `+${r.changes.length - 4} cambios más`);

      item.onclick = () => { selected = r.id; renderList(false); renderDetail(); };
      item.onmouseenter = () => { if (r.event && r.event.selector) highlight(activeId, r.event.selector); };
      item.onmouseleave = () => highlight(activeId, '');
    }
    if (scrollToEnd && follow) box.scrollTop = box.scrollHeight;
  }

  /* ---------------- detalle ---------------- */
  function actionRow(parent, ch) {
    const bar = el('div', 'int-chg-actions', parent);
    if (ch.selector) {
      const h = btn(bar, '◎', 'Resaltar el elemento en la página', () => highlight(activeId, ch.selector), 'mini');
      h.dataset.action = 'highlight';
      const s = btn(bar, '✨', 'Seleccionar este elemento en el Inspector inteligente', () => onSelect(ch.selector), 'mini');
      s.dataset.action = 'inspect';
      const c = btn(bar, '⧉', 'Copiar el selector', () => copyText(ch.selector, 'Selector'), 'mini');
      c.dataset.action = 'copy-selector';
      if (window.liveproject && window.liveproject.cdpWatch) {
        btn(bar, '🎯', 'Precisar el origen exacto con CDP (repite la interacción)', () => watchCdp(ch.selector, ch.kind), 'mini');
      }
    }
  }

  function renderChange(parent, ch) {
    const row = el('div', 'int-chg', parent);
    row.onmouseenter = () => { if (ch.selector) highlight(activeId, ch.selector); };
    row.onmouseleave = () => highlight(activeId, '');
    const head = el('div', 'int-chg-head', row);
    el('span', `int-kind ${kindClass(ch)}`, head, kindName(ch));
    const main = el('div', 'int-chg-main', head);
    el('div', 'int-chg-title', main, changeText(ch));
    const sub = el('div', 'int-sub', main);
    el('span', 'int-el', sub, ch.label || '');
    if (ch.selector) el('span', 'int-sel', sub, ch.selector);
    if (ch.shadow) el('span', 'int-shadow', sub, 'shadow DOM');
    actionRow(head, ch);

    if (ch.kind === 'attribute' && ch.attr === 'class') {
      const chips = el('div', 'classbox', row);
      for (const c of ch.added || []) el('span', 'cls-chip int-add', chips, `+ ${c}`);
      for (const c of ch.removed || []) el('span', 'cls-chip int-del', chips, `− ${c}`);
    }
    if (ch.kind === 'attribute' && ch.attr === 'style' && ch.properties && ch.properties.length) {
      const table = el('table', 'styles', row);
      for (const p of ch.properties) {
        const tr = el('tr', '', table);
        el('td', 'k', tr, p.prop);
        el('td', '', tr, `${p.oldValue} → ${p.newValue}`);
      }
    }
    if (ch.kind === 'childList') {
      for (const n of ch.added || []) {
        const r = el('div', 'int-node add', row);
        el('span', 'int-node-tag', r, `+ ${n.kind === 'text' ? 'texto' : `<${n.tag}>`}`);
        el('span', 'int-node-desc', r, n.kind === 'text' ? quote(n.text) : [n.label, n.text ? quote(n.text) : ''].filter(Boolean).join(' '));
      }
      for (const n of ch.removed || []) {
        const r = el('div', 'int-node del', row);
        el('span', 'int-node-tag', r, `− ${n.kind === 'text' ? 'texto' : `<${n.tag}>`}`);
        el('span', 'int-node-desc', r, n.kind === 'text' ? quote(n.text) : [n.label, n.text ? quote(n.text) : ''].filter(Boolean).join(' '));
      }
    }
    if (ch.kind === 'text') {
      const code = el('div', 'int-textdiff', row);
      el('div', 'int-old', code, `− ${quote(ch.oldValue)}`);
      el('div', 'int-new', code, `+ ${quote(ch.newValue)}`);
    }
    if (ch.beforeHtml || ch.afterHtml) {
      const cols = el('div', 'int-code', row);
      const before = el('div', '', cols);
      el('div', 'int-code-head', before, 'Antes');
      el('pre', 'snippet', before, ch.beforeHtml || '(no existía)');
      const after = el('div', '', cols);
      el('div', 'int-code-head', after, 'Después');
      el('pre', 'snippet', after, ch.afterHtml || '(sin cambios)');
    }
    if (ch.origin) renderOrigin(row, ch.origin, 'Origen');
    if (ch.css) renderCss(row, ch.css);
  }

  function renderDetail() {
    const box = root.detail;
    if (!box) return;
    box.textContent = '';
    const r = recordById(selected);
    if (!r) {
      el('div', 'hint', box, 'Selecciona una interacción de la lista para ver los cambios y el antes/después del código.');
      return;
    }
    const head = el('div', 'int-detail-head', box);
    const title = el('div', 'int-detail-title', head);
    el('b', '', title, (r.event && r.event.label) || (r.event && r.event.type === 'background' ? 'Cambios de fondo' : 'documento'));
    if (r.event && r.event.selector) el('code', '', title, r.event.selector);
    const actions = el('div', 'int-detail-actions', head);
    btn(actions, '⧉ JSON', 'Copiar esta interacción como JSON', () => copyText(JSON.stringify(r, null, 2), 'JSON'));
    btn(actions, '⧉ Diff', 'Copiar los cambios en texto', () => copyText(r.changes.map((ch) => `${ch.selector || ch.label}: ${changeText(ch)}`).join('\n'), 'Diff'));
    if (r.event && r.event.selector) {
      btn(actions, '✨ Inspector', 'Ver este elemento en el Inspector inteligente', () => onSelect(r.event.selector));
    }
    const meta = el('div', 'int-meta', box);
    el('span', '', meta, `${fmtTime(r.at)} · ${r.event && r.event.type ? r.event.type : 'cambio'} · ${r.durationMs} ms · ${r.changes.length} cambios`);
    if (r.url) el('span', 'int-url', meta, r.url);
    if (r.truncated) el('span', 'int-warn', meta, 'registro recortado');

    if (r.event && r.event.listeners && r.event.listeners.length) {
      el('h5', '', box, 'Listeners del evento');
      for (const l of r.event.listeners.slice(0, 4)) renderOrigin(box, l, l.capture ? 'captura' : 'burbuja');
    }
    if (r.cdp) renderCdp(box, r.cdp);

    if (r.html) {
      el('h5', '', box, 'Elemento pulsado');
      const cols = el('div', 'int-code', box);
      const before = el('div', '', cols);
      el('div', 'int-code-head', before, 'Antes');
      el('pre', 'snippet', before, r.html.before || '(no existía)');
      const after = el('div', '', cols);
      el('div', 'int-code-head', after, r.html.removed ? 'Después (eliminado)' : 'Después');
      el('pre', 'snippet', after, r.html.removed ? '(el elemento se eliminó)' : (r.html.after || '(sin cambios)'));
      if (r.html.truncated) el('div', 'muted', box, 'HTML recortado para no saturar el panel.');
    }

    el('h5', '', box, `Cambios (${r.changes.length})`);
    for (const ch of r.changes) renderChange(box, ch);

    if (r.styles && r.styles.length) {
      el('h5', '', box, 'Estilos calculados del elemento');
      const table = el('table', 'styles', box);
      for (const p of r.styles) {
        const tr = el('tr', '', table);
        el('td', 'k', tr, p.prop);
        el('td', '', tr, `${p.oldValue} → ${p.newValue}`);
      }
    }
  }

  /* ---------------- barra y estado ---------------- */
  function paintBar() {
    const count = list().length;
    if (root.record) {
      root.record.textContent = recording ? '⏸ Pausar' : '⏺ Grabar';
      root.record.classList.toggle('active', recording);
    }
    if (root.status) {
      root.status.textContent = !frame() ? 'Sin vista' : recording ? `Grabando · ${count} interacción${count === 1 ? '' : 'es'}` : `${count} interacción${count === 1 ? '' : 'es'} · en pausa`;
    }
    if (root.badge) {
      root.badge.textContent = String(count);
      root.badge.hidden = count === 0;
    }
    if (root.continuous) root.continuous.checked = continuous;
  }

  function render() {
    renderList();
    renderDetail();
    paintBar();
  }

  function setRecording(on) {
    recording = !!on;
    if (recording) startOn(activeId);
    else sendTo(activeId, { type: 'stop' });
    paintBar();
    renderList();
  }

  function setView(id) {
    if (id === activeId) return;
    const previous = activeId;
    if (recording) sendTo(previous, { type: 'stop' });
    activeId = id;
    selected = null;
    if (recording) startOn(activeId);
    render();
  }

  function onReady(id) {
    if (recording && id === activeId) startOn(id);
  }

  function onBatch(id, payload) {
    if (!payload || !Array.isArray(payload.changes) || !payload.changes.length) return;
    if (!byDevice.has(id)) byDevice.set(id, []);
    const rows = byDevice.get(id);
    rows.push({ ...payload, sourceId: payload.id, id: `i-${++seq}`, device: id, deviceName: deviceNameOf(id) });
    while (rows.length > MAX_RECORDS) rows.shift();
    if (!activeId) activeId = id;
    if (id === activeId) {
      renderList();
      if (!selected) renderDetail();
      paintBar();
    } else {
      paintBar();
    }
  }

  function activate() {
    if (recording) return;
    setRecording(true);
  }

  function deactivate() {
    if (!recording) return;
    setRecording(false);
  }

  function clear() {
    sendTo(activeId, { type: 'clear' });
    if (byDevice.has(activeId)) byDevice.get(activeId).length = 0;
    selected = null;
    render();
  }

  async function exportJSON() {
    const rows = list();
    if (!rows.length) return toast('No hay interacciones que exportar');
    const data = { generatedAt: new Date().toISOString(), device: deviceNameOf(activeId), url: rows[0].url, interactions: rows };
    try {
      if (window.liveproject && window.liveproject.saveInteractions) {
        const saved = await window.liveproject.saveInteractions(data);
        if (saved && saved.file) { toast(`Guardado en ${saved.file}`); return; }
      }
    } catch { /* sin proyecto abierto: se descarga */ }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interacciones-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Interacciones exportadas');
  }

  function init(opts) {
    frameById = opts.frameById;
    deviceNameOf = opts.deviceNameOf || (() => '');
    targetIdOf = opts.targetIdOf || (() => null);
    toast = opts.toast || (() => {});
    highlight = opts.highlight || (() => {});
    onSelect = opts.onSelect || (() => {});
    Object.assign(root, {
      list: opts.list, detail: opts.detail, badge: opts.badge, record: opts.record,
      clear: opts.clearBtn, continuous: opts.continuous, follow: opts.follow,
      filter: opts.filter, status: opts.status, exportBtn: opts.exportBtn
    });
    if (root.record) root.record.onclick = () => setRecording(!recording);
    if (root.clear) root.clear.onclick = clear;
    if (root.exportBtn) root.exportBtn.onclick = exportJSON;
    if (root.continuous) root.continuous.onchange = () => { continuous = root.continuous.checked; sendConfig(); };
    if (root.follow) root.follow.onchange = () => { follow = root.follow.checked; };
    if (root.filter) root.filter.oninput = () => { filter = root.filter.value.trim(); renderList(); };
    render();
  }

  return { init, onBatch, onReady, setView, activate, deactivate, clear, render, setRecording, onCdp, isRecording: () => recording };
})();
