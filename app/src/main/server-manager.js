const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const http = require('http');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function ping(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET', timeout: 1000 }, (res) => {
      res.resume();
      resolve(true); // cualquier respuesta HTTP (incluso 500) significa que el servidor está vivo
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitForServer(url, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

class ServerManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.staticServer = null;
  }

  log(text, stream = 'out') { this.emit('log', { text, stream }); }

  startStatic(cfg) {
    return new Promise((resolve, reject) => {
      this.staticServer = http.createServer((req, res) => {
        let p;
        try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400).end('400 Bad Request'); return; }
        let file = path.join(cfg.root, path.normalize(p));
        if (!file.startsWith(cfg.root)) { res.writeHead(403).end(); return; }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
        fs.readFile(file, (err, data) => {
          if (err) { res.writeHead(404).end('404 Not Found'); return; }
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
          });
          res.end(data);
        });
      });
      this.staticServer.once('error', reject);
      this.staticServer.listen(cfg.port, '127.0.0.1', resolve);
    });
  }

  async start(cfg) {
    await this.stop();
    if (cfg.external) {
      this.log(`Modo URL externa: ${cfg.url}\n`);
    } else if (cfg.static) {
      await this.startStatic(cfg);
      this.log(`Servidor estático en ${cfg.url}\n`);
    } else {
      this.log(`$ ${cfg.command}\n`);
      const proc = spawn(cfg.command, {
        cwd: cfg.root,
        shell: true,
        detached: true, // grupo propio para poder matar todo el árbol
        env: { ...process.env, PORT: String(cfg.port), FORCE_COLOR: '0' }
      });
      this.proc = proc;
      proc.stdout.on('data', (d) => this.log(d.toString()));
      proc.stderr.on('data', (d) => this.log(d.toString(), 'err'));
      proc.on('error', (e) => this.log(`Error al lanzar: ${e.message}\n`, 'err'));
      proc.on('exit', (code, sig) => {
        const unexpected = this.proc === proc; // si no, lo detuvimos nosotros (stop)
        if (unexpected) this.proc = null;
        this.log(`Proceso terminado (${sig || code})\n`, unexpected && code !== 0 ? 'err' : 'info');
        if (unexpected) this.emit('exit', code);
      });
    }
    const ok = await waitForServer(cfg.url + (cfg.path || ''), 30000);
    if (!ok) this.log('El servidor no respondió en 30 s.\n', 'err');
    return ok;
  }

  async stop() {
    if (this.staticServer) {
      const srv = this.staticServer;
      this.staticServer = null;
      await new Promise((r) => { srv.close(r); srv.closeAllConnections(); });
    }
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* ya terminó */ }
        resolve();
      }, 3000);
      proc.once('exit', () => { clearTimeout(timer); resolve(); });
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { clearTimeout(timer); resolve(); }
    });
  }
}

module.exports = { ServerManager, waitForServer };
