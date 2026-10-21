const $ = (id) => document.getElementById(id);
const stage = $('stage');
const frames = new Map(); // device.id -> { device, wrap, fit, deviceEl, screen, view, ready }
let webviewPreload = '';
let devices = [];
let currentUrl = null;
let viewUrl = null;     // página que se está viendo (se usa al crear una vista nueva)
let ready = false;
let browsing = false;   // la barra de direcciones ha abierto una página (aunque no haya proyecto)
let inspectId = null;   // dispositivo inspeccionado
let inspected = null;   // { targetId }
let activeTab = 'smart';
let lastRoot = null;
let fullId = null;     // dispositivo mostrado en modo completo (null = desactivado)
let zoomed = null;     // vista ampliada a pantalla grande
const rotated = new Set(); // ids de dispositivos girados a horizontal
let netPending = [];   // peticiones de vistas que aún no han emitido dom-ready (no se conoce su webContents)
let toolsDock = 'bottom'; // dónde viven las herramientas: 'bottom' (panel inferior) o 'side' (panel lateral derecho)
let dtMaximized = false;  // DevTools a pantalla completa

const TOOL_PANES = ['tab-smart', 'tab-inspector', 'tab-csslint', 'tab-logs', 'tab-storage', 'tab-audit'];

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

/* ---------------- salida del servidor ---------------- */
const logBuf = [];   // { text, stream }
let logFilter = '';
let logFollow = true;

// Convierte los códigos de color ANSI del servidor en HTML (muchos frameworks los emiten).
const ANSI_COLORS = {
  30: '#6b7280', 31: '#ef6b6b', 32: '#4cc38a', 33: '#e8c95a', 34: '#6c8cff', 35: '#c084fc', 36: '#3cc4d6', 37: '#eceefb',
  90: '#9b9fc4', 91: '#ff8a8a', 92: '#7ef0b0', 93: '#ffe08a', 94: '#9db0ff', 95: '#e0b0ff', 96: '#7fe6f5', 97: '#ffffff'
};
function ansiHtml(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\x1b\[([0-9;]*)m/g, (_m, codes) => {
    const ns = codes.split(';').map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
    if (!ns.length || ns.includes(0)) return '</span>';
    let color = null;
    let bold = false;
    for (const n of ns) {
      if (n === 1) bold = true;
      else if (n === 22) bold = false;
      else if (n === 39) color = null;
      else if (ANSI_COLORS[n]) color = ANSI_COLORS[n];
    }
    return `<span style="color:${color || 'inherit'};${bold ? 'font-weight:700;' : ''}">`;
  });
}

function logAppend({ text, stream }) {
  logBuf.push({ text, stream });
  while (logBuf.length > 2000) logBuf.shift();
  if (logFilter) { renderLog(); return; }
  const out = $('log-out');
  const span = document.createElement('span');
  span.className = stream || '';
  span.innerHTML = ansiHtml(text);
  out.appendChild(span);
  while (out.childNodes.length > 2000) out.removeChild(out.firstChild);
  if (logFollow) out.scrollTop = out.scrollHeight;
}

function renderLog() {
  const out = $('log-out');
  out.textContent = '';
  const q = logFilter.toLowerCase();
  for (const l of logBuf) {
    if (q && !l.text.toLowerCase().includes(q)) continue;
    const span = document.createElement('span');
    span.className = l.stream || '';
    span.innerHTML = ansiHtml(l.text);
    out.appendChild(span);
  }
  if (logFollow) out.scrollTop = out.scrollHeight;
}

