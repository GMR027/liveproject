const fs = require('fs');
const path = require('path');

const exists = (root, f) => fs.existsSync(path.join(root, f));
const read = (root, f) => {
  try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; }
};
const hasFileWithExt = (root, ext) => {
  try { return fs.readdirSync(root).some((f) => f.endsWith(ext)); } catch { return false; }
};

// Scripts que solo compilan assets y no abren ningún servidor HTTP.
const BUILD_ONLY = /^\s*(gulp|grunt|sass|node-sass|tailwindcss|postcss)\b/;

// Devuelve { name, command } o { name, static: true }. {port} y {root} se sustituyen después.
function detect(root) {
  if (exists(root, 'artisan')) {
    return { name: 'Laravel', command: 'php artisan serve --host=127.0.0.1 --port={port}' };
  }
  if (exists(root, 'manage.py')) {
    return { name: 'Django', command: 'python3 manage.py runserver 127.0.0.1:{port}' };
  }
  if (exists(root, 'app.py') && /flask/i.test(read(root, 'app.py'))) {
    return { name: 'Flask', command: 'python3 -m flask --app app run --debug --host=127.0.0.1 --port={port}' };
  }
  // Backend PHP con raíz web en public/ (MVC): los scripts npm suelen ser solo build de assets (gulp, sass...).
  if (exists(root, 'public/index.php')) {
    return { name: 'PHP (public/)', command: 'php -S 127.0.0.1:{port} -t "{root}/public"' };
  }
  if (exists(root, 'package.json')) {
    try {
      const scripts = JSON.parse(read(root, 'package.json')).scripts || {};
      const isServer = (cmd) => cmd && !BUILD_ONLY.test(cmd);
      if (isServer(scripts.dev)) return { name: 'Node (npm run dev)', command: 'npm run dev' };
      if (isServer(scripts.start)) return { name: 'Node (npm start)', command: 'npm start' };
    } catch { /* package.json inválido: seguir */ }
  }
  if (exists(root, 'config.ru')) {
    return { name: 'Ruby (Rack)', command: 'bundle exec rackup -p {port}' };
  }
  if (exists(root, 'go.mod')) {
    return { name: 'Go', command: 'go run .' };
  }
  if (exists(root, 'index.php') || hasFileWithExt(root, '.php')) {
    return { name: 'PHP', command: 'php -S 127.0.0.1:{port} -t "{root}"' };
  }
  return { name: 'Estático', static: true };
}

module.exports = { detect };
