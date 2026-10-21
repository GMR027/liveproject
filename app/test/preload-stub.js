// Entorno de pruebas: sustituye al preload real para poder cargar el renderer sin proyecto.
const { contextBridge } = require('electron');

const noop = () => {};
const on = () => noop;

contextBridge.exposeInMainWorld('liveproject', {
  init: () => Promise.resolve({
    webviewPreload: 'file:///tmp/lp-test-webview.js',
    devices: [
      { id: 'iphone', name: 'iPhone 17', width: 402, height: 874, type: 'phone', enabled: true },
      { id: 'ipad', name: 'iPad', width: 820, height: 1180, type: 'tablet', enabled: true }
    ],
    defaults: [],
    state: null
  }),
  setDevices: () => Promise.resolve(),
  devtoolsShow: () => Promise.resolve(false),
  devtoolsBounds: noop,
  devtoolsVisible: noop,
  devtoolsHide: noop,
  emulateSet: () => Promise.resolve({ ok: true }),
  editorOpen: () => Promise.resolve({ ok: true, editor: 'test' }),
  editorOpenUrl: () => Promise.resolve({ ok: true, editor: 'test' }),
  appInfo: () => Promise.resolve({ version: '0.0.0', kind: 'dev', settings: { updateUrl: '', autoCheck: false, recent: [] } }),
  appSettings: () => Promise.resolve({}),
  checkUpdate: () => Promise.resolve({ ok: false }),
  openDownload: noop,
  uninstall: () => Promise.resolve({ ok: false, message: 'Cancelado.' }),
  aiGet: () => Promise.resolve({
    provider: 'ollama', baseUrl: '', model: '', connected: false, hasKey: false,
    providers: { ollama: { label: 'Ollama', group: 'local', kind: 'http', base: '', hint: '' } }
  }),
  aiSave: () => Promise.resolve({}),
  aiTest: () => Promise.resolve({ ok: false, message: 'sin IA', models: [] }),
  aiRecommend: () => Promise.resolve({ items: [] }),
  aiAsk: () => Promise.resolve({ ok: false }),
  chooseFolder: noop,
  openProject: () => Promise.resolve({ ok: true }),
  projectConfig: () => Promise.resolve({ ok: false, text: '' }),
  projectConfigWrite: () => Promise.resolve({ ok: true }),
  restart: noop,
  serverInput: () => Promise.resolve({ ok: false }),
  cookiesFor: () => Promise.resolve([]),
  cookieDelete: () => Promise.resolve({ ok: true }),
  cookiesClear: () => Promise.resolve({ ok: true }),
  fetchText: () => Promise.resolve({ ok: false }),
  saveScreenshots: () => Promise.resolve({ dir: '/tmp', saved: [] }),
  compareScreenshots: () => Promise.resolve({ dir: '/tmp', results: [] }),
  checkLinks: () => Promise.resolve(),
  scanRoutes: () => Promise.resolve({ routes: [] }),
  historySave: noop,
  historyList: () => Promise.resolve([]),
  historyLoad: () => Promise.resolve(null),
  historyDelete: noop,
  saveReport: () => Promise.resolve({ dir: '/tmp' }),
  saveHar: () => Promise.resolve({ dir: '/tmp' }),
  showInFolder: noop,
  lanStart: () => Promise.resolve({ ok: false }),
  lanStop: () => Promise.resolve({}),
  lanStatus: () => Promise.resolve({ running: false, addresses: [] }),
  onNetBatch: on(), onNetNav: on(), onLinksProgress: on(), onLanError: on(), onLanClients: on(),
  onState: on(), onLog: on(), onReload: on()
});