function initLogBar() {
  $('log-filter').oninput = (e) => { logFilter = e.target.value.trim(); renderLog(); };
  $('log-follow').onchange = (e) => { logFollow = e.target.checked; };
  $('log-clear').onclick = () => { logBuf.length = 0; $('log-out').textContent = ''; };
  const send = async () => {
    const inp = $('log-input');
    const text = inp.value.trim();
    if (!text) return;
    const r = await window.liveproject.serverInput(text);
    inp.value = '';
    if (!r || !r.ok) toast('El servidor no acepta entrada (arrácalo con un comando propio)');
    else { logAppend({ text: `› ${text}\n`, stream: 'info' }); }
  };
  $('log-send').onclick = send;
  $('log-input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
}

/* ---------------- marcos de dispositivo ---------------- */
function layout() {
  const list = [...frames.values()];
  if (!list.length) return;
  const fit = $('chk-fit').checked;
  const availH = stage.clientHeight - 28 - 30;
  const full = fullId && frames.get(fullId);
  stage.classList.toggle('full', !!full);
  for (const f of list) {
    f.wrap.classList.toggle('full-on', f === full);
    let sz = size(f);
    if (f === full) {
      // modo completo: ignora el tamaño del dispositivo y ocupa toda el área visible
      f.fullScale = 1;
      sz = { w: Math.max(1, Math.floor(stage.clientWidth)), h: Math.max(1, Math.floor(stage.clientHeight - f.title.offsetHeight - 1)) };
    }
    f.screen.style.width = `${sz.w}px`;
    f.screen.style.height = `${sz.h}px`;
    f.view.style.width = `${sz.w}px`;
    f.view.style.height = `${sz.h}px`;
    f.nat = { w: f.deviceEl.offsetWidth, h: f.deviceEl.offsetHeight };
  }
  const z = theme.zoom / 100 || 1;
  const zr = zoomed ? { left: 0, top: 0, width: window.innerWidth / z, height: window.innerHeight / z } : null;
  for (const f of list) {
    if (f === full) {
      const s = f.fullScale;
      f.fit.style.width = `${f.nat.w * s}px`;
      f.fit.style.height = `${f.nat.h * s}px`;
      f.deviceEl.style.transform = `scale(${s})`;
      f.label.textContent = `${f.device.name} · ${f.nat.w}×${f.nat.h} · completo`;
      continue;
    }
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
  const title = f.title = el('div', 'title', f.wrap);
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
  Emulate.mount(f);
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
  if ((viewUrl || currentUrl) && (ready || browsing)) f.view.setAttribute('src', viewUrl || currentUrl);
  f.view.addEventListener('dom-ready', () => {
    f.ready = true;
    try { f.wcId = f.view.getWebContentsId(); } catch { /* sin adjuntar */ }
    if (netPending.length) feedNet([]);
    if (device.id === inspectId && !inspected) attachInspector();
    Emulate.onReady(f);
  });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-fail-load', 'did-finish-load']) f.view.addEventListener(ev, updateBack);
  f.view.addEventListener('did-navigate', (e) => {
    Routes.visited(e.url);          // las rutas que visitas se suman al panel «Rutas»
    if (e.url) viewUrl = e.url;
    // no pisar lo que el usuario está escribiendo en la barra de direcciones
    if (e.url && document.activeElement !== $('url')) $('url').value = e.url;
  });
  f.view.addEventListener('console-message', (e) => Messages.fromConsole(device.name, e.level, e.message, e.sourceId, e.line));
  f.view.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame && e.errorCode !== -3) Messages.fromLoadFailure(device.name, e.errorCode, e.errorDescription, e.validatedURL);
  });
  f.view.addEventListener('did-finish-load', () => {
    Routes.onLoaded(f);             // recoge los enlaces de la página para el panel «Rutas»
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
    if (prev.closeBtn) { prev.closeBtn.remove(); prev.closeBtn = null; }
    window.liveproject.devtoolsVisible(!$('settings').open);
  }
  zoomed = f;
  if (f) {
    f.ph = el('div', 'frame-ph');
    f.ph.style.width = `${f.wrap.offsetWidth}px`;
    f.wrap.before(f.ph);
    f.wrap.classList.add('zoomed');
    f.zoomBtn.textContent = '✕ Cerrar';
    f.closeBtn = el('button', 'zoom-close', f.wrap, '✕ Cerrar');
    f.closeBtn.type = 'button';
    f.closeBtn.title = 'Salir del modo ampliado (Esc)';
    f.closeBtn.onclick = () => setZoom(null);
    window.liveproject.devtoolsVisible(false); // las DevTools son una vista nativa que taparía la ampliación
  }
  layout();
}

