const { app, BrowserWindow, WebContentsView, dialog, ipcMain, webContents, shell, session, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadConfig, DEFAULT_DEVICES } = require('./config');
const { ServerManager, waitForServer } = require('./server-manager');
const { createWatcher } = require('./watcher');
const ai = require('./ai');
const appManager = require('./app-manager');
const history = require('./history');
const { checkLinks } = require('./linkcheck');
const { scanRoutes } = require('./routes');
const { startNetworkCapture } = require('./network');
const { createLan } = require('./lan');
const { ensureDesktopEntry, ICON } = require('./desktop-entry');

if (process.platform === 'linux') app.setDesktopName('liveproject.desktop');

let win = null;
let cfg = null;
let watcher = null;
const server = new ServerManager();
server.on('log', (l) => send('log', l));
server.on('exit', () => send('project:state', state({ status: 'error' })));
const lan = createLan({
  getTarget: () => (cfg ? cfg.url : ''),
  onError: (e) => send('lan:error', e),
  onClients: (list) => send('lan:clients', list)
});

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// Primer argumento que no sea flag ni la ruta de la app/electron => carpeta del proyecto.
function folderFromArgv(argv) {
  const rest = argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  const dir = rest[0] && path.resolve(rest[0]);
  return dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null;
}

const devicesFile = () => path.join(app.getPath('userData'), 'devices.json');
function loadDevices() {
  try {
    const list = JSON.parse(fs.readFileSync(devicesFile(), 'utf8'));
    if (Array.isArray(list) && list.length) return list;
  } catch { /* primera ejecución */ }
  return DEFAULT_DEVICES;
}

function state(extra = {}) {
  return {
    root: cfg && cfg.root,
    name: cfg && cfg.name,
    url: cfg && cfg.url + cfg.path,
    warning: cfg && cfg.warning,
    ...extra
  };
}

async function stopProject() {
  if (watcher) { await watcher.close(); watcher = null; }
  await server.stop();
}

async function openProject(folder) {
  await stopProject();
  send('project:state', { root: folder, status: 'starting' });
  cfg = await loadConfig(folder);
  send('project:state', state({ status: 'starting' }));
  const ok = await server.start(cfg);
  send('project:state', state({ status: ok ? 'ready' : 'error' }));
  // guarda el proyecto en la lista de recientes
  try {
    const list = (appManager.info().settings.recent || []).filter((p) => p !== folder);
    list.unshift(folder);
    appManager.saveSettings({ recent: list });
  } catch { /* sin ajustes */ }
  watcher = createWatcher(cfg, async (files) => {
    send('log', { text: `Cambio: ${files.join(', ')}\n`, stream: 'info' });
    // Si el backend se reinicia solo (Flask, nodemon...), esperar a que vuelva antes de recargar.
    await waitForServer(cfg.url + cfg.path, 15000);
    send('reload', files);
    lan.reload();
  });
  if (win) win.setTitle(`LiveProject — ${path.basename(folder)}`);
}

