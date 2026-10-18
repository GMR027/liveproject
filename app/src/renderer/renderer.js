const $ = (id) => document.getElementById(id);
const stage = $('stage');
const frames = new Map(); // device.id -> { device, wrap, fit, deviceEl, screen, view, ready }
let webviewPreload = '';
let devices = [];
let currentUrl = null;
let ready = false;
let inspectId = null;   // dispositivo inspeccionado
let inspected = null;   // { targetId }
let activeTab = 'smart';
let lastRoot = null;
let zoomed = null;     // vista ampliada a pantalla grande
const rotated = new Set(); // ids de dispositivos girados a horizontal
let netPending = [];   // peticiones de vistas que aún no han emitido dom-ready (no se conoce su webContents)

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const TYPES = { phone: 'Teléfono', tablet: 'Tableta', laptop: 'Portátil', desktop: 'Monitor' };
const PRESETS = [
  // Móviles 2025-2026 (viewport CSS; Pixel 10 y S26 base son estimaciones)
  ['iPhone 17 Pro Max', 440, 956, 'phone'], ['iPhone 17 Pro', 402, 874, 'phone'], ['iPhone 17', 402, 874, 'phone'],
  ['iPhone Air', 420, 912, 'phone'], ['iPhone 16e', 390, 844, 'phone'],
  ['Galaxy S26 Ultra', 412, 891, 'phone'], ['Galaxy S26+', 412, 891, 'phone'], ['Galaxy S26', 360, 780, 'phone'],
  ['Pixel 10 Pro XL', 448, 997, 'phone'], ['Pixel 10 Pro', 427, 952, 'phone'], ['Pixel 10', 360, 808, 'phone'],
  ['Galaxy Z Fold (plegado)', 360, 800, 'phone'], ['Galaxy Z Fold (abierto)', 600, 720, 'tablet'],
  // Tabletas
  ['iPad Pro 13"', 1032, 1376, 'tablet'], ['iPad Pro 11"', 834, 1210, 'tablet'], ['iPad Air 11"', 820, 1180, 'tablet'],
  ['iPad mini', 744, 1133, 'tablet'], ['Galaxy Tab S10', 800, 1280, 'tablet'],
  // Portátiles y monitores
  ['MacBook Air 13"', 1440, 900, 'laptop'], ['MacBook Pro 14"', 1512, 982, 'laptop'], ['Laptop 1536', 1536, 864, 'laptop'],
  ['Monitor 1080p', 1920, 1080, 'desktop'], ['Monitor 2K', 2560, 1440, 'desktop'], ['Monitor 4K (escalado 150%)', 2560, 1440, 'desktop']
];
const isMobile = (d) => d.type === 'phone' || d.type === 'tablet';
const size = (f) => (f.landscape ? { w: f.device.height, h: f.device.width } : { w: f.device.width, h: f.device.height });

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}

function log({ text, stream }) {
  const out = $('log-out');
  const span = document.createElement('span');
  span.className = stream || '';
  span.textContent = text;
  out.appendChild(span);
  while (out.childNodes.length > 2000) out.removeChild(out.firstChild);
  $('tab-logs').scrollTop = $('tab-logs').scrollHeight;
}

