const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const os = require('os');

// Túnel de red local: proxy inverso en 0.0.0.0 que reenvía al servidor del proyecto (que escucha solo en 127.0.0.1),
// inyecta recarga automática, captura de errores JS en los dispositivos remotos (móvil, tableta, otro equipo)
// y mantiene el espejo con la plataforma: misma sesión (cookies), misma navegación y mismos formularios.
const CLIENT_JS = `(function(){
var es,t,applyUntil=0;
var cid=Math.random().toString(36).slice(2)+Date.now().toString(36);
function isApplying(){return performance.now()<applyUntil;}
function guard(fn,ms){applyUntil=performance.now()+(ms||120);try{fn();}catch(e){}}
function sel(el){if(!el||el.nodeType!==1)return'';if(el.id)return'#'+CSS.escape(el.id);var parts=[];while(el&&el.nodeType===1&&el!==document.body){var part=el.tagName.toLowerCase();var sib=el.parentElement?[].slice.call(el.parentElement.children).filter(function(c){return c.tagName===el.tagName;}):[];if(sib.length>1)part+=':nth-of-type('+(sib.indexOf(el)+1)+')';parts.unshift(part);el=el.parentElement;}return'body > '+parts.join(' > ');}
function post(path,data){try{data=data||{};data.cid=cid;fetch('/__lp/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true});}catch(e){}}
function isField(el){return el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement||(el instanceof HTMLInputElement&&!/^(checkbox|radio|file|button|submit|reset|image)$/i.test(el.type));}
function apply(m){
 if(!m)return;
 if(m.type==='nav'){if(m.path&&m.path!==location.pathname+location.search)go(m.path);return;}
 if(m.type==='scroll'){guard(function(){var max=document.documentElement.scrollHeight-window.innerHeight;window.scrollTo({top:Math.round(max*m.ratio),left:0,behavior:'instant'});},120);return;}
 if(m.type==='click'){guard(function(){var el=document.querySelector(m.selector);if(el)el.click();});return;}
 if(m.type==='input'){guard(function(){var el=document.querySelector(m.selector);if(!el||el.value===m.value)return;el.value=m.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});return;}
 if(m.type==='submit'){guard(function(){var f=document.querySelector(m.selector);if(f&&f.requestSubmit)f.requestSubmit();});return;}
}
function go(p){if(document.readyState==='loading'){addEventListener('DOMContentLoaded',function(){location.href=p;},{once:true});}else{location.href=p;}}
function ping(){es=new EventSource('/__lp/events?cid='+encodeURIComponent(cid));
 es.addEventListener('reload',function(){location.reload()});
 es.addEventListener('mirror',function(ev){var m;try{m=JSON.parse(ev.data);}catch(e){return;}apply(m)});
 es.onerror=function(){es.close();clearTimeout(t);t=setTimeout(function(){fetch('/__lp/ping',{cache:'no-store'}).then(function(){location.reload()},ping)},1500)}}
ping();
function rep(m,s,l){try{navigator.sendBeacon('/__lp/err',JSON.stringify({message:String(m),source:s||'',line:l||0,ua:navigator.userAgent,w:innerWidth,h:innerHeight}))}catch(e){}}
addEventListener('error',function(e){rep(e.message,e.filename,e.lineno)});
addEventListener('unhandledrejection',function(e){rep('Promesa rechazada: '+(e.reason&&e.reason.message||e.reason))});
addEventListener('input',function(e){if(isApplying()||!e.isTrusted||!isField(e.target))return;post('mirror',{type:'input',selector:sel(e.target),value:e.target.value})},true);
addEventListener('change',function(e){if(isApplying()||!e.isTrusted||!isField(e.target))return;post('mirror',{type:'input',selector:sel(e.target),value:e.target.value})},true);
addEventListener('click',function(e){if(isApplying()||!e.isTrusted||!(e.target instanceof Element))return;post('mirror',{type:'click',selector:sel(e.target)})},true);
function reportNav(){post('nav',{path:location.pathname+location.search+location.hash})}
addEventListener('pageshow',reportNav);
addEventListener('popstate',reportNav);
var push=history.pushState.bind(history),rep=history.replaceState.bind(history);
history.pushState=function(){var r=push.apply(history,arguments);reportNav();return r};
history.replaceState=function(){var r=rep.apply(history,arguments);reportNav();return r};
reportNav();
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

// Une las cookies que envía el dispositivo con las de la plataforma (la plataforma manda: es el espejo).
function mergeCookies(clientCookie, appCookies) {
  const app = new Map();
  for (const c of appCookies || []) app.set(c.name, c.value);
  const parts = [];
  const emitted = new Set();   // cookies que ya van en la petición
  if (clientCookie) {
    for (const raw of String(clientCookie).split(';')) {
      const part = raw.trim();
      if (!part) continue;
      const name = part.slice(0, part.indexOf('=') < 0 ? part.length : part.indexOf('=')).trim();
      if (!name || emitted.has(name)) continue;
      if (app.has(name)) continue; // la cookie de la plataforma tiene prioridad
      emitted.add(name);
      parts.push(part);
    }
  }
  for (const c of appCookies || []) {
    if (emitted.has(c.name)) continue;
    emitted.add(c.name);
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join('; ');
}

function createLan({ getTarget, getCookies, onSetCookie, onMirror, onNav, onError, onClients, getPath }) {
  let server = null;
  let nextId = 0;
  const clients = new Map(); // id del dispositivo -> { res, ip, name, id, path }
  const publicClients = () => [...clients.values()].map((c) => ({ ip: c.ip, name: c.name, id: c.id, path: c.path }));
  const notify = () => onClients(publicClients());

  function target() {
    const u = new URL(getTarget());
    return { u, lib: u.protocol === 'https:' ? https : http, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) };
  }

  // Ruta que está viendo la plataforma ahora mismo (los dispositivos la siguen).
  const appPath = () => { try { return String(getPath ? getPath() : '') || ''; } catch { return ''; } };

  // Envía un mensaje del espejo a todos los dispositivos conectados al túnel.
  function broadcast(msg, exceptId) {
    const data = `event: mirror\ndata: ${JSON.stringify(msg)}\n\n`;
    for (const c of clients.values()) {
      if (exceptId && c.id === exceptId) continue;
      try { c.res.write(data); } catch { /* cliente caído */ }
    }
  }

  function control(req, res) {
    const url = req.url.split('?')[0];
    if (url === '/__lp/client.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(CLIENT_JS);
    } else if (url === '/__lp/ping') {
      res.writeHead(200, { 'Cache-Control': 'no-store' }).end('ok');
    } else if (url === '/__lp/events') {
      const cid = new URL(req.url, 'http://x').searchParams.get('cid') || `c${++nextId}`;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      const info = {
        res,
        ip: (req.socket.remoteAddress || '').replace('::ffff:', ''),
        name: deviceName(req.headers['user-agent'] || ''),
        id: `lan:${cid}`,
        path: ''
      };
      clients.set(info.id, info);
      notify();
      // El dispositivo entra donde esté la plataforma: mismo espejo desde el primer segundo.
      const path = appPath();
      if (path) { try { res.write(`event: mirror\ndata: ${JSON.stringify({ type: 'nav', path })}\n\n`); } catch { /* cliente caído */ } }
      req.on('close', () => {
        // Solo se borra si sigue siendo esta misma conexión (el cliente puede reconectar).
        if (clients.get(info.id) === info) clients.delete(info.id);
        notify();
      });
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
    } else if ((url === '/__lp/mirror' || url === '/__lp/nav') && req.method === 'POST') {
      // Mensaje del espejo enviado por un dispositivo de la red (clic, texto, navegación…).
      let body = '';
      req.on('data', (c) => { if (body.length < 20000) body += c; });
      req.on('end', () => {
        res.writeHead(204).end();
        let data = {};
        try { data = JSON.parse(body); } catch { /* ignorar */ }
        const client = clients.get(`lan:${data.cid}`) || { ip: '', name: '', id: `lan:${data.cid || '?'}`, path: '' };
        if (url === '/__lp/nav') {
          // El dispositivo navegó: la plataforma (y el resto de dispositivos) siguen su ruta.
          const path = String(data.path || '/');
          if (clients.has(client.id)) { client.path = path; notify(); }
          if (onNav) onNav({ ip: client.ip, name: client.name, id: client.id, path });
          broadcast({ type: 'nav', path, src: client.id }, client.id);
          return;
        }
        const msg = { ...data, src: client.id };
        // a los demás dispositivos de la red…
        broadcast(msg, client.id);
        // …y a la plataforma
        if (onMirror) onMirror(msg, client);
      });
    } else {
      res.writeHead(404).end();
    }
  }

  async function forward(req, res) {
    let t;
    try { t = target(); } catch { res.writeHead(503).end('LiveProject: el proyecto aún no tiene servidor.'); return; }
    const headers = { ...req.headers, host: t.u.host, 'accept-encoding': 'identity' };
    delete headers['if-none-match']; delete headers['if-modified-since']; // evita 304 sin cuerpo que no se pueda inyectar
    // Sesión compartida: la plataforma y los dispositivos de la red usan las mismas cookies.
    let appCookies = [];
    try { appCookies = (getCookies ? await getCookies(t.u.origin) : []) || []; } catch { /* sin cookies */ }
    const cookie = mergeCookies(req.headers.cookie, appCookies);
    if (cookie) headers.cookie = cookie; else delete headers.cookie;
    const up = t.lib.request({
      hostname: t.u.hostname, port: t.port, path: req.url, method: req.method, headers,
      rejectUnauthorized: !isLocalHost(t.u.hostname)
    }, async (ur) => {
      const h = { ...ur.headers };
      // Las cookies que fija el servidor (por ejemplo la de sesión) también se copian a la plataforma.
      // Se espera a copiarlas ANTES de responder: así la siguiente petición (o la redirección)
      // ya usa la sesión nueva y el dispositivo y la plataforma ven lo mismo.
      const setCookies = [].concat(ur.headers['set-cookie'] || []);
      if (onSetCookie && setCookies.length) {
        await Promise.all(setCookies.map((sc) => {
          try { return Promise.resolve(onSetCookie(sc, t.u.origin)).catch(() => {}); } catch { return Promise.resolve(); }
        }));
      }
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
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/__lp/')) return control(req, res);
      forward(req, res).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
    });
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
    for (const c of clients.values()) { try { c.res.end(); } catch { /* ya cerrado */ } }
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
    // Los dispositivos se quedan donde está la plataforma: si están en otra página, navegan;
    // si ya están en ella, se recargan (así ven la sesión nueva).
    const path = appPath();
    for (const c of clients.values()) {
      try {
        if (path && c.path && c.path !== path) c.res.write(`event: mirror\ndata: ${JSON.stringify({ type: 'nav', path })}\n\n`);
        else c.res.write('event: reload\ndata: 1\n\n');
      } catch { /* cliente caído */ }
    }
  }

  // Envía un mensaje del espejo de la plataforma a todos los dispositivos de la red.
  const mirror = (msg) => { if (msg && msg.type && clients.size) broadcast(msg); };

  return { start, stop, status, reload, mirror };
}

module.exports = { createLan, mergeCookies };
