const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const os = require('os');

// Túnel de red local: proxy inverso en 0.0.0.0 que reenvía al servidor del proyecto (que escucha solo en 127.0.0.1),
// inyecta recarga automática y captura de errores JS en los dispositivos remotos (móvil, tableta, otro equipo).
const CLIENT_JS = `(function(){
var es,t;function ping(){es=new EventSource('/__lp/events');
es.addEventListener('reload',function(){location.reload()});
es.onerror=function(){es.close();clearTimeout(t);t=setTimeout(function(){fetch('/__lp/ping',{cache:'no-store'}).then(function(){location.reload()},ping)},1500)}}
ping();
function rep(m,s,l){try{navigator.sendBeacon('/__lp/err',JSON.stringify({message:String(m),source:s||'',line:l||0,ua:navigator.userAgent,w:innerWidth,h:innerHeight}))}catch(e){}}
addEventListener('error',function(e){rep(e.message,e.filename,e.lineno)});
addEventListener('unhandledrejection',function(e){rep('Promesa rechazada: '+(e.reason&&e.reason.message||e.reason))});
})();`;
const TAG = '<script src="/__lp/client.js"></script>';

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
  }
  // las interfaces típicas de Wi-Fi/Ethernet primero, las virtuales (docker, veth, br-) al final
  const virtual = (n) => /^(docker|veth|br-|virbr|vmnet|vboxnet|tun|tap)/.test(n);
  return out.sort((a, b) => virtual(a.name) - virtual(b.name));
}

const isLocalHost = (h) => /^(localhost|127\.|\[?::1\]?$)/.test(h);

function deviceName(ua) {
  const m = (re) => (ua.match(re) || [])[1];
  const os_ = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android móvil' : 'Android tableta')
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : m(/(\w+)\//) || '';
  return `${os_}${br ? ` · ${br}` : ''}`;
}

function createLan({ getTarget, onError, onClients }) {
  let server = null;
  const clients = new Map(); // res -> { ip, name }
  const publicClients = () => [...clients.values()].map((c) => ({ ip: c.ip, name: c.name }));
  const notify = () => onClients(publicClients());

  function target() {
    const u = new URL(getTarget());
    return { u, lib: u.protocol === 'https:' ? https : http, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
  }

  function control(req, res) {
    const url = req.url.split('?')[0];
    if (url === '/__lp/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(CLIENT_JS);
    } else if (url === '/__lp/ping') {
      res.writeHead(200, { 'Cache-Control': 'no-store' }).end('ok');
    } else if (url === '/__lp/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      clients.set(res, { ip: (req.socket.remoteAddress || '').replace('::ffff:', ''), name: deviceName(req.headers['user-agent'] || '') });
      notify();
      req.on('close', () => { clients.delete(res); notify(); });
    } else if (url === '/__lp/err' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { if (body.length < 8000) body += c; });
      req.on('end', () => {
        try {
          const e = JSON.parse(body);
          onError({ device: deviceName(String(e.ua || '')), size: `${e.w}×${e.h}`, message: String(e.message).slice(0, 1000), source: String(e.source || '').slice(0, 300), line: Number(e.line) || 0 });
        } catch { /* ignorar */ }
        res.writeHead(204).end();
      });
    } else {
      res.writeHead(404).end();
    }
  }

  function forward(req, res) {
    let t;
    try { t = target(); } catch { res.writeHead(503).end('LiveProject: el proyecto aún no tiene servidor.'); return; }
    const headers = { ...req.headers, host: t.u.host, 'accept-encoding': 'identity' };
    delete headers['if-none-match']; delete headers['if-modified-since']; // evita 304 sin cuerpo que no se pueda inyectar
    const up = t.lib.request({
      hostname: t.u.hostname, port: t.port, path: req.url, method: req.method, headers,
      rejectUnauthorized: !isLocalHost(t.u.hostname)
    }, (ur) => {
      const h = { ...ur.headers };
      if (h.location && h.location.startsWith(t.u.origin)) h.location = h.location.slice(t.u.origin.length) || '/';
      const html = /text\/html/i.test(h['content-type'] || '');
      if (!html) { res.writeHead(ur.statusCode, h); ur.pipe(res); return; }
      const chunks = [];
      ur.on('data', (c) => chunks.push(c));
      ur.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${TAG}</body>`) : body + TAG;
        delete h['content-length']; delete h['transfer-encoding']; delete h['content-md5']; delete h.etag;
        h['content-length'] = Buffer.byteLength(body);
        h['cache-control'] = 'no-store';
        res.writeHead(ur.statusCode, h).end(body);
      });
    });
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`LiveProject: no se pudo conectar con el servidor del proyecto (${e.code || e.message}).`);
    });
    req.pipe(up);
  }

  function upgrade(req, socket, head) {
    let t;
    try { t = target(); } catch { socket.destroy(); return; }
    const raw = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw.push(`${req.rawHeaders[i]}: ${/^host$/i.test(req.rawHeaders[i]) ? t.u.host : req.rawHeaders[i + 1]}`);
    }
    const onConnect = (up) => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${raw.join('\r\n')}\r\n\r\n`);
      if (head && head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    };
    const up = t.u.protocol === 'https:'
      ? tls.connect({ host: t.u.hostname, port: t.port, servername: t.u.hostname, rejectUnauthorized: !isLocalHost(t.u.hostname) }, () => onConnect(up))
      : net.connect(t.port, t.u.hostname, () => onConnect(up));
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  }

  async function start() {
    if (server) return status();
    server = http.createServer((req, res) => (req.url.startsWith('/__lp/') ? control(req, res) : forward(req, res)));
    server.on('upgrade', upgrade);
    const listen = (port) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
    });
    try { await listen(4777); } catch (e) {
      if (e.code !== 'EADDRINUSE') { server = null; throw e; }
      await listen(0);
    }
    return status();
  }

  function stop() {
    if (!server) return;
    for (const res of clients.keys()) res.end();
    clients.clear();
    server.close();
    server.closeAllConnections && server.closeAllConnections();
    server = null;
    notify();
  }

  function status() {
    if (!server) return { running: false, addresses: lanAddresses(), clients: [] };
    return { running: true, port: server.address().port, addresses: lanAddresses(), clients: publicClients() };
  }

  function reload() {
    for (const res of clients.keys()) res.write('event: reload\ndata: 1\n\n');
  }

  return { start, stop, status, reload };
}

module.exports = { createLan };
