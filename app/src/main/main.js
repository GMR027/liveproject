const { app, BrowserWindow, WebContentsView, dialog, ipcMain, webContents, shell } = require('electron');
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
// Inspector: DevTools reales de Chromium incrustadas en una WebContentsView colocada sobre el panel inferior.
let dtView = null;
let dtTarget = null;
function closeDevTools() {
  if (dtTarget && !dtTarget.isDestroyed() && dtTarget.isDevToolsOpened()) dtTarget.closeDevTools();
  if (dtView) {
    if (win && !win.isDestroyed()) win.contentView.removeChildView(dtView);
    if (!dtView.webContents.isDestroyed()) dtView.webContents.close();
  }
  dtView = null; dtTarget = null;
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
ipcMain.handle('links:check', (_e, urls) => checkLinks(urls.map(String), (done, total) => send('links:progress', { done, total })));
ipcMain.handle('routes:scan', () => scanRoutes(cfg ? cfg.root : null, cfg ? cfg.ignore : null));
ipcMain.handle('history:save', (_e, session) => { if (cfg) history.save(cfg.root, session); });
ipcMain.handle('history:list', () => (cfg ? history.list(cfg.root) : []));
ipcMain.handle('history:load', (_e, id) => { try { return cfg ? history.load(cfg.root, id) : null; } catch { return null; } });
ipcMain.handle('history:delete', (_e, id) => { if (cfg) history.remove(cfg.root, id); });
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
ipcMain.handle('project:restart', () => cfg && openProject(cfg.root));
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
