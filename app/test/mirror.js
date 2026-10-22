// Prueba del espejo: las vistas de la plataforma (y la del túnel) deben mostrar siempre lo mismo.
// Se ejecuta con:  npx electron test/mirror.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

const FIXTURE = path.join(__dirname, '..', '..', 'examples', 'php-login');
// En máquinas sin GPU (servidores, contenedores) el proceso gráfico puede tumbar la app.
app.disableHardwareAcceleration();
// La app principal lee la carpeta del proyecto del primer argumento.
process.argv = [process.argv[0], 'main.js', FIXTURE];
require('../src/main/main.js');

let fallos = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, extra = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else { fallos++; console.log(`  ✗ ${name} ${extra}`); }
}

async function js(win, code, ms = 15000) {
  // Con un límite de tiempo: si una vista se queda colgada, la prueba lo dice en vez de colgarse.
  const run = win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const r = await Promise.race([
    run,
    new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), ms))
  ]);
  if (r && r.__timeout) throw new Error('la vista no respondió a tiempo');
  return r && r.value !== undefined ? r.value : r;
}

// Estado de las vistas de la plataforma: URL y texto de la página.
const views = (win) => js(win, `
  const out = [];
  for (const f of frames.values()) {
    let body = '';
    try { body = await f.view.executeJavaScript('document.body ? document.body.innerText.slice(0, 2000) : ""'); } catch (e) { body = ''; }
    out.push({ id: f.device.id, ready: f.ready, url: f.ready ? f.view.getURL() : '', body });
  }
  return out;
`);

// Escribe con eventos reales (los eventos sintéticos no cuentan como entrada del usuario).
// Comprueba el valor y reintenta si la vista se recargó y se perdió lo escrito.
async function typeIn(win, target, sel, text) {
  for (let intento = 0; intento < 4; intento++) {
    await js(win, `
      const f = (${target}).view || (${target});
      await f.executeJavaScript("(() => { const el = document.querySelector('${sel}'); if (el) { el.focus(); el.value = ''; } return true; })()");
      for (const ch of ${JSON.stringify(text)}) {
        f.sendInputEvent({ type: 'char', keyCode: ch });
        await new Promise((r) => setTimeout(r, 30));
      }
      return true;
    `);
    await sleep(250);
    const v = await js(win, `
      const f = (${target}).view || (${target});
      return await f.executeJavaScript("(document.querySelector('${sel}') || {}).value || ''");
    `).catch(() => '');
    if (v === text) return true;
    await sleep(400);
  }
  return false;
}

// Clic real (botón izquierdo) sobre un elemento.
const clickIn = (win, target, sel) => js(win, `
  const f = (${target}).view || (${target});
  const r = await f.executeJavaScript("(() => { const el = document.querySelector('${sel}'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
  if (!r) return false;
  f.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  f.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return true;
`);

async function waitViews(win, text, ms = 12000) {
  const end = Date.now() + ms;
  let last = [];
  while (Date.now() < end) {
    last = await views(win);
    if (last.length && last.every((v) => v.ready && v.body.includes(text))) return last;
    await sleep(250);
  }
  return last;
}

/* ---------- el dispositivo de la red: una ventana aparte, como un móvil ---------- */
const device = { win: null, wc: null };

async function openDevice(url) {
  const win = new BrowserWindow({
    width: 420, height: 780, show: false,
    webPreferences: { partition: 'persist:tunnel-test', contextIsolation: true, nodeIntegration: false }
  });
  device.win = win;
  device.wc = win.webContents;
  await win.loadURL(url);
  // Entrada real (como la de un dedo) mediante el protocolo de DevTools.
  device.wc.debugger.attach('1.3');
  return win;
}

const deviceState = () => js(device.win, `
  return { url: location.pathname + location.search, body: document.body ? document.body.innerText.slice(0, 2000) : '' };
`);

async function waitDevice(text, ms = 12000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await deviceState().catch(() => null);
    if (last && last.body.includes(text)) return last;
    await sleep(250);
  }
  return last;
}

async function deviceType(sel, text) {
  await js(device.win, `const el = document.querySelector(${JSON.stringify(sel)}); if (el) { el.value = ''; el.focus(); } return true;`);
  for (const ch of text) {
    await device.wc.debugger.sendCommand('Input.insertText', { text: ch });
    await sleep(30);
  }
}

async function deviceClick(sel) {
  const r = await js(device.win, `
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  `);
  if (!r) return false;
  const x = Math.round(r.x), y = Math.round(r.y);
  await device.wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await device.wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await device.wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  return true;
}

function get(port, p, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.end();
  });
}

// Inicia sesión desde la plataforma (reintenta si una recarga se lleva lo escrito).
async function loginPlatform(win, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await typeIn(win, "frames.get('iphone-se')", '#usuario', 'admin');
    await typeIn(win, "frames.get('iphone-se')", '#clave', '1234');
    await clickIn(win, "frames.get('iphone-se')", '#entrar');
    const list = await waitViews(win, 'Sesión iniciada', 6000);
    if (list.length === 3 && list.every((v) => v.body.includes('Sesión iniciada'))) return true;
    await sleep(700);
  }
  return false;
}

