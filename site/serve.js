// Servidor estático mínimo para ver la web en local: node serve.js  (PORT=5173 por defecto)
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const root = __dirname;

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400).end(); return; }
  const file = path.join(root, p === '/' ? 'index.html' : path.normalize(p));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}).listen(process.env.PORT || 5173, () => console.log(`http://localhost:${process.env.PORT || 5173}`));