/* ---------------- marcos de dispositivo ---------------- */
function layout() {
  const list = [...frames.values()];
  if (!list.length) return;
  const fit = $('chk-fit').checked;
  const availH = stage.clientHeight - 28 - 30;
  for (const f of list) {
    f.screen.style.width = `${size(f).w}px`;
    f.screen.style.height = `${size(f).h}px`;
    f.view.style.width = `${size(f).w}px`;
    f.view.style.height = `${size(f).h}px`;
    f.nat = { w: f.deviceEl.offsetWidth, h: f.deviceEl.offsetHeight };
  }
  const zr = zoomed ? stage.getBoundingClientRect() : null;
  for (const f of list) {
    if (f === zoomed) {
      Object.assign(f.wrap.style, { left: `${zr.left}px`, top: `${zr.top}px`, width: `${zr.width}px`, height: `${zr.height}px` });
      const scale = Math.min(2, (zr.width - 48) / f.nat.w, (zr.height - 28 - 48) / f.nat.h);
      f.fit.style.width = `${f.nat.w * scale}px`;
      f.fit.style.height = `${f.nat.h * scale}px`;
      f.deviceEl.style.transform = `scale(${scale})`;
      f.label.textContent = `${f.device.name} · ${size(f).w}×${size(f).h} · ${Math.round(scale * 100)}%`;
      continue;
    }
    // «Ajustar»: cada dispositivo se escala para caber en la altura disponible (si no cabe a lo ancho, hay scroll horizontal)
    const scale = fit ? Math.min(1, availH / f.nat.h) : 1;
    f.fit.style.width = `${f.nat.w * scale}px`;
    f.fit.style.height = `${f.nat.h * scale}px`;
    f.deviceEl.style.transform = `scale(${scale})`;
    f.label.textContent = `${f.device.name} · ${size(f).w}×${size(f).h}${fit && scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}`;
  }
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function addFrame(device) {
  const f = { device, ready: false, landscape: rotated.has(device.id) && isMobile(device) };
  f.wrap = el('div', 'frame');
  const title = el('div', 'title', f.wrap);
  f.label = el('span', '', title);
  if (isMobile(device)) {
    f.rot = el('button', 'rot-btn', title);
    f.rot.type = 'button';
    f.rot.onclick = () => setLandscape(f, !f.landscape);
  }
  f.zoomBtn = el('button', 'zoom-btn', title);
  f.zoomBtn.type = 'button';
  f.zoomBtn.textContent = '⛶ Ampliar';
  f.zoomBtn.title = 'Ver este dispositivo en pantalla grande con su marco (Esc para salir)';
  f.zoomBtn.onclick = () => setZoom(zoomed === f ? null : f);
  f.fit = el('div', 'fit', f.wrap);
  f.deviceEl = el('div', `device ${device.type}`, f.fit);
  const bezel = el('div', 'bezel', f.deviceEl);
  f.screen = el('div', 'screen', bezel);
  if (device.type === 'laptop') el('div', 'base', f.deviceEl);
  if (device.type === 'desktop') { el('div', 'neck', f.deviceEl); el('div', 'foot', f.deviceEl); }

  setLandscape(f, f.landscape, true);
  f.view = document.createElement('webview');
  f.view.setAttribute('preload', webviewPreload);
  f.view.setAttribute('partition', 'persist:liveproject');
  if (isMobile(device)) f.view.setAttribute('useragent', UA_MOBILE);
  if (currentUrl && ready) f.view.setAttribute('src', currentUrl);
  f.view.addEventListener('dom-ready', () => {
    f.ready = true;
    try { f.wcId = f.view.getWebContentsId(); } catch { /* sin adjuntar */ }
    if (netPending.length) feedNet([]);
    if (device.id === inspectId && !inspected) attachInspector();
  });
  f.view.addEventListener('console-message', (e) => Messages.fromConsole(device.name, e.level, e.message, e.sourceId, e.line));
  f.view.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) Messages.fromLoadFailure(device.name, e.errorCode, e.errorDescription, e.validatedURL);
  });
  f.view.addEventListener('did-finish-load', () => {
    if ([...frames.values()][0] === f) {
      f.view.executeJavaScript('document.body ? document.body.innerText.slice(0, 40000) : ""').then((t) => Messages.fromPageText(device.name, t), () => {});
    }
    setTimeout(() => { if (f.ready) Perf.measure(device.id, device.name, f.view); }, 1200);
    if (device.id === inspectId && activeTab === 'smart' && $('smart-auto').checked) {
      clearTimeout(addFrame.t);
      addFrame.t = setTimeout(() => Smart.analyze(), 500);
    }
  });
  f.view.addEventListener('ipc-message', (e) => {
    if (e.channel !== 'sync' || !$('chk-sync').checked) return;
    for (const other of frames.values()) if (other.view !== f.view && other.ready) other.view.send('sync', e.args[0]);
  });
  f.screen.appendChild(f.view);
  stage.appendChild(f.wrap);
  frames.set(device.id, f);
}

function setZoom(f) {
  if (zoomed) {
    const prev = zoomed;
    prev.wrap.classList.remove('zoomed');
    for (const k of ['left', 'top', 'width', 'height']) prev.wrap.style[k] = '';
    prev.zoomBtn.textContent = '⛶ Ampliar';
    if (prev.ph) { prev.ph.remove(); prev.ph = null; }
  }
  zoomed = f;
  if (f) {
    f.ph = el('div', 'frame-ph');
    f.ph.style.width = `${f.wrap.offsetWidth}px`;
    f.wrap.before(f.ph);
    f.wrap.classList.add('zoomed');
    f.zoomBtn.textContent = '✕ Cerrar';
  }
  layout();
}

function setLandscape(f, on, noLayout) {
  f.landscape = on;
  if (on) rotated.add(f.device.id); else rotated.delete(f.device.id);
  f.deviceEl.classList.toggle('landscape', on);
  if (f.rot) {
    f.rot.textContent = on ? '⟲ Vertical' : '⟲ Horizontal';
    f.rot.title = on ? 'Volver a la orientación vertical' : 'Girar a horizontal para ver el modo apaisado';
    f.rot.classList.toggle('on', on);
  }
  if (!noLayout) layout();
}

function rotateAll() {
  const mobiles = [...frames.values()].filter((f) => isMobile(f.device));
  if (!mobiles.length) return toast('No hay teléfonos ni tabletas activos');
  const to = !mobiles.every((f) => f.landscape);
  mobiles.forEach((f) => setLandscape(f, to, true));
  layout();
  toast(to ? 'Móviles y tabletas en horizontal' : 'Móviles y tabletas en vertical');
}

function renderChips() {
  const nav = $('devices');
  nav.textContent = '';
  for (const d of devices) {
    const chip = el('span', `chip${d.enabled ? ' on' : ''}`, nav);
    chip.textContent = `${d.name} ${d.width}×${d.height}`;
    chip.onclick = () => { d.enabled = !d.enabled; window.liveproject.setDevices(devices); renderChips(); rebuildFrames(); };
  }
}

function rebuildFrames() {
  const wanted = devices.filter((d) => d.enabled);
  for (const [id, f] of frames) {
    const d = wanted.find((x) => x.id === id);
    // Si el dispositivo cambió de tamaño/tipo, se recrea.
    if (!d || d !== f.device || d.type !== f.deviceEl.classList[1]) {
      if (id === inspectId) detachInspector();
      if (zoomed === f) setZoom(null);
      f.wrap.remove(); frames.delete(id); Perf.remove(id);
    }
  }
  for (const d of wanted) if (!frames.has(d.id)) addFrame(d);
  // ordenar según la lista; solo si cambió: mover un <webview> en el DOM lo desengancha y recarga su `src`
  const wraps = wanted.map((d) => frames.get(d.id).wrap);
  const current = [...stage.querySelectorAll(':scope > .frame')];
  if (wraps.some((w, i) => w !== current[i])) for (const w of wraps) stage.appendChild(w);
  $('empty').hidden = frames.size > 0 || !!currentUrl;
  refreshTargets();
  layout();
}