async function chooseFolder() {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) await openProject(r.filePaths[0]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    title: 'LiveProject',
    icon: ICON,
    backgroundColor: '#1e1e24',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

ipcMain.handle('app:init', () => ({
  webviewPreload: pathToFileURL(path.join(__dirname, '..', 'webview-preload.js')).href,
  devices: loadDevices(),
  defaults: DEFAULT_DEVICES,
  state: cfg ? state({ status: 'ready' }) : null
}));
ipcMain.handle('devices:set', (_e, list) => {
  fs.mkdirSync(path.dirname(devicesFile()), { recursive: true });
  fs.writeFileSync(devicesFile(), JSON.stringify(list, null, 2));
});
ipcMain.handle('app:info', () => appManager.info());
ipcMain.handle('app:settings', (_e, patch) => appManager.saveSettings(patch || {}));
ipcMain.handle('app:check-update', () => appManager.checkUpdate());
ipcMain.handle('app:open-download', (_e, url) => appManager.openDownload(String(url)));
ipcMain.handle('app:uninstall', (_e, opts) => appManager.uninstall(win, { removeData: !!(opts && opts.removeData) }));
ipcMain.handle('ai:get', () => ai.publicConfig());
ipcMain.handle('ai:save', (_e, patch) => ai.save(patch));
ipcMain.handle('ai:test', () => ai.test());
ipcMain.handle('ai:recommend', () => ai.recommend());
ipcMain.handle('ai:ask', (_e, prompt) => ai.ask(String(prompt).slice(0, 20000)));
// ---------- emulación por vista (red, CPU y preferencias del sistema) ----------
// Se aplica con el protocolo de DevTools sobre el webContents de cada <webview>.
// Al abrir las DevTools reales, Chromium desconecta la sesión del depurador:
// por eso, al cerrarlas se vuelve a aplicar la emulación que tenía la vista.
const EMU_DEFAULT = { net: 'none', cpu: 1, scheme: 'auto', motion: 'auto', forced: 'auto' };
const NET_PROFILES = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  '3g': { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 },   // 400 kbps
  '4g': { offline: false, latency: 40, downloadThroughput: 1250000, uploadThroughput: 625000 }, // 10 Mbps
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }
};
const emuState = new Map(); // id del webContents -> ajustes

const emuIsDefault = (s) => s.net === 'none' && s.cpu === 1 && s.scheme === 'auto' && s.motion === 'auto' && s.forced === 'auto';

async function applyEmulation(targetId, patch) {
  const wc = webContents.fromId(targetId);
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'destino no disponible' };
  const next = { ...EMU_DEFAULT, ...(emuState.get(targetId) || {}), ...(patch || {}) };
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (e) {
    // las DevTools reales tienen el control del destino: no se puede emular por CDP
    return { ok: false, error: 'devtools' };
  }
  try {
    await dbg.sendCommand('Network.enable');
    await dbg.sendCommand('Network.emulateNetworkConditions', NET_PROFILES[next.net] || NET_PROFILES.none);
    await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: next.cpu > 1 ? next.cpu : 1 });
    const features = [];
    if (next.scheme !== 'auto') features.push({ name: 'prefers-color-scheme', value: next.scheme });
    if (next.motion === 'reduce') features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
    if (next.forced === 'active') features.push({ name: 'forced-colors', value: 'active' });
    await dbg.sendCommand('Emulation.setEmulatedMedia', { features });
    emuState.set(targetId, next);
    return { ok: true, state: next };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// Inspector: DevTools reales de Chromium incrustadas en una WebContentsView colocada sobre el panel inferior.
let dtView = null;
let dtTarget = null;
function closeDevTools() {
  const target = dtTarget;
  if (dtTarget && !dtTarget.isDestroyed() && dtTarget.isDevToolsOpened()) dtTarget.closeDevTools();
  if (dtView) {
    if (win && !win.isDestroyed()) win.contentView.removeChildView(dtView);
    if (!dtView.webContents.isDestroyed()) dtView.webContents.close();
  }
  dtView = null; dtTarget = null;
  // al cerrarse las DevTools, Chromium libera el destino: se re-aplica la emulación que tenía
  if (target && !target.isDestroyed() && emuState.has(target.id)) {
    const id = target.id;
    setTimeout(() => { applyEmulation(id, {}); }, 500);
  }
}
ipcMain.handle('devtools:show', (_e, { targetId, bounds }) => {
  closeDevTools();
  const target = webContents.fromId(targetId);
  if (!target || !win) return false;
  dtView = new WebContentsView();
  win.contentView.addChildView(dtView);
  dtView.setBounds(bounds);
  dtTarget = target;
  target.setDevToolsWebContents(dtView.webContents);
  target.openDevTools();
  return true;
});
ipcMain.handle('devtools:bounds', (_e, bounds) => { if (dtView) dtView.setBounds(bounds); });
ipcMain.handle('devtools:visible', (_e, v) => { if (dtView) dtView.setVisible(!!v); });
ipcMain.handle('devtools:hide', closeDevTools);