function setFull(on) {
  fullId = on ? ([...frames.keys()].includes(fullId) ? fullId : (frames.has(inspectId) ? inspectId : [...frames.keys()][0]) || null) : null;
  if (on && !fullId) { $('chk-full').checked = false; return toast('No hay vistas activas'); }
  if (fullId && zoomed) setZoom(null);
  refreshFullPick();
  layout();
}

function refreshFullPick() {
  const sel = $('full-sel');
  sel.textContent = '';
  for (const f of frames.values()) { const o = el('option', '', sel); o.value = f.device.id; o.textContent = f.device.name; }
  if (fullId && !frames.has(fullId)) fullId = null;
  if (!fullId && $('chk-full').checked) fullId = frames.size ? [...frames.keys()][0] : null;
  if (!fullId) $('chk-full').checked = false;
  sel.value = fullId || '';
  $('full-pick').hidden = !$('chk-full').checked;
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
  refreshFullPick();
  layout();
}

/* ---------------- inspector (DevTools reales de Chromium) ---------------- */
let refreshCmpDevices = null;

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
  if (refreshCmpDevices) refreshCmpDevices();
}

function paneBounds() {
  const box = dtMaximized ? $('workspace') : $('dt-content');
  const r = box.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
}

function reportBounds() { if (inspected) window.liveproject.devtoolsBounds(paneBounds()); }

function detachInspector() {
  if (!inspected) return;
  inspected = null;
  window.liveproject.devtoolsHide();
}

async function attachInspector() {
  if (inspected || !toolsVisible() || activeTab !== 'devtools') return;
  const f = frames.get(inspectId);
  if (!f || !f.ready) return;
  const targetId = f.view.getWebContentsId();
  inspected = { targetId };
  $('dt-content').textContent = '';
  await window.liveproject.devtoolsShow(targetId, paneBounds());
}

function switchInspector(id) {
  detachInspector();
  $('dt-content').textContent = '';
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
  $('tab-storage').hidden = tab !== 'storage';
  $('tab-audit').hidden = tab !== 'audit';
  $('target-label').hidden = tab === 'logs' || tab === 'csslint';
  if (tab === 'devtools') attachInspector(); else detachInspector();
  if (tab === 'smart') Smart.analyze();
}

/* ---------------- herramientas: panel inferior ⇄ panel lateral derecho ---------------- */
// ¿Están visibles las herramientas ahora mismo (están en el panel inferior o en el lateral)?
function toolsVisible() {
  if (toolsDock === 'side') return !$('messages').hidden && !$('side-tools').hidden;
  return !$('bottom').hidden;
}

// Mueve la barra y los paneles de herramientas al contenedor indicado, conservando su estado.
function mountTools(barParent, paneParent) {
  const bar = $('bottom-bar');
  if (bar.parentNode !== barParent) barParent.appendChild(bar);
  else barParent.insertBefore(bar, barParent.firstElementChild);
  for (const id of TOOL_PANES) {
    const p = $(id);
    if (p.parentNode !== paneParent) paneParent.appendChild(p);
  }
}