/* ---------------- inspector (DevTools reales de Chromium) ---------------- */
function refreshTargets() {
  const sel = $('inspect-target');
  sel.textContent = '';
  for (const f of frames.values()) {
    const o = el('option', '', sel);
    o.value = f.device.id; o.textContent = f.device.name;
  }
  if (!frames.has(inspectId)) inspectId = frames.size ? [...frames.keys()][0] : null;
  sel.value = inspectId || '';
  if (!inspected) attachInspector();
  if (activeTab === 'smart' && sel.value !== refreshTargets.last) Smart.reset();
  refreshTargets.last = sel.value;
}

function paneBounds() {
  const r = $('tab-inspector').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
}

function reportBounds() { if (inspected) window.liveproject.devtoolsBounds(paneBounds()); }

function detachInspector() {
  if (!inspected) return;
  inspected = null;
  window.liveproject.devtoolsHide();
}

async function attachInspector() {
  if (inspected || $('bottom').hidden || activeTab !== 'devtools') return;
  const f = frames.get(inspectId);
  if (!f || !f.ready) return;
  const targetId = f.view.getWebContentsId();
  inspected = { targetId };
  $('tab-inspector').textContent = '';
  await window.liveproject.devtoolsShow(targetId, paneBounds());
}

function switchInspector(id) {
  detachInspector();
  $('tab-inspector').textContent = '';
  inspectId = id;
  $('inspect-target').value = id;
  Perf.render();
  Smart.reset();
  if (activeTab === 'smart') Smart.analyze(); else attachInspector();
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#bottom-bar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('tab-smart').hidden = tab !== 'smart';
  $('tab-inspector').hidden = tab !== 'devtools';
  $('tab-csslint').hidden = tab !== 'csslint';
  $('tab-logs').hidden = tab !== 'logs';
  $('target-label').hidden = tab === 'logs' || tab === 'csslint';
  if (tab === 'devtools') attachInspector(); else detachInspector();
  if (tab === 'smart') Smart.analyze();
}

function togglePanel(show) {
  const bottom = $('bottom');
  bottom.hidden = !show;
  $('splitter').hidden = !show;
  $('btn-panel').classList.toggle('active', show);
  if (show) { if (activeTab === 'devtools') attachInspector(); else if (activeTab === 'smart') Smart.analyze(); } else detachInspector();
  layout();
}