ipcMain.handle('emulate:set', (_e, { targetId, patch }) => applyEmulation(targetId, patch));

// ---------- abrir un fichero del proyecto en el editor de código ----------
const { spawn, execFileSync } = require('child_process');
const EDITORS = [
  { cmd: 'code', args: ['-g'], label: 'Visual Studio Code' },
  { cmd: 'codium', args: ['-g'], label: 'VSCodium' },
  { cmd: 'code-insiders', args: ['-g'], label: 'VS Code Insiders' },
  { cmd: 'subl', args: [], label: 'Sublime Text' },
  { cmd: 'zed', args: [], label: 'Zed' },
  { cmd: 'gedit', args: [], label: 'gedit' },
  { cmd: 'kate', args: [], label: 'Kate' },
  { cmd: 'mousepad', args: [], label: 'Mousepad' },
  { cmd: 'xed', args: [], label: 'Text Editor' },
  { cmd: 'xdg-open', args: [], label: 'el editor del sistema' }
];
const hasCmd = (cmd) => {
  try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; }
};
function openInEditor(abs, line) {
  if (!fs.existsSync(abs)) return { ok: false, message: `No se encuentra ${path.basename(abs)}` };
  const env = (process.env.LIVEPROJECT_EDITOR || '').trim();
  const list = env
    ? [{ cmd: env.split(/\s+/)[0], args: env.split(/\s+/).slice(1), label: env }]
    : EDITORS;
  for (const ed of list) {
    if (!hasCmd(ed.cmd)) continue;
    const atLine = ed.args.includes('-g') && line ? `${abs}:${line}` : abs;
    try {
      const p = spawn(ed.cmd, [...ed.args, atLine], { detached: true, stdio: 'ignore' });
      p.on('error', () => { /* sin editor */ });
      p.unref();
      return { ok: true, editor: ed.label, file: abs, line: line || null };
    } catch { /* siguiente editor */ }
  }
  return { ok: false, message: 'No se encontró ningún editor de código (instala VS Code o define LIVEPROJECT_EDITOR)' };
}
ipcMain.handle('editor:open', (_e, { file, line }) => {
  if (!file) return { ok: false, message: 'Esa ruta no procede de un fichero del proyecto' };
  const abs = path.isAbsolute(file) ? file : path.join(cfg ? cfg.root : process.cwd(), file);
  return openInEditor(abs, line);
});
// Abre en el editor el fichero del proyecto que corresponde a una URL de la vista.
ipcMain.handle('editor:open-url', (_e, { url }) => {
  if (!cfg || !cfg.root) return { ok: false, message: 'Abre un proyecto primero' };
  let p;
  try { p = decodeURIComponent(new URL(url).pathname); } catch { return { ok: false, message: 'URL no válida' }; }
  if (!p || p === '/') p = '/index.html';
  const cands = [path.join(cfg.root, p), path.join(cfg.root, p, 'index.html'), path.join(cfg.root, `${p}.html`), path.join(cfg.root, 'public', p)];
  for (const c of cands) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return openInEditor(c, 0); } catch { /* siguiente */ }
  }
  return { ok: false, message: 'Esa página no corresponde a un fichero del proyecto (URL reescrita por el servidor)' };
});