// Traslada las herramientas al panel lateral derecho (libera espacio vertical) o de vuelta abajo.
function dockTools(to) {
  toolsDock = to;
  if (to === 'side') {
    mountTools($('tools-bar'), $('tools-host'));
    $('bottom').hidden = true;
    $('splitter').hidden = true;
    $('btn-panel').classList.remove('active');
    $('btn-panel').title = 'Traer las herramientas al panel inferior';
    $('btn-dock').textContent = '⇲ Abajo';
    $('btn-dock').title = 'Devolver las herramientas al panel inferior';
    document.body.classList.add('tools-side');
    showSide(true);
    setSide('tools');
  } else {
    mountTools($('bottom'), $('bottom'));
    $('bottom').hidden = false;
    $('splitter').hidden = false;
    $('btn-panel').classList.add('active');
    $('btn-panel').title = 'Mostrar/ocultar panel inferior';
    $('btn-dock').textContent = '⇱ Derecha';
    $('btn-dock').title = 'Colocar las herramientas en el panel lateral derecho y liberar espacio';
    document.body.classList.remove('tools-side');
    // el panel lateral no puede quedarse vacío: vuelve a Mensajes
    const active = document.querySelector('.stab2.active');
    if (active && active.dataset.side === 'tools') setSide('messages');
  }
  try { localStorage.setItem('lp-tools-dock', to); } catch { /* sin almacenamiento */ }
  layout();
  reportBounds();
}

function togglePanel(show) {
  if (toolsDock === 'side') { dockTools('bottom'); return; }
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

/* ---------------- atajos de teclado y paleta de comandos ---------------- */
const SIDE_TABS = ['messages', 'net', 'links', 'routes', 'history', 'tools'];

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); Cmd.isOpen() ? Cmd.close() : Cmd.open(); return; }
    if (Cmd.isOpen()) return;

    // Ctrl/Cmd+R: recargar las vistas (no la ventana de la app)
    if (mod && e.key.toLowerCase() === 'r' && !e.shiftKey) { e.preventDefault(); reloadAll(); toast('Vistas recargadas'); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); togglePanel($('bottom').hidden); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      dockTools(toolsDock === 'side' ? 'bottom' : 'side');
      return;
    }
    if (e.key === 'F12') { e.preventDefault(); setTab(activeTab === 'devtools' ? 'smart' : 'devtools'); return; }
    if (mod && !e.shiftKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      const name = SIDE_TABS[parseInt(e.key, 10) - 1];
      showSide(true);
      setSide(name);
      return;
    }
    if (e.key === 'Escape' && !inField && zoomed) setZoom(null);
  });
}

function initCommands() {
  const cmds = [
    { title: 'Recargar todas las vistas', hint: 'Ctrl+R', run: () => { reloadAll(); toast('Vistas recargadas'); } },
    { title: 'Reiniciar el servidor', run: () => window.liveproject.restart() },
    { title: 'Abrir carpeta de proyecto...', run: () => window.liveproject.chooseFolder() },
    { title: 'Capturar todas las vistas', run: takeShots },
    { title: 'Comparar capturas con la anterior', run: compareShots },
    { title: 'Exportar informe (HTML y Markdown)', run: exportReport },
    { title: 'Exportar la red en formato HAR', run: () => $('net-har').click() },
    { title: 'Comprobar enlaces', run: () => { showSide(true); setSide('links'); $('links-run').click(); } },
    { title: 'Explorar rutas del proyecto', run: () => { showSide(true); setSide('routes'); $('routes-run').click(); } },
    { title: 'Analizar CSS responsive', run: () => { dockTools('bottom'); setTab('csslint'); $('csl-run').click(); } },
    { title: 'Analizar la pagina (inspector inteligente)', run: () => { dockTools('bottom'); setTab('smart'); Smart.analyze(); } },
    { title: 'Abrir las DevTools', hint: 'F12', run: () => { dockTools('bottom'); setTab('devtools'); } },
    { title: 'Mover las herramientas de sitio', hint: 'Ctrl+Shift+D', run: () => dockTools(toolsDock === 'side' ? 'bottom' : 'side') },
    { title: 'Mostrar u ocultar el panel inferior', hint: 'Ctrl+B', run: () => togglePanel($('bottom').hidden) },
    { title: 'Mostrar u ocultar el panel lateral', run: () => showSide($('messages').hidden) },
    { title: 'Ajustes: Dispositivos', run: openSettings },
    { title: 'Ajustes: Inteligencia artificial', run: openAiSettings },
    { title: 'Ajustes: Tema', run: () => { openSettings(); document.querySelector('[data-stab=theme]').click(); } },
    { title: 'Manual de usuario', hint: 'Ayuda', run: openManual },
    { title: 'Alternar tema claro / oscuro', run: () => { theme.mode = theme.mode === 'dark' ? 'light' : 'dark'; applyTheme(); } }
  ];
  Cmd.init({ commands: cmds });
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

/* ---------------- navegación a rutas (panel «Rutas») ---------------- */
// Convierte una ruta del proyecto (/login) en URL absoluta según la raíz del servidor.
function routeUrl(route) {
  if (/^https?:/i.test(route)) return route;
  const base = new URL(currentUrl);
  const dir = base.pathname.replace(/[^/]*$/, ''); // carpeta de la página de inicio
  return base.origin + dir.replace(/\/$/, '') + (route.startsWith('/') ? route : `/${route}`);
}

/* ---------------- barra de direcciones ---------------- */
// Acepta una URL completa (con ruta y parámetros), un dominio sin esquema o una ruta del sitio actual.
function addressUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^[/?#]/.test(s) && (viewUrl || currentUrl)) s = new URL(s, viewUrl || currentUrl).href;
    else s = `${/^(localhost|127\.|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(s) ? 'http' : 'https'}://${s}`;
  }
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
}