app.whenReady().then(async () => {
  const win = await new Promise(async (resolve) => {
    for (let i = 0; i < 100; i++) {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) return resolve(w);
      await sleep(100);
    }
    return resolve(null);
  });
  if (!win) { console.log('  ✗ no se pudo abrir la ventana'); app.exit(1); return; }
  // Avisos de la interfaz (ayudan a diagnosing el espejo).
  win.webContents.on('console-message', (_e, lvl, msg) => {
    if (/espejo|mirror|túnel/i.test(msg)) console.log(`   · app: ${msg}`);
  });

  console.log('\nLiveProject · prueba del espejo');

  // 1. Las vistas cargan el formulario de sesión
  let list = await waitViews(win, 'Iniciar sesión');
  check('las 3 vistas cargan el formulario de sesión',
    list.length === 3 && list.every((v) => v.body.includes('Iniciar sesión')),
    JSON.stringify(list.map((v) => v.url)));

  // 2. Lo que se escribe en una vista se replica en las demás
  await typeIn(win, "frames.get('iphone-se')", '#usuario', 'admin');
  await typeIn(win, "frames.get('iphone-se')", '#clave', '1234');
  await sleep(800);
  const values = await js(win, `
    const out = [];
    for (const f of frames.values()) out.push(await f.view.executeJavaScript("document.getElementById('usuario') ? document.getElementById('usuario').value : ''"));
    return out;
  `);
  check('el texto escrito se replica en las 3 vistas', values.length === 3 && values.every((v) => v === 'admin'), JSON.stringify(values));

  // 3. La red local: un dispositivo entra por el túnel con sus propias cookies
  const lan = await js(win, 'return await window.liveproject.lanStart();');
  if (!lan || !lan.running) { check('el túnel de red local arranca', false, JSON.stringify(lan)); app.exit(1); return; }
  check('el túnel de red local arranca', true);
  await sleep(400);
  await openDevice(`http://127.0.0.1:${lan.port}/index.php`);
  let dev = await waitDevice('Iniciar sesión');
  check('el dispositivo de la red entra por el túnel', !!dev && dev.body.includes('Iniciar sesión'), dev ? dev.url : 'sin vista');

  // 4. Plataforma → túnel: lo que se escribe en las vistas aparece en el móvil
  await sleep(600);
  await typeIn(win, "frames.get('iphone-se')", '#usuario', 'escritorio');
  await sleep(1000);
  const inDevice = await js(device.win, `return document.getElementById('usuario') ? document.getElementById('usuario').value : '';`);
  check('lo que se escribe en la plataforma aparece en el móvil', inDevice === 'escritorio', String(inDevice));

  // 5. Túnel → plataforma: lo que escribe el móvil aparece en las vistas
  await deviceType('#usuario', 'movil');
  await sleep(1000);
  const inViews = await js(win, `
    const out = [];
    for (const f of frames.values()) out.push(await f.view.executeJavaScript("document.getElementById('usuario') ? document.getElementById('usuario').value : ''"));
    return out;
  `);
  check('lo que escribe el móvil aparece en las vistas de la plataforma',
    inViews.length === 3 && inViews.every((v) => v === 'movil'), JSON.stringify(inViews));

  // 6. Inicio de sesión en la plataforma: todas las vistas llegan al panel
  check('el inicio de sesión funciona en la plataforma', await loginPlatform(win));
  list = await waitViews(win, 'Sesión iniciada');
  check('todas las vistas siguen el inicio de sesión (mismo espejo)',
    list.length === 3 && list.every((v) => v.body.includes('Sesión iniciada')),
    JSON.stringify(list.map((v) => v.url)));

  // 7. Una navegación hecha por código (no un clic) también se replica
  await js(win, `frames.get('iphone-se').view.executeJavaScript("location.href = 'dashboard.php'")`);
  list = await waitViews(win, 'Sesión iniciada');
  check('una navegación hecha por código también se replica',
    list.length === 3 && list.every((v) => v.url.includes('dashboard.php')),
    JSON.stringify(list.map((v) => v.url)));

  // 8. La sesión de las vistas la ve también el túnel
  const r = await get(lan.port, '/dashboard.php');
  check('la vista del túnel ve la misma sesión (sin volver al login)',
    r.status === 200 && r.body.includes('Sesión iniciada'), `estado ${r.status}`);

  // 9. El móvil navega (cerrar sesión): las vistas de la plataforma le siguen
  dev = await waitDevice('Sesión iniciada');
  check('el móvil ve la misma sesión', !!dev && dev.body.includes('Sesión iniciada'), dev ? dev.url : 'sin vista');
  const clicked = await deviceClick('a[href="logout.php"]');
  check('el móvil puede pulsar el enlace de cerrar sesión', clicked);
  list = await waitViews(win, 'Iniciar sesión');
  check('la ruta del móvil se refleja en las vistas de la plataforma',
    list.length === 3 && list.every((v) => v.body.includes('Iniciar sesión')),
    JSON.stringify(list.map((v) => `${v.url} ${v.body.slice(0, 40)}`)));

  // 10. Y al revés: la plataforma navega y el móvil le sigue
  await sleep(1200);   // si la sesión del móvil cambió, las vistas se recargan solas: que se asienten
  check('se puede iniciar sesión otra vez en la plataforma', await loginPlatform(win));
  await sleep(1200);
  dev = await waitDevice('Sesión iniciada');
  check('la ruta de la plataforma se refleja en el móvil', !!dev && dev.body.includes('Sesión iniciada'), dev ? dev.url : 'sin vista');

  console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)\n` : '\nTodo correcto\n');
  app.exit(fallos ? 1 : 0);
});