function initSplitter() {
  const sp = $('splitter');
  sp.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging');
    const move = (ev) => {
      const h = Math.min(window.innerHeight - 220, Math.max(90, window.innerHeight - ev.clientY));
      $('bottom').style.height = `${h}px`;
    };
    const up = () => {
      document.body.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      layout();
      reportBounds();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

/* ---------------- ajustes de dispositivos ---------------- */
let draft = [];
const slug = (s) => s.toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'dispositivo';

function renderDraft() {
  const rows = $('dev-rows');
  rows.textContent = '';
  const head = el('div', 'dev-row head', rows);
  ['', 'Nombre', 'Ancho', 'Alto', 'Tipo', ''].forEach((t) => { el('span', '', head).textContent = t; });
  draft.forEach((d, i) => {
    const row = el('div', 'dev-row', rows);
    const chk = el('input', '', row); chk.type = 'checkbox'; chk.checked = d.enabled; chk.title = 'Mostrar en pantalla';
    chk.onchange = () => { d.enabled = chk.checked; };
    const name = el('input', '', row); name.type = 'text'; name.value = d.name;
    name.oninput = () => { d.name = name.value; };
    for (const key of ['width', 'height']) {
      const n = el('input', '', row); n.type = 'number'; n.min = 100; n.max = 8000; n.value = d[key];
      n.oninput = () => { d[key] = Math.max(100, Math.min(8000, parseInt(n.value, 10) || 100)); };
    }
    const type = el('select', '', row);
    for (const [v, label] of Object.entries(TYPES)) {
      const o = el('option', '', type); o.value = v; o.textContent = label; o.selected = d.type === v;
    }
    type.onchange = () => { d.type = type.value; };
    const del = el('button', '', row); del.type = 'button'; del.textContent = '🗑'; del.title = 'Eliminar';
    del.onclick = () => { draft.splice(i, 1); renderDraft(); };
  });
}

function openAiSettings() {
  openSettings();
  document.querySelector('[data-stab=ai]').click();
}

function openSettings() {
  window.liveproject.devtoolsVisible(false);
  draft = devices.map((d) => ({ ...d }));
  renderDraft();
  $('settings').showModal();
}

function addDraft(name, width, height, type) {
  let id = slug(name), n = 2;
  while (draft.some((d) => d.id === id)) id = `${slug(name)}-${n++}`;
  draft.push({ id, name, width, height, type, enabled: true });
  renderDraft();
  $('dev-rows').scrollTop = 1e6;
}

function initSettings() {
  const sel = $('preset-select');
  PRESETS.forEach(([name, w, h, t], i) => {
    const o = el('option', '', sel); o.value = i; o.textContent = `${name} (${w}×${h})`;
  });
  sel.onchange = () => { if (sel.value !== '') addDraft(...PRESETS[sel.value]); sel.value = ''; };
  $('btn-add-dev').onclick = () => addDraft('Nuevo dispositivo', 390, 844, 'phone');
  $('btn-reset-dev').onclick = async () => {
    draft = (await window.liveproject.init()).defaults.map((d) => ({ ...d }));
    renderDraft();
  };
  $('btn-cancel').onclick = () => $('settings').close();
  $('btn-x').onclick = () => $('settings').close();
  $('settings-form').onsubmit = () => {
    devices = draft.filter((d) => d.name.trim()).map((d) => ({ ...d, name: d.name.trim() }));
    window.liveproject.setDevices(devices);
    renderChips();
    rebuildFrames();
  };
}

/* ---------------- estado del proyecto ---------------- */
function reloadAll() {
  for (const f of frames.values()) {
    try { f.view.reload(); } catch { /* aún sin cargar */ }
  }
}

function applyState(s) {
  if (s.root && s.root !== lastRoot) {
    lastRoot = s.root;
    Sessions.start(s.root.split('/').pop());
    Messages.reset(); Net.reset(); Links.reset(); CssLint.reset();
    netPending = [];
    $('log-out').textContent = '';
  }
  if (s.root) $('project-name').textContent = s.root.split('/').pop() + (s.name ? ` · ${s.name}` : '');
  const st = $('status');
  if (s.status) { st.textContent = { starting: 'iniciando…', ready: 'activo', error: 'sin respuesta' }[s.status]; st.className = `status ${s.status}`; }
  if (s.warning) toast(s.warning);
  if (s.url) {
    currentUrl = s.url;
    $('url').value = s.url;
    ready = s.status === 'ready';
    rebuildFrames();
    if (ready) {
      for (const f of frames.values()) {
        if (f.view.getAttribute('src') !== currentUrl) { f.view.setAttribute('src', currentUrl); continue; }
        try { f.view.reload(); } catch { /* aún sin cargar */ }
      }
    }
  }
}

async function takeShots() {
  const shots = [];
  for (const f of frames.values()) {
    if (f.ready) shots.push({ name: f.device.name, webContentsId: f.view.getWebContentsId() });
  }
  if (!shots.length) return toast('No hay vistas para capturar');
  const r = await window.liveproject.saveScreenshots(shots);
  toast(`${r.saved.length} captura(s) guardadas en ${r.dir}`);
}

/* ---------------- ajustes: inteligencia artificial ---------------- */
let aiCfg = null;
const GROUPS = { local: 'Local (gratis, privado)', api: 'API (pago por uso)', subscription: 'Suscripción (CLI oficial)' };

function setAiState(on) {
  const d = $('ai-dot');
  if (on) { d.classList.remove('conn-off', 'conn-bad', 'conn-wait'); d.classList.add('conn-ok'); }
  else if (d.classList.contains('conn-ok')) { d.classList.replace('conn-ok', 'conn-off'); }
  Messages.setAi(on, aiCfg.providers[aiCfg.provider].group === 'local');
  Smart.setAi(on);
  CssLint.setAi(on);
}

function aiStatus(text, ok) {
  const st = $('ai-status');
  st.textContent = text;
  st.className = `ai-status ${ok === true ? 'ok' : ok === false ? 'bad' : ''}`;
  // indicador de color: verde conectado, rojo error, ámbar comprobando, gris sin conectar
  const kind = ok === true ? 'ok' : ok === false ? 'bad' : /Comprobando/.test(text) ? 'wait' : 'off';
  for (const id of ['ai-conn-dot', 'ai-dot']) {
    const d = $(id);
    d.classList.remove('conn-ok', 'conn-bad', 'conn-wait', 'conn-off');
    d.classList.add(`conn-${kind}`);
  }
  $('ai-conn-title').textContent = { ok: 'Conectado', bad: 'Error de conexión', wait: 'Comprobando…', off: 'Sin conectar' }[kind];
  const model = $('ai-model').value.trim();
  $('ai-conn-sub').textContent = kind === 'ok' || kind === 'bad' ? text.replace(/^[●✕]\s*/, '') : model ? `Modelo elegido: ${model}` : '';
}

let aiModels = [];
function renderModels() {
  const box = $('ai-model-list');
  const q = $('ai-model-filter').value.trim().toLowerCase();
  const chosen = $('ai-model').value.trim();
  const list = aiModels.filter((m) => m.toLowerCase().includes(q));
  $('ai-model-count').textContent = aiModels.length ? `· ${aiModels.length} instalado(s)/disponible(s)` : '';
  box.textContent = '';
  if (!list.length) {
    el('div', 'model-empty', box, aiModels.length ? 'Ningún modelo coincide con la búsqueda.' : 'No hay modelos listados. Conecta y pulsa «Actualizar».');
    return;
  }
  const inUse = aiCfg.connected && aiCfg.model === chosen;
  for (const m of [...list].sort((a, b) => (b === chosen) - (a === chosen) || a.localeCompare(b))) {
    const row = el('div', `model-row${m === chosen ? ' sel' : ''}`, box);
    el('code', '', row, m);
    if (m === chosen) el('span', 'tag-sel', row, inUse ? '★ en uso' : '★ seleccionado');
    row.onclick = async () => {
      $('ai-model').value = m;
      aiCfg = await window.liveproject.aiSave({ model: m });
      aiStatus($('ai-status').textContent, $('ai-status').classList.contains('ok') ? true : $('ai-status').classList.contains('bad') ? false : undefined);
      renderModels();
    };
  }
}

async function refreshModels() {
  aiStatus('Comprobando…');
  await window.liveproject.aiSave({ provider: $('ai-provider').value, baseUrl: $('ai-base').value });
  const t = await window.liveproject.aiTest();
  aiModels = t.models || [];
  aiStatus(`${t.ok ? '● ' : '✕ '}${t.message}${t.ms ? ` · ${t.ms} ms` : ''}`, t.ok);
  renderModels();
}

function fillAI(resetBase) {
  const id = $('ai-provider').value;
  const p = aiCfg.providers[id];
  const same = id === aiCfg.provider;
  $('ai-base-l').hidden = p.kind === 'cli';
  $('ai-key-l').hidden = p.kind === 'cli' || (!p.key && id !== 'custom');
  $('ai-model-l').hidden = p.kind === 'cli';
  if (resetBase || !same) $('ai-base').value = p.base || '';
  else $('ai-base').value = aiCfg.baseUrl || p.base;
  $('ai-model').value = same ? aiCfg.model : '';
  $('ai-key').value = '';
  $('ai-key').placeholder = same && aiCfg.hasKey ? '•••••••• (guardada; escribe para reemplazar)' : id === 'custom' ? 'opcional' : 'pega tu clave aquí';
  $('ai-hint').textContent = p.hint;
  $('ai-models').textContent = '';
  aiStatus(same && aiCfg.connected ? '● Conectado' : 'Sin conectar', same && aiCfg.connected ? true : undefined);
  aiModels = [];
  renderModels();
  loadReco();
}

async function loadReco() {
  const box = $('ai-reco');
  box.textContent = 'Cargando…';
  await window.liveproject.aiSave({ provider: $('ai-provider').value, baseUrl: $('ai-base').value });
  aiCfg = await window.liveproject.aiGet();
  const r = await window.liveproject.aiRecommend();
  box.textContent = '';
  if (r.local) el('div', 'muted', box, `Tu equipo tiene ${r.ramGB} GB de RAM; las sugerencias están ajustadas a ello.`);
  if (r.note) el('div', 'muted', box, r.note);
  if (r.installed && r.installed.length) {
    el('div', 'muted', box, 'Instalados en tu equipo (clic para usar):');
    const inst = el('div', 'ai-installed', box);
    for (const m of r.installed) { const c = el('code', '', inst, m); c.onclick = () => { $('ai-model').value = m; }; }
  } else if (r.pullHint) {
    el('div', 'muted', box, 'No se detectaron modelos instalados (¿está Ollama en ejecución?).');
  }
  for (const it of r.items) {
    const row = el('div', 'reco', box);
    const code = el('code', '', row, it.model);
    code.title = 'Usar este modelo';
    code.onclick = () => { $('ai-model').value = it.model; };
    el('span', '', row, it.note);
    if (it.installed) el('span', 'tagi', row, '✓ instalado');
    else if (r.pullHint) el('span', 'muted', row, `${r.pullHint.replace('<modelo>', it.model)}`);
  }
  if (r.pullHint) el('div', 'muted', box, 'Instala un modelo con el comando indicado y pulsa «Comprobar conexión».');
}

async function testAI(connect) {
  aiStatus('Comprobando…');
  await window.liveproject.aiSave({
    provider: $('ai-provider').value, baseUrl: $('ai-base').value, model: $('ai-model').value,
    apiKey: $('ai-key').value ? $('ai-key').value : undefined
  });
  $('ai-key').value = '';
  const t = await window.liveproject.aiTest();
  const dl = $('ai-models');
  dl.textContent = '';
  for (const m of t.models) el('option', '', dl).value = m;
  aiModels = t.models;
  let note = '';
  const prov = aiCfg.providers[$('ai-provider').value];
  const wanted = $('ai-model').value.trim();
  if (t.ok && prov.group === 'local' && t.models.length && !t.models.includes(wanted)) {
    // el modelo elegido no existe en el servidor: usar uno instalado (preferir modelos de código)
    const size = (m) => parseFloat((m.match(/(\d+(?:\.\d+)?)b\b/i) || [])[1]) || 0;
    const usable = t.models.filter((m) => !/base|embed/i.test(m));
    // el modelo más grande de hasta 14B (rápido en un equipo normal); si todos son mayores, el más pequeño
    const fit = usable.filter((m) => size(m) <= 14).sort((a, b) => size(b) - size(a) || (/coder/i.test(b) ? 1 : 0) - (/coder/i.test(a) ? 1 : 0));
    const pick = fit[0] || usable.sort((a, b) => size(a) - size(b))[0] || t.models[0];
    $('ai-model').value = pick;
    await window.liveproject.aiSave({ model: pick });
    note = wanted ? ` — «${wanted}» no está instalado, se usó «${pick}»` : ` — modelo «${pick}» seleccionado`;
  }
  const needsModel = t.ok && !$('ai-model').value && aiCfg.providers[$('ai-provider').value].kind !== 'cli';
  aiStatus(`${t.ok ? '● ' : '✕ '}${t.message}${t.ms ? ` · ${t.ms} ms` : ''}${note}${needsModel ? ' — elige un modelo' : ''}`, t.ok);
  if (connect) {
    aiCfg = await window.liveproject.aiSave({ connected: t.ok });
    setAiState(t.ok && !needsModel);
  }
  aiCfg = await window.liveproject.aiGet();
  renderModels();
  return t;
}

async function initAI() {
  aiCfg = await window.liveproject.aiGet();
  const sel = $('ai-provider');
  for (const [group, label] of Object.entries(GROUPS)) {
    const og = el('optgroup', '', sel);
    og.label = label;
    for (const [id, p] of Object.entries(aiCfg.providers)) if (p.group === group) { const o = el('option', '', og); o.value = id; o.textContent = p.label; }
  }
  sel.value = aiCfg.provider;
  sel.onchange = () => fillAI(true);
  $('ai-model-filter').oninput = renderModels;
  $('ai-model-refresh').onclick = refreshModels;
  $('ai-model').addEventListener('input', renderModels);
  $('ai-connect').onclick = () => testAI(true);
  $('ai-test').onclick = () => testAI(false);
  $('ai-disconnect').onclick = async () => {
    aiCfg = await window.liveproject.aiSave({ connected: false, apiKey: '' });
    setAiState(false); fillAI(false);
  };
  document.querySelectorAll('.stab').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.stab').forEach((x) => x.classList.toggle('active', x === b));
      for (const id of ['devices', 'ai', 'theme', 'app', 'manual']) $(`set-${id}`).hidden = b.dataset.stab !== id;
      $('btn-save').hidden = b.dataset.stab !== 'devices';
    };
  });
  fillAI(false);
  setAiState(aiCfg.connected && !!(aiCfg.model || aiCfg.provider.startsWith('cli-')));
  // IA local: comprobar en silencio al iniciar (el servidor pudo arrancarse después o el modelo cambiar)
  if (aiCfg.providers[aiCfg.provider].group === 'local' && aiCfg.model) {
    const t = await window.liveproject.aiTest();
    const ok = t.ok && t.models.includes(aiCfg.model);
    aiCfg = await window.liveproject.aiSave({ connected: ok });
    setAiState(ok);
    fillAI(false);
    aiModels = t.models || [];
    renderModels();
  }
}