// Abre en todas las vistas la dirección escrita en la barra (también webs publicadas, sin tocar el proyecto).
function openAddress() {
  const url = addressUrl($('url').value);
  if (!url) { toast('Escribe una dirección web válida (por ejemplo, https://mi-sitio.com/pagina)'); return; }
  if (!lastRoot || !currentUrl) currentUrl = url; // sin proyecto abierto, la página pasa a ser la referencia
  browsing = true;
  viewUrl = url;
  $('url').value = url;
  navigateTo(url);
  $('url').blur();
}

function initAddressBar() {
  const input = $('url');
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); openAddress(); }
    else if (e.key === 'Escape') { input.value = viewUrl || currentUrl || ''; input.blur(); }
  });
}

function navigateTo(route, onlyId) {
  if (!currentUrl) return toast('Abre un proyecto primero');
  let url;
  try { url = routeUrl(route); } catch { return toast('URL no válida'); }
  const list = onlyId ? [frames.get(onlyId)] : [...frames.values()];
  let n = 0;
  for (const f of list) {
    if (!f) continue;
    let same = false;
    try { same = f.view.getURL() === url; } catch { /* aún sin adjuntar */ }
    try {
      // Si ya está en esa página, Enter/el clic la recarga (si no, no cambiaría nada).
      if (same) f.view.reload();
      else f.view.setAttribute('src', url);
      n++;
    } catch { /* sin adjuntar */ }
  }
  if (!n) return toast('No hay vistas activas');
  viewUrl = url;
  toast(/^https?:/i.test(route) ? 'Abriendo la página en todas las vistas' : `Abriendo ${route}`);
}

// Retroceso manual: solo lo pide el usuario (p. ej. tras llegar a una página de error).
function updateBack() {
  let can = false;
  for (const f of frames.values()) {
    try { if (f.ready && f.view.canGoBack()) can = true; } catch { /* sin adjuntar */ }
  }
  $('btn-back').disabled = !can;
}

function backAll() {
  for (const f of frames.values()) {
    try { if (f.view.canGoBack()) f.view.goBack(); } catch { /* sin adjuntar */ }
  }
}

