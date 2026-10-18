const chokidar = require('chokidar');
const path = require('path');

// Vigila el proyecto y llama onChange(archivos) tras un debounce.
function createWatcher(cfg, onChange) {
  const ignored = cfg.ignore.map((name) => (p) =>
    p.split(path.sep).includes(name)
  );
  const targets = cfg.watch.map((w) => path.resolve(cfg.root, w));
  const watcher = chokidar.watch(targets, {
    ignored,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 }
  });

  let timer = null;
  let pending = new Set();
  const schedule = (file) => {
    pending.add(path.relative(cfg.root, file));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...pending];
      pending = new Set();
      setTimeout(() => onChange(files), cfg.delay);
    }, 150);
  };
  watcher.on('add', schedule).on('change', schedule).on('unlink', schedule);

  return { close: () => { clearTimeout(timer); return watcher.close(); } };
}

module.exports = { createWatcher };