/* ---------------- ajustes: tema ---------------- */
const ACCENTS = ['#6c8cff', '#4cc38a', '#e8a33d', '#ef6b6b', '#b57bff', '#3cc4d6'];
const THEME_DEFAULT = { mode: 'dark', accent: '#6c8cff', zoom: 100 };
let theme = { ...THEME_DEFAULT };
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const dark = theme.mode === 'auto' ? sysDark.matches : theme.mode === 'dark';
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--accent', theme.accent);
  document.body.style.zoom = theme.zoom / 100;
  document.querySelectorAll('.theme-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === theme.mode));
  document.querySelectorAll('#theme-swatches button').forEach((b) => b.classList.toggle('active', b.dataset.color === theme.accent));
  $('theme-zoom').value = theme.zoom;
  $('theme-zoom-v').textContent = `${theme.zoom}%`;
  try { localStorage.setItem('lp-theme', JSON.stringify(theme)); } catch { /* sin almacenamiento */ }
}

function initTheme() {
  try { theme = { ...THEME_DEFAULT, ...JSON.parse(localStorage.getItem('lp-theme')) }; } catch { theme = { ...THEME_DEFAULT }; }
  const sw = $('theme-swatches');
  for (const c of ACCENTS) {
    const b = el('button', '', sw); b.type = 'button'; b.dataset.color = c; b.style.background = c; b.title = c;
    b.onclick = () => { theme.accent = c; applyTheme(); };
  }
  const pick = el('input', '', sw); pick.type = 'color'; pick.value = theme.accent; pick.title = 'Color personalizado';
  pick.oninput = () => { theme.accent = pick.value; applyTheme(); };
  document.querySelectorAll('.theme-modes button').forEach((b) => { b.onclick = () => { theme.mode = b.dataset.mode; applyTheme(); }; });
  $('theme-zoom').oninput = () => { theme.zoom = parseInt($('theme-zoom').value, 10) || 100; applyTheme(); };
  $('theme-reset').onclick = () => { theme = { ...THEME_DEFAULT }; pick.value = theme.accent; applyTheme(); };
  sysDark.addEventListener('change', () => { if (theme.mode === 'auto') applyTheme(); });
  applyTheme();
}

