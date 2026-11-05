// Prueba del registro de interacciones: un clic real debe capturar el cambio de clase,
// el texto y los nodos, y no debe duplicar los eventos que llegan por el espejo.
// Se ejecuta con:  npm run test:interactions
const { app, BrowserWindow } = require('electron');
const path = require('path');

const FIXTURE = path.join(__dirname, '..', '..', 'examples', 'interactions');
app.disableHardwareAcceleration();
process.argv = [process.argv[0], 'main.js', FIXTURE];
require('../src/main/main.js');

let fallos = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, extra = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else { fallos++; console.log(`  ✗ ${name} ${extra}`); }
}

async function js(win, code, ms = 15000) {
  const run = win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const r = await Promise.race([run, new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), ms))]);
  if (r && r.__timeout) throw new Error('la vista no respondió a tiempo');
  return r && r.value !== undefined ? r.value : r;
}

async function safeJs(win, code, label) {
  try { return await js(win, code); }
  catch (e) { console.log(`  · error en ${label}: ${e.message}\n  · código: ${code.trim().slice(0, 500)}`); throw e; }
}

async function waitFor(win, code, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await js(win, code)) return true; } catch { /* aún no está */ }
    await sleep(200);
  }
  return false;
}

async function clickIn(win, id, sel) {
  const inner = `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`;
  return js(win, `
    const v = frames.get(${JSON.stringify(id)}).view;
    const r = await v.executeJavaScript(${JSON.stringify(inner)});
    if (!r) return false;
    v.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    v.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  `);
}

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 120 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0] || null;
    if (!win) await sleep(100);
  }
  if (!win) { console.log('  ✗ no se pudo abrir la ventana'); app.exit(1); return; }

  console.log('\nLiveProject · prueba de interacciones');
  const errores = [];
  win.webContents.on('console-message', (_e, lvl, msg) => {
    if (lvl >= 2) { console.log(`  · app: ${msg}`); if (!/ResizeObserver loop/.test(msg)) errores.push(msg); }
  });

  const ready = await waitFor(win, `
    if (!window.frames || !frames.size) return false;
    const f = [...frames.values()][0];
    if (!f.ready) return false;
    return await f.view.executeJavaScript("!!document.getElementById('toggle')");
  `, 25000);
  check('la página de prueba carga en las vistas', ready);
  if (!ready) { app.exit(1); return; }

  const view = await safeJs(win, `
    const f = [...frames.values()][0];
    Interactions.setView(f.device.id);
    Interactions.activate();
    return { id: f.device.id, text: await f.view.executeJavaScript("document.getElementById('card').textContent") };
  `, 'activar grabación');
  check('la grabación se activa en la vista seleccionada', await safeJs(win, `return Interactions.isRecording();`, 'consultar grabación'));
  await sleep(500);

  // 1. Clic real en «Añadir / quitar la clase saludo»
  await clickIn(win, view.id, '#toggle');
  await sleep(1800);
  const gotClass = await js(win, `return document.querySelectorAll('.int-item').length >= 1`);
  check('el clic genera una interacción', gotClass);
  const classInfo = await js(win, `
    document.querySelector('.int-item').click();
    const title = document.querySelector('.int-chg-title');
    return {
      changes: document.querySelectorAll('.int-chg').length,
      title: title ? title.textContent : '',
      code: document.querySelector('.int-chg') ? document.querySelector('.int-chg').innerText : ''
    };
  `);
  check('se captura la clase añadida', /saludo/.test(classInfo.title) && /\+/.test(classInfo.title), classInfo.title);
  check('se muestra el código antes/después', /class="hola"/.test(classInfo.code) && /class="hola saludo"/.test(classInfo.code), classInfo.code.slice(0, 200));
  const originInfo = await js(win, `
    return {
      text: document.getElementById('int-detail').innerText,
      origins: [...document.querySelectorAll('.int-origin')].map((n) => n.innerText),
      css: [...document.querySelectorAll('.int-css-row')].map((n) => n.innerText)
    };
  `);
  check('se captura el listener del clic', /captura|burbuja/i.test(originInfo.text) && /app\.js|index\.html|toggle|script/i.test(originInfo.text), JSON.stringify(originInfo).slice(0, 500));
  check('se captura la API que cambió la clase', /classList|setAttribute/i.test(originInfo.text), originInfo.text.slice(0, 300));
  check('se captura la regla CSS de la clase', originInfo.css.some((c) => /saludo/.test(c)), JSON.stringify(originInfo.css).slice(0, 300));
  const cssResolved = await js(win, `
    const f = [...frames.values()][0];
    return await window.liveproject.originCss(f.view.getURL(), '.hola.saludo');
  `);
  check('la regla CSS se localiza en el proyecto', !!cssResolved && cssResolved.ok && !!cssResolved.file && cssResolved.line > 0, JSON.stringify(cssResolved));

  // 3C. Source maps: app.js se resuelve a src/app.js
  const mapped = await js(win, `
    const f = [...frames.values()][0];
    const url = new URL('app.js', f.view.getURL()).href;
    return await window.liveproject.resolveOrigin(url, 3, 3);
  `);
  check('el source map resuelve al archivo original', !!mapped && mapped.ok && /src\/app\.js$/.test(mapped.source) && mapped.line === 3 && !!mapped.file, JSON.stringify(mapped));

  // 3D. CDP: breakpoint DOM sobre #card y pila exacta al repetir la interacción
  const cdpStart = await js(win, `
    const f = [...frames.values()][0];
    window.__cdpTest = null;
    window.liveproject.onOriginCdp((info) => { window.__cdpTest = info; });
    return await window.liveproject.cdpWatch(f.wcId, '#card', 'attribute');
  `);
  check('el breakpoint DOM de CDP se activa', !!cdpStart && cdpStart.ok, JSON.stringify(cdpStart));
  if (cdpStart && cdpStart.ok) {
    await clickIn(win, view.id, '#toggle');
    let cdpInfo = null;
    for (let i = 0; i < 30 && !cdpInfo; i++) {
      await sleep(150);
      cdpInfo = await js(win, `return window.__cdpTest || null`);
      if (cdpInfo && cdpInfo.error) break;
    }
    check('CDP captura la pila del cambio', !!cdpInfo && !cdpInfo.error && Array.isArray(cdpInfo.frames) && cdpInfo.frames.some((f) => /app\.js/.test(f.url)), JSON.stringify(cdpInfo).slice(0, 400));
    check('el panel muestra el origen exacto de CDP', await js(win, `return document.querySelectorAll('.int-cdp').length > 0`));
  }

  // 2. Un clic en otra vista no debe duplicar el registro en la vista que graba
  const before = await js(win, `document.querySelectorAll('.int-item').length`);
  const other = await js(win, `return [...frames.values()].find((f) => f.device.id !== ${JSON.stringify(view.id)}).device.id`);
  await clickIn(win, other, '#change-text');
  await sleep(1400);
  const after = await js(win, `document.querySelectorAll('.int-item').length`);
  check('los clics replicados por el espejo no se graban', after === before, `${before} → ${after}`);

  // 3. Grabación continua: un cambio asíncrono posterior aparece como «fondo»
  await js(win, `const c = $('int-continuous'); c.checked = true; c.dispatchEvent(new Event('change')); return true;`);
  await clickIn(win, view.id, '#notify');
  await sleep(3600);
  const asyncInfo = await js(win, `
    return {
      items: document.querySelectorAll('.int-item').length,
      background: document.querySelectorAll('.int-type.background').length,
      text: document.getElementById('int-list').innerText
    };
  `);
  check('el modo continuo recoge la retirada asíncrona del nodo', asyncInfo.background >= 1, asyncInfo.text.slice(0, 300));

  await js(win, `Interactions.deactivate(); return true;`);
  await sleep(300);
  check('sin errores en consola', errores.length === 0, errores.slice(0, 3).join(' | '));

  console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)\n` : '\nTodo correcto\n');
  app.exit(fallos ? 1 : 0);
});