function applyState(s) {
  if (s.root && s.root !== lastRoot) {
    lastRoot = s.root;
    browsing = false;
    Sessions.start(s.root.split('/').pop());
    Messages.reset(); Net.reset(); Links.reset(); CssLint.reset(); Routes.reset(s.root);
    netPending = [];
    logBuf.length = 0;
    $('log-out').textContent = '';
    // la lista de proyectos recientes cambia al abrir uno
    window.liveproject.appInfo().then((info) => { recentProjects = info.settings.recent || []; renderRecent(); }).catch(() => {});
  }
  if (s.root) $('project-name').textContent = s.root.split('/').pop() + (s.name ? ` · ${s.name}` : '');
  const st = $('status');
  if (s.status) { st.textContent = { starting: 'iniciando…', ready: 'activo', error: 'sin respuesta' }[s.status]; st.className = `status ${s.status}`; }
  if (s.warning) toast(s.warning);
  if (s.url) {
    currentUrl = s.url;
    viewUrl = s.url;
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

// Compara la captura actual con la anterior de cada vista y guarda la imagen de cambios.
async function compareShots() {
  const shots = [];
  for (const f of frames.values()) {
    if (f.ready) shots.push({ name: f.device.name, webContentsId: f.view.getWebContentsId() });
  }
  if (!shots.length) return toast('No hay vistas para comparar');
  const r = await window.liveproject.compareScreenshots(shots);
  const res = r.results || [];
  const conBase = res.filter((x) => x.base);
  if (!conBase.length) {
    toast(`Captura base guardada en ${r.dir} (vuelve a capturar para ver las diferencias)`);
    return;
  }
  const cambios = conBase.map((x) => `${x.device}: ${x.pct.toFixed(1)}%`).join(' · ');
  toast(`Diferencias — ${cambios}`);
  const first = conBase.find((x) => x.diff);
  if (first) window.liveproject.showInFolder(first.diff);
}

// Proyectos recientes (guardados por el proceso principal).
let recentProjects = [];
function renderRecent() {
  const box = $('recent-list');
  if (!box) return;
  box.textContent = '';
  if (!recentProjects.length) {
    const d = document.createElement('div');
    d.className = 'menu-item muted';
    d.textContent = 'Sin proyectos recientes';
    box.appendChild(d);
    return;
  }
  for (const p of recentProjects) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.title = p;
    const name = p.split('/').filter(Boolean).pop() || p;
    b.innerHTML = '<span>📁 </span>';
    const s = document.createElement('span');
    s.textContent = name;
    b.appendChild(s);
    b.onclick = () => { window.liveproject.openProject(p); };
    box.appendChild(b);
  }
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
  Audit.setAi(on);
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
      for (const id of ['devices', 'project', 'ai', 'theme', 'app', 'manual']) $(`set-${id}`).hidden = b.dataset.stab !== id;
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

/* ---------------- ajustes: proyecto (comando del servidor) ---------------- */
const PROJECT_PRESETS = [
  ['PHP (servidor integrado)', { command: 'php -S 127.0.0.1:{port} -t {root}' }],
  ['Laravel', { command: 'php artisan serve --host=127.0.0.1 --port={port}' }],
  ['Django', { command: 'python3 manage.py runserver 127.0.0.1:{port}' }],
  ['Flask', { command: 'flask run --port {port}' }],
  ['Node / Vite', { command: 'npm run dev -- --port {port}' }],
  ['Next.js', { command: 'npm run dev -- --port {port}' }],
  ['Sitio estático', { command: 'python3 -m http.server {port} --directory {root}' }],
  ['Servidor ya en marcha (XAMPP, Docker…)', { url: 'http://localhost:8080' }]
];

async function loadProjectConfig() {
  const r = await window.liveproject.projectConfig();
  const st = $('proj-state');
  const ta = $('proj-json');
  if (!r.ok) { st.textContent = 'No hay ningún proyecto abierto'; ta.value = ''; return; }
  ta.value = r.text || '';
  st.textContent = r.external
    ? `Usando la dirección ${r.url}${r.path || ''} (servidor externo)`
    : r.static ? `Sitio estático servido por LiveProject en ${r.url}` : `Comando actual: ${r.command}`;
}

function initProjectConfig() {
  const sel = $('preset-project');
  for (const [name] of PROJECT_PRESETS) {
    const o = el('option', '', sel);
    o.value = name;
    o.textContent = name;
  }
  sel.onchange = () => {
    const p = PROJECT_PRESETS.find(([n]) => n === sel.value);
    if (p) $('proj-json').value = JSON.stringify(p[1], null, 2);
    sel.value = '';
  };
  $('btn-reload-cfg').onclick = loadProjectConfig;
  $('btn-save-cfg').onclick = async () => {
    const r = await window.liveproject.projectConfigWrite($('proj-json').value);
    if (!r.ok) return toast(r.message || 'No se pudo guardar');
    toast('Configuración guardada: el servidor se reinicia');
    loadProjectConfig();
  };
  loadProjectConfig();
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
  recentProjects = info.settings.recent || [];
  renderRecent();
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
  for (const id of ['messages', 'net', 'links', 'routes', 'history', 'tools']) $(`side-${id}`).hidden = id !== name;
  if (name === 'history') Sessions.render();
  if (name === 'routes') Routes.show();
  if (name === 'tools') {
    // las herramientas se trasladan al panel lateral la primera vez que se abre esta pestaña
    if (toolsDock === 'bottom') { dockTools('side'); return; }
    if (activeTab === 'devtools') attachInspector(); else if (activeTab === 'smart') Smart.analyze();
  } else if (toolsDock === 'side' && activeTab === 'devtools') {
    detachInspector();   // las DevTools no pueden quedar flotando sobre otro panel
  }
}

// Muestra u oculta el panel lateral derecho completo (mensajes, red, enlaces, rutas, historial y herramientas).
function showSide(show) {
  $('messages').hidden = !show;
  $('side-splitter').hidden = !show;
  $('btn-msgs').classList.toggle('active', show);
  if (!show && toolsDock === 'side') detachInspector();
  layout();
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
    project: $('project-name').textContent, url: viewUrl || currentUrl,
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
    logAppend(l);
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
  initAddressBar();
  $('btn-reload').onclick = reloadAll;
  $('btn-back').onclick = backAll;
  $('btn-restart').onclick = () => window.liveproject.restart();
  $('btn-shot').onclick = takeShots;
  $('btn-compare').onclick = compareShots;
  $('btn-settings').onclick = openSettings;
  $('btn-help').onclick = openManual;
  $('btn-rotate-all').onclick = rotateAll;
  $('chk-full').onchange = (e) => setFull(e.target.checked);
  $('full-sel').onchange = (e) => { fullId = e.target.value; layout(); };
  initChrome();
  $('btn-panel').onclick = () => {
    if (toolsDock === 'side') { dockTools('bottom'); return; }
    togglePanel($('bottom').hidden);
  };
  $('btn-close-panel').onclick = () => togglePanel(false);
  $('btn-dock').onclick = () => dockTools(toolsDock === 'side' ? 'bottom' : 'side');
  $('dt-max').onclick = () => {
    dtMaximized = !dtMaximized;
    $('dt-max').textContent = dtMaximized ? '⛶ Restaurar' : '⛶ Ampliar';
    $('dt-max').classList.toggle('active', dtMaximized);
    reportBounds();
  };
  $('dt-dev').onclick = () => { setSide('messages'); switchInspector(inspectId); toast('Usa el selector «Dispositivo» de la barra para cambiar de vista'); };
  $('smart-open').onclick = async () => {
    if (!currentUrl) return toast('Abre un proyecto primero');
    const r = await window.liveproject.editorOpenUrl(viewUrl || currentUrl);
    if (!r || !r.ok) toast((r && r.message) || 'No se pudo abrir el editor');
    else toast(`Abierto en ${r.editor}`);
  };
  $('inspect-target').onchange = (e) => switchInspector(e.target.value);
  document.querySelectorAll('#bottom-bar .tab').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  $('chk-fit').onchange = layout;
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe(stage);
  new ResizeObserver(reportBounds).observe($('dt-content'));
  window.addEventListener('resize', reportBounds);
  $('settings').addEventListener('close', () => window.liveproject.devtoolsVisible(true));
  Perf.init({ bar: $('perfbar'), getSelected: () => inspectId, onSelect: (id) => switchInspector(id) });
  initSplitter();
  initLogBar();
  initShortcuts();
  initCommands();
  initSettings();
  initProjectConfig();
  initTheme();
  initApp();
  await initAI();
  Messages.init({
    badge: $('msg-badge'), counts: $('msg-count'), langs: $('msg-langs'), list: $('msg-list'),
    sevSelect: $('msg-sev'), clearBtn: $('msg-clear'), autoBox: $('msg-auto'), logsBox: $('msg-logs'), toast, openAi: openAiSettings
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
    wfBtn: $('net-wf'), harBtn: $('net-har'), toast,
    deviceOf: (wc) => { const f = frameByWc(wc); return f ? f.device.name : null; },
    onFail: (r) => Messages.fromNetwork(r.device, r.method, r.url, r.status, r.error)
  });
  Links.init({
    list: $('links-list'), status: $('links-status'), btn: $('links-run'), filterSel: $('links-filter'), badge: $('links-badge'),
    getView: () => viewOf(inspectId), deviceName: () => (frames.get(inspectId) || { device: {} }).device.name || '',
    onDone: Sessions.touch
  });
  Routes.init({
    list: $('routes-list'), status: $('routes-status'), badge: $('routes-badge'),
    btn: $('routes-run'), checkBtn: $('routes-check'), clearBtn: $('routes-clear'),
    search: $('routes-search'), pageBox: $('routes-page'),
    views: () => [...frames.values()], selected: () => inspectId,
    visible: () => !$('side-routes').hidden, toast,
    root: () => lastRoot,
    navigate: navigateTo, abs: routeUrl, baseUrl: () => currentUrl
  });
  Storage.init({
    list: $('stg-list'), status: $('stg-status'), btn: $('stg-run'), clearBtn: $('stg-clear'),
    getView: () => viewOf(inspectId), toast
  });
  Audit.init({
    list: $('aud-list'), status: $('aud-status'), btn: $('aud-run'), aiBtn: $('aud-ai'), aiOut: $('aud-ai-out'),
    getView: () => viewOf(inspectId), deviceName: () => (frames.get(inspectId) || { device: {} }).device.name || '',
    baseUrl: () => currentUrl, openAi: openAiSettings, toast,
    cmpBtn: $('cmp-run'), cmpA: $('cmp-a'), cmpB: $('cmp-b'),
    devices: () => devices.filter((d) => d.enabled),
    frameById: (id) => frames.get(id),
    deviceNameOf: (id) => (frames.get(id) || { device: {} }).device.name || id,
    onDevices: (cb) => { refreshCmpDevices = cb; }
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
  Emulate.init({ frames: () => [...frames.values()], toast });
  Lan.init({
    btn: $('btn-lan'), count: $('lan-count'), dialog: $('lan'), body: $('lan-body'), toggle: $('lan-toggle'), close: $('lan-x'),
    pathOf: () => { try { const u = new URL(viewUrl || currentUrl); return u.pathname + u.search; } catch { return '/'; } }, toast
  });
  document.querySelectorAll('.stab2').forEach((b) => { b.onclick = () => setSide(b.dataset.side); });
  $('btn-report').onclick = exportReport;
  initSideSplitter();
  $('btn-msgs').onclick = () => showSide($('messages').hidden);
  setTab('smart');
  // restaurar la posición de las herramientas (abajo o en el panel lateral)
  try {
    const d = localStorage.getItem('lp-tools-dock');
    if (d === 'side') dockTools('side');
  } catch { /* sin almacenamiento */ }
})();
