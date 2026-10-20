const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('liveproject', {
  init: () => ipcRenderer.invoke('app:init'),
  setDevices: (list) => ipcRenderer.invoke('devices:set', list),
  devtoolsShow: (targetId, bounds) => ipcRenderer.invoke('devtools:show', { targetId, bounds }),
  devtoolsBounds: (bounds) => ipcRenderer.invoke('devtools:bounds', bounds),
  devtoolsVisible: (v) => ipcRenderer.invoke('devtools:visible', v),
  devtoolsHide: () => ipcRenderer.invoke('devtools:hide'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  appSettings: (patch) => ipcRenderer.invoke('app:settings', patch),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  openDownload: (url) => ipcRenderer.invoke('app:open-download', url),
  uninstall: (opts) => ipcRenderer.invoke('app:uninstall', opts),
  aiGet: () => ipcRenderer.invoke('ai:get'),
  aiSave: (patch) => ipcRenderer.invoke('ai:save', patch),
  aiTest: () => ipcRenderer.invoke('ai:test'),
  aiRecommend: () => ipcRenderer.invoke('ai:recommend'),
  aiAsk: (prompt) => ipcRenderer.invoke('ai:ask', prompt),
  chooseFolder: () => ipcRenderer.invoke('project:choose'),
  restart: () => ipcRenderer.invoke('project:restart'),
  saveScreenshots: (shots) => ipcRenderer.invoke('screenshot:save', shots),
  checkLinks: (urls) => ipcRenderer.invoke('links:check', urls),
  scanRoutes: () => ipcRenderer.invoke('routes:scan'),
  historySave: (s) => ipcRenderer.invoke('history:save', s),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyLoad: (id) => ipcRenderer.invoke('history:load', id),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),
  saveReport: (r) => ipcRenderer.invoke('report:save', r),
  lanStart: () => ipcRenderer.invoke('lan:start'),
  lanStop: () => ipcRenderer.invoke('lan:stop'),
  lanStatus: () => ipcRenderer.invoke('lan:status'),
  onNetBatch: on('net:batch'),
  onNetNav: on('net:nav'),
  onLinksProgress: on('links:progress'),
  onLanError: on('lan:error'),
  onLanClients: on('lan:clients'),
  onState: on('project:state'),
  onLog: on('log'),
  onReload: on('reload')
});