/* ---------------- ajustes: aplicación (actualizaciones y desinstalación) ---------------- */
const KINDS = { appimage: '(AppImage)', deb: '(paquete .deb)', dev: '(modo desarrollo)' };
let updUrl = '';

async function checkUpdates(silent) {
  const st = $('upd-status');
  $('upd-open').hidden = true;
  st.className = 'ai-status';
  if (!silent) st.textContent = 'Buscando…';
  await window.liveproject.appSettings({ updateUrl: $('upd-url').value });
  const r = await window.liveproject.checkUpdate();
  if (!r.ok) { if (!silent) { st.textContent = r.message; st.classList.add('bad'); } return; }
  if (r.newer) {
    st.textContent = `Nueva versión disponible: ${r.latest}`;
    st.classList.add('ok');
    $('upd-open').hidden = !r.url;
    updUrl = r.url;
    if (silent) toast(`LiveProject ${r.latest} disponible (Ajustes → Aplicación)`);
  } else if (!silent) {
    st.textContent = `Estás al día (${r.current})`;
    st.classList.add('ok');
  }
}

async function initApp() {
  const info = await window.liveproject.appInfo();
  $('app-version').textContent = info.version;
  initManual(info.version);
  $('app-kind').textContent = KINDS[info.kind] || '';
  $('upd-url').value = info.settings.updateUrl;
  $('upd-auto').checked = info.settings.autoCheck;
  $('uninst-info').textContent = info.kind === 'dev'
    ? 'Estás ejecutando desde el código fuente, así que no hay instalación que quitar.'
    : info.kind === 'appimage' ? 'Se eliminará el archivo AppImage con el que se ejecuta la app.'
      : 'Se desinstalará el paquete con apt (pedirá la contraseña de administrador).';
  $('uninst-btn').disabled = info.kind === 'dev';
  $('upd-check').onclick = () => checkUpdates(false);
  $('upd-open').onclick = () => window.liveproject.openDownload(updUrl);
  $('upd-auto').onchange = () => window.liveproject.appSettings({ autoCheck: $('upd-auto').checked });
  $('uninst-btn').onclick = async () => {
    const r = await window.liveproject.uninstall({ removeData: $('uninst-data').checked });
    if (r && !r.ok && r.message !== 'Cancelado.') toast(r.message);
  };
  if (info.settings.autoCheck && info.settings.updateUrl) checkUpdates(true);
}