ipcMain.handle('links:check', (_e, urls) => checkLinks(urls.map(String), (done, total) => send('links:progress', { done, total })));
ipcMain.handle('routes:scan', () => scanRoutes(cfg ? cfg.root : null, cfg ? cfg.ignore : null));
ipcMain.handle('history:save', (_e, session) => { if (cfg) history.save(cfg.root, session); });
ipcMain.handle('history:list', () => (cfg ? history.list(cfg.root) : []));
ipcMain.handle('history:load', (_e, id) => { try { return cfg ? history.load(cfg.root, id) : null; } catch { return null; } });
ipcMain.handle('history:delete', (_e, id) => { if (cfg) history.remove(cfg.root, id); });
ipcMain.handle('shell:show', (_e, file) => { if (file) shell.showItemInFolder(String(file)); return true; });
ipcMain.handle('net:har', (_e, har) => {  const dir = path.join(cfg ? cfg.root : app.getPath('documents'), '.liveproject', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `red-${new Date().toISOString().replace(/[:.]/g, '-')}.har`);
  fs.writeFileSync(base, JSON.stringify(har, null, 2));
  return { dir, file: base };
});
ipcMain.handle('report:save', (_e, { html, md }) => {
  const dir = path.join(cfg ? cfg.root : app.getPath('documents'), '.liveproject', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `informe-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.writeFileSync(`${base}.html`, html);
  fs.writeFileSync(`${base}.md`, md);
  shell.showItemInFolder(`${base}.html`);
  return { dir, html: `${base}.html`, md: `${base}.md` };
});
ipcMain.handle('lan:start', async () => {
  try { return { ok: true, ...(await lan.start()) }; } catch (e) { return { ok: false, error: e.message, ...lan.status() }; }
});
ipcMain.handle('lan:stop', () => { lan.stop(); return lan.status(); });
ipcMain.handle('lan:status', () => lan.status());
ipcMain.handle('project:choose', chooseFolder);
ipcMain.handle('project:open', (_e, folder) => {
  const dir = String(folder || '');
  if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) { openProject(dir); return { ok: true }; }
  return { ok: false };
});
// Lee y escribe el archivo .liveproject.json del proyecto abierto.
ipcMain.handle('project:config', () => {
  if (!cfg) return { ok: false, root: null, text: '' };
  const file = path.join(cfg.root, '.liveproject.json');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* no existe */ }
  return { ok: true, root: cfg.root, text, command: cfg.command, url: cfg.url, path: cfg.path, external: cfg.external, static: cfg.static };
});
ipcMain.handle('project:config-write', (_e, { text }) => {
  if (!cfg) return { ok: false, message: 'No hay ningún proyecto abierto' };
  const file = path.join(cfg.root, '.liveproject.json');
  const body = String(text == null ? '' : text);
  try { JSON.parse(body); } catch (e) { return { ok: false, message: `JSON no válido: ${e.message}` }; }
  try {
    fs.writeFileSync(file, body);
    openProject(cfg.root);
    return { ok: true, file };
  } catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle('project:restart', () => cfg && openProject(cfg.root));
ipcMain.handle('server:input', (_e, text) => {
  const ok = server.write(String(text == null ? '' : text).slice(0, 2000));
  return { ok };
});
// ---------- cookies de las vistas ----------
ipcMain.handle('storage:cookies', async (_e, url) => {
  const ses = session.fromPartition('persist:liveproject');
  try {
    const list = await ses.cookies.get({ url: String(url || '') });
    return (list || []).map((c) => ({
      name: c.name, value: String(c.value || '').slice(0, 200), domain: c.domain, path: c.path,
      secure: !!c.secure, expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString().slice(0, 10) : null
    }));
  } catch { return []; }
});
ipcMain.handle('storage:cookie-delete', async (_e, { domain, name, path }) => {
  const ses = session.fromPartition('persist:liveproject');
  try {
    await ses.cookies.remove(domain, name, path || '/');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('storage:cookies-clear', async (_e, url) => {
  const ses = session.fromPartition('persist:liveproject');
  try {
    const list = await ses.cookies.get({ url: String(url || '') });
    for (const c of list || []) await ses.cookies.remove(c.domain, c.name, c.path);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Descarga un fichero de texto del servidor (robots.txt, sitemap.xml…).
ipcMain.handle('net:fetch-text', async (_e, url) => {
  try {
    const res = await fetch(String(url), { redirect: 'follow' });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: text.slice(0, 20000) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('screenshot:save', async (_e, shots) => {
  // shots: [{ name, webContentsId }]
  const dir = path.join(cfg ? cfg.root : app.getPath('pictures'), '.liveproject', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saved = [];
  for (const s of shots) {
    const wc = webContents.fromId(s.webContentsId);
    if (!wc) continue;
    const img = await wc.capturePage();
    const file = path.join(dir, `${s.name.replace(/\W+/g, '-')}-${stamp}.png`);
    fs.writeFileSync(file, img.toPNG());
    saved.push(file);
  }
  return { dir, saved };
});

// Compara la captura actual con la anterior de cada vista y guarda una imagen de diferencias.
ipcMain.handle('screenshot:compare', async (_e, shots) => {
  const dir = path.join(cfg ? cfg.root : app.getPath('pictures'), '.liveproject', 'screenshots');
  const baseDir = path.join(dir, 'base');
  fs.mkdirSync(baseDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = [];
  for (const s of shots) {
    const wc = webContents.fromId(s.webContentsId);
    if (!wc) continue;
    const img = await wc.capturePage();
    const png = img.toPNG();
    const key = s.name.replace(/\W+/g, '-');
    const baseFile = path.join(baseDir, `${key}.png`);
    const hasBase = fs.existsSync(baseFile);
    const result = { device: s.name, base: hasBase, changed: 0, total: 0, pct: 0, diff: null, file: null };
    if (hasBase) {
      const d = diffPng(fs.readFileSync(baseFile), png);
      if (d) {
        const diffFile = path.join(dir, `diff-${key}-${stamp}.png`);
        fs.writeFileSync(diffFile, d.png);
        result.changed = d.changed;
        result.total = d.total;
        result.pct = d.total ? (d.changed / d.total) * 100 : 0;
        result.diff = diffFile;
        result.file = path.join(dir, `${key}-${stamp}.png`);
        fs.writeFileSync(result.file, png);
      }
    } else {
      fs.writeFileSync(baseFile, png);
      result.file = path.join(dir, `${key}-${stamp}.png`);
      fs.writeFileSync(result.file, png);
    }
    // la base pasa a ser la captura actual para comparar la siguiente vez
    fs.writeFileSync(baseFile, png);
    out.push(result);
  }
  return { dir, results: out };
});

// Diferencia píxel a píxel de dos PNG (devuelve la imagen de cambios en rojo).
function diffPng(bufA, bufB) {
  const a = nativeImage.createFromBuffer(bufA);
  const b = nativeImage.createFromBuffer(bufB);
  if (a.isEmpty() || b.isEmpty()) return null;
  const sa = a.getSize();
  const sb = b.getSize();
  const w = Math.min(sa.width, sb.width);
  const h = Math.min(sa.height, sb.height);
  if (!w || !h) return null;
  const ba = a.getBitmap();
  const bb = b.getBitmap();
  const out = Buffer.alloc(w * h * 4);
  let changed = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const d = Math.abs(ba[o] - bb[o]) + Math.abs(ba[o + 1] - bb[o + 1]) + Math.abs(ba[o + 2] - bb[o + 2]);
    if (d > 30) {
      changed++;
      out[o] = 255; out[o + 1] = 45; out[o + 2] = 85; out[o + 3] = 255;
    } else {
      const g = (bb[o] * 0.3 + bb[o + 1] * 0.59 + bb[o + 2] * 0.11) * 0.3 + 150;
      out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
    }
  }
  return { changed, total: w * h, png: nativeImage.createFromBuffer(out, { width: w, height: h }).toPNG() };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Segunda ejecución (p. ej. `liveproject .` desde la terminal del editor): reutilizar la ventana.
  app.on('second-instance', (_e, argv) => {
    const dir = folderFromArgv(argv);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    if (dir) openProject(dir);
  });

  app.whenReady().then(() => {
    ensureDesktopEntry();
    createWindow();
    startNetworkCapture(send);
    const initial = folderFromArgv(process.argv);
    win.webContents.once('did-finish-load', () => { if (initial) openProject(initial); });
  });

  app.on('before-quit', async () => {
    lan.stop();
    await stopProject();
  });
  app.on('window-all-closed', () => app.quit());
}
