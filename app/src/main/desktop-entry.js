// En Linux la barra de tareas (sobre todo en Wayland) toma el icono del .desktop cuyo nombre coincide con el app_id.
// Los paquetes .deb/AppImage ya lo traen; al ejecutar desde el código fuente lo registramos en el perfil del usuario.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

function ensureDesktopEntry() {
  if (process.platform !== 'linux' || app.isPackaged) return;
  try {
    const share = path.join(os.homedir(), '.local', 'share');
    const iconDir = path.join(share, 'icons', 'hicolor', '512x512', 'apps');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(ICON, path.join(iconDir, 'liveproject.png'));
    const dir = path.join(share, 'applications');
    fs.mkdirSync(dir, { recursive: true });
    const entry = [
      '[Desktop Entry]', 'Type=Application', 'Name=LiveProject',
      'Comment=Vista previa en vivo multi-dispositivo',
      `Exec=${process.execPath} ${path.resolve(__dirname, '..', '..')} %U`,
      'Icon=liveproject', 'Terminal=false', 'Categories=Development;', 'StartupWMClass=liveproject', ''
    ].join('\n');
    const file = path.join(dir, 'liveproject.desktop');
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== entry) fs.writeFileSync(file, entry);
  } catch { /* el icono de la ventana sigue funcionando sin esto */ }
}

module.exports = { ensureDesktopEntry, ICON };