/* ---------------- manual de usuario ---------------- */
function initManual(version) {
  $('man-version').textContent = version ? `v${version}` : '';
  const all = () => [...document.querySelectorAll('#man-body details')];
  $('man-open').onclick = () => all().forEach((d) => { d.open = true; });
  $('man-close').onclick = () => all().forEach((d) => { d.open = false; });
  $('man-search').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    let hits = 0;
    for (const d of all()) {
      const match = !q || d.textContent.toLowerCase().includes(q);
      d.hidden = !match;
      if (q) { d.open = match; if (match) hits++; }
    }
    $('man-body').classList.toggle('no-hits', !!q && !hits);
  };
}

function openManual() {
  openSettings();
  document.querySelector('[data-stab=manual]').click();
}

/* ---------------- menús y secciones plegables ---------------- */
function initChrome() {
  const closeMenus = () => document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  document.querySelectorAll('.menu').forEach((m) => {
    m.querySelector('.menu-btn').onclick = (e) => {
      e.stopPropagation();
      const was = m.classList.contains('open');
      closeMenus();
      m.classList.toggle('open', !was);
    };
    m.querySelector('.menu-pop').onclick = (e) => {
      e.stopPropagation();
      if (e.target.closest('button.menu-item')) closeMenus();
    };
  });
  document.addEventListener('click', closeMenus);
  window.addEventListener('blur', closeMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); if (zoomed) setZoom(null); } });

  // secciones plegables (se recuerda el estado)
  const sections = [['devbar', 'devbar-toggle'], ['perfwrap', 'perf-toggle']];
  const saved = (() => { try { return JSON.parse(localStorage.getItem('lp-collapsed')) || {}; } catch { return {}; } })();
  const setCollapsed = (id, on) => {
    $(id).classList.toggle('collapsed', on);
    saved[id] = on;
    try { localStorage.setItem('lp-collapsed', JSON.stringify(saved)); } catch { /* sin almacenamiento */ }
    layout();
  };
  for (const [id, btn] of sections) {
    if (saved[id]) $(id).classList.add('collapsed');
    $(btn).onclick = () => setCollapsed(id, !$(id).classList.contains('collapsed'));
  }
  $('btn-toggle-devbar').onclick = () => setCollapsed('devbar', !$('devbar').classList.contains('collapsed'));
  $('btn-toggle-perf').onclick = () => setCollapsed('perfwrap', !$('perfwrap').classList.contains('collapsed'));
}

/* ---------------- red, paneles laterales, informe ---------------- */
const frameByWc = (wc) => [...frames.values()].find((f) => f.wcId === wc);

function feedNet(batch) {
  const all = netPending.concat(batch);
  const known = all.filter((r) => frameByWc(r.wc));
  const now = Date.now();
  netPending = all.filter((r) => !frameByWc(r.wc) && now - r.start < 10000).slice(-300);
  if (known.length) Net.add(known);
}

function setSide(name) {
  document.querySelectorAll('.stab2').forEach((b) => b.classList.toggle('active', b.dataset.side === name));
  for (const id of ['messages', 'net', 'links', 'history']) $(`side-${id}`).hidden = id !== name;
  if (name === 'history') Sessions.render();
}

