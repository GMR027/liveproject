const fs = require('fs');
const net = require('net');
const path = require('path');
const { detect } = require('./presets');

const DEFAULT_DEVICES = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, type: 'phone', enabled: true },
  { id: 'iphone-14', name: 'iPhone 14', width: 390, height: 844, type: 'phone', enabled: false },
  { id: 'ipad', name: 'iPad', width: 768, height: 1024, type: 'tablet', enabled: true },
  { id: 'laptop', name: 'Laptop', width: 1366, height: 768, type: 'laptop', enabled: true },
  { id: 'desktop', name: 'Monitor 1080p', width: 1920, height: 1080, type: 'desktop', enabled: false }
];

const DEFAULT_IGNORE = [
  'node_modules', '.git', 'vendor', 'storage', '__pycache__', 'venv', '.venv',
  '.liveproject', '.idea', '.vscode', 'dist', 'build', '.cache'
];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Lee .liveproject.json (opcional) y completa con auto-detección.
async function loadConfig(root) {
  let user = {};
  const file = path.join(root, '.liveproject.json');
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { user = {}; user.__error = `.liveproject.json inválido: ${e.message}`; }
  }

  const preset = detect(root);
  const port = user.port || (user.url ? null : await freePort());
  const sub = (s) => (s ? s.replace(/\{port\}/g, port).replace(/\{root\}/g, root) : s);

  const cfg = {
    root,
    name: user.url ? 'URL externa' : user.command ? 'Comando personalizado' : preset.name,
    external: !!user.url,
    static: !user.url && !user.command && !!preset.static,
    command: user.url ? null : sub(user.command || preset.command),
    url: user.url || `http://127.0.0.1:${port}`,
    port,
    path: user.path || '/',
    ignore: [...DEFAULT_IGNORE, ...(user.ignore || [])],
    watch: user.watch || ['.'],
    delay: Number.isFinite(user.delay) ? user.delay : 0,
    warning: user.__error || null
  };
  return cfg;
}

module.exports = { loadConfig, DEFAULT_DEVICES };
