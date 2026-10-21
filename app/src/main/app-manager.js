const { app, dialog, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_UPDATE_URL = 'https://liveproject.iguzman.com.mx/downloads/latest.json';
const settingsFile = () => path.join(app.getPath('userData'), 'app.json');

function loadSettings() {
  try { return { updateUrl: DEFAULT_UPDATE_URL, autoCheck: false, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { return { updateUrl: DEFAULT_UPDATE_URL, autoCheck: false }; }
}

function saveSettings(patch) {
  const s = { ...loadSettings() };
  if (typeof patch.updateUrl === 'string') s.updateUrl = patch.updateUrl.trim();
  if (typeof patch.autoCheck === 'boolean') s.autoCheck = patch.autoCheck;
  if (Array.isArray(patch.recent)) s.recent = patch.recent.slice(0, 12);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  return s;
}

// appimage | deb | dev
function installKind() {
  if (!app.isPackaged) return 'dev';
  if (process.env.APPIMAGE) return 'appimage';
  return 'deb';
}

function info() {
  return { version: app.getVersion(), kind: installKind(), settings: loadSettings() };
}

const parse = (v) => String(v || '').replace(/^v/i, '').split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

async function checkUpdate() {
  const { updateUrl } = loadSettings();
  const current = app.getVersion();
  if (!/^https?:\/\//i.test(updateUrl)) return { ok: false, message: 'Configura la URL de actualizaciones para poder buscar.' };
  try {
    const res = await fetch(updateUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, message: `El servidor respondió HTTP ${res.status}.` };
    const j = await res.json();
    const latest = j.version || j.tag_name;
    const url = j.url || j.html_url || '';
    if (!latest) return { ok: false, message: 'Respuesta no válida: falta «version» (o «tag_name»).' };
    const newer = isNewer(latest, current);
    return { ok: true, current, latest: String(latest).replace(/^v/i, ''), newer, url, notes: String(j.notes || j.body || '').slice(0, 500) };
  } catch (e) {
    return { ok: false, message: e.name === 'TimeoutError' ? 'Tiempo de espera agotado.' : `No se pudo comprobar: ${e.message}` };
  }
}

function openDownload(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

const run = (bin, args) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout: 300000 }, (err, _out, stderr) => (err ? reject(new Error((stderr || err.message).toString().slice(0, 300))) : resolve()));
});

async function uninstall(win, { removeData }) {
  const kind = installKind();
  if (kind === 'dev') {
    return { ok: false, message: 'Estás ejecutando desde el código fuente: no hay nada instalado. Borra la carpeta del proyecto si ya no la quieres.' };
  }
  const detail = kind === 'appimage'
    ? `Se eliminará el archivo ${process.env.APPIMAGE}.`
    : 'Se ejecutará «apt-get remove liveproject» (te pedirá la contraseña de administrador).';
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Cancelar', 'Desinstalar'], defaultId: 0, cancelId: 0,
    message: '¿Desinstalar LiveProject?',
    detail: `${detail}${removeData ? '\nTambién se borrarán tus ajustes y claves guardadas.' : ''}`
  });
  if (r.response !== 1) return { ok: false, message: 'Cancelado.' };
  try {
    if (kind === 'appimage') fs.rmSync(process.env.APPIMAGE, { force: true });
    else await run('pkexec', ['apt-get', 'remove', '-y', 'liveproject']);
  } catch (e) {
    return { ok: false, message: `No se pudo desinstalar: ${e.message}` };
  }
  if (removeData) fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
  app.exit(0);
  return { ok: true };
}

module.exports = { info, saveSettings, checkUpdate, openDownload, uninstall };