function initSideSplitter() {
  const sp = $('side-splitter');
  const side = $('messages');
  try { const w = parseInt(localStorage.getItem('lp-side-w'), 10); if (w) side.style.width = `${w}px`; } catch { /* sin almacenamiento */ }
  sp.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('dragging', 'dragging-col');
    const move = (ev) => { side.style.width = `${Math.min(window.innerWidth - 300, Math.max(280, window.innerWidth - ev.clientX))}px`; };
    const up = () => {
      document.body.classList.remove('dragging', 'dragging-col');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      try { localStorage.setItem('lp-side-w', parseInt(side.style.width, 10)); } catch { /* sin almacenamiento */ }
      layout();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

async function exportReport() {
  if (!Sessions.current()) return toast('Abre un proyecto primero');
  const r = Report.build({
    project: $('project-name').textContent, url: currentUrl,
    devices: devices.filter((d) => d.enabled)
  });
  const out = await window.liveproject.saveReport(r);
  toast(`Informe guardado en ${out.dir}`);
}

function viewOf(id) { const f = frames.get(id); return f && f.ready ? f.view : null; }

(async function main() {
  const init = await window.liveproject.init();
  webviewPreload = init.webviewPreload;
  devices = init.devices;
  window.liveproject.onState(applyState);
  window.liveproject.onLog((l) => {
    log(l);
    if (l.stream !== 'info') Messages.feedText(l.text, 'servidor', l.stream);
  });
  window.liveproject.onReload(reloadAll);
  window.liveproject.onNetBatch(feedNet);
  window.liveproject.onNetNav(({ wc }) => Net.navigated(wc));
  window.liveproject.onLanError((e) => Messages.fromRemote(e));
  window.liveproject.onLinksProgress((p) => { $('links-status').textContent = `Comprobando ${p.done}/${p.total}…`; });
  renderChips();
  rebuildFrames();
  if (init.state) applyState(init.state);

  $('btn-open').onclick = () => window.liveproject.chooseFolder();
  $('btn-reload').onclick = reloadAll;
  $('btn-restart').onclick = () => window.liveproject.restart();
  $('btn-shot').onclick = takeShots;
  $('btn-settings').onclick = openSettings;
  $('btn-help').onclick = openManual;
  $('btn-rotate-all').onclick = rotateAll;
  initChrome();
  $('btn-panel').onclick = () => togglePanel($('bottom').hidden);
  $('btn-close-panel').onclick = () => togglePanel(false);
  $('inspect-target').onchange = (e) => switchInspector(e.target.value);
  document.querySelectorAll('#bottom-bar .tab').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  $('chk-fit').onchange = layout;
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe(stage);
  new ResizeObserver(reportBounds).observe($('tab-inspector'));
  window.addEventListener('resize', reportBounds);
  $('settings').addEventListener('close', () => window.liveproject.devtoolsVisible(true));
  Perf.init({ bar: $('perfbar'), getSelected: () => inspectId, onSelect: (id) => switchInspector(id) });
  initSplitter();
  initSettings();
  initTheme();
  initApp();
  await initAI();
  Messages.init({
    badge: $('msg-badge'), counts: $('msg-count'), langs: $('msg-langs'), list: $('msg-list'),
    sevSelect: $('msg-sev'), clearBtn: $('msg-clear'), autoBox: $('msg-auto'), toast, openAi: openAiSettings
  });
  Smart.init({
    getView: () => { const f = frames.get(inspectId); return f && f.ready ? f.view : null; }, deviceName: () => (frames.get(inspectId) || { device: {} }).device.name || '',
    toast, openAi: openAiSettings, tree: $('smart-tree'), detail: $('smart-detail'), summary: $('smart-summary'),
    status: $('smart-status'), analyzeBtn: $('smart-analyze'), pickBtn: $('smart-pick')
  });
  Messages.onChange(Sessions.touch);
  Net.init({
    list: $('net-list'), summary: $('net-summary'), badge: $('net-badge'), typeSel: $('net-type'), search: $('net-search'),
    failBox: $('net-fail'), keepBox: $('net-keep'), clearBtn: $('net-clear'),
    deviceOf: (wc) => { const f = frameByWc(wc); return f ? f.device.name : null; },
    onFail: (r) => Messages.fromNetwork(r.device, r.method, r.url, r.status, r.error)
  });
  Links.init({
    list: $('links-list'), status: $('links-status'), btn: $('links-run'), filterSel: $('links-filter'), badge: $('links-badge'),
    getView: () => viewOf(inspectId), deviceName: () => (frames.get(inspectId) || { device: {} }).device.name || '',
    onDone: Sessions.touch
  });
  CssLint.init({
    list: $('csl-list'), status: $('csl-status'), btn: $('csl-run'), aiBtn: $('csl-ai'), aiOut: $('csl-ai-out'), badge: $('csl-badge'),
    openAi: openAiSettings, onDone: Sessions.touch,
    frames: () => [...frames.values()].filter((f) => f.ready).map((f) => ({
      id: f.device.id, name: f.device.name, view: f.view, touch: isMobile(f.device) || size(f).w <= 1100
    })),
    highlight: (id, path) => {
      const v = viewOf(id);
      if (v) v.executeJavaScript(`(${pageHighlight.toString()})(${JSON.stringify(path)}, true)`).catch(() => {});
    }
  });
  Sessions.init({ list: $('hist-list'), refreshBtn: $('hist-refresh'), reportBtn: $('hist-report'), onReport: exportReport, hasProject: () => !!lastRoot });
  Lan.init({
    btn: $('btn-lan'), count: $('lan-count'), dialog: $('lan'), body: $('lan-body'), toggle: $('lan-toggle'), close: $('lan-x'),
    pathOf: () => { try { const u = new URL(currentUrl); return u.pathname + u.search; } catch { return '/'; } }, toast
  });
  document.querySelectorAll('.stab2').forEach((b) => { b.onclick = () => setSide(b.dataset.side); });
  $('btn-report').onclick = exportReport;
  initSideSplitter();
  $('btn-msgs').onclick = () => {
    const hide = !$('messages').hidden;
    $('messages').hidden = hide;
    $('side-splitter').hidden = hide;
    $('btn-msgs').classList.toggle('active', !hide);
    layout();
  };
  setTab('smart');
})();
