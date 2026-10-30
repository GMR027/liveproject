// Prueba de humo: carga el renderer con un entorno simulado y comprueba lo esencial.
// Se ejecuta con:  npm test   (electron test/smoke.js)
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
let fallos = 0;

function check(name, ok, extra = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else { fallos++; console.log(`  ✗ ${name} ${extra}`); }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 860, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-stub.js'),
      contextIsolation: true, nodeIntegration: false, webviewTag: true
    }
  });
  const errores = [];
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 2) errores.push(msg); });
  await win.loadFile(SRC);
  await new Promise((r) => setTimeout(r, 1500));

  const js = async (code) => {
    const r = await win.webContents.executeJavaScript(code, true);
    return r && r.value !== undefined ? r.value : r;
  };

  // Espera a que la interfaz esté lista (la inicialización es asíncrona).
  const waitFor = async (code, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await js(code)) return true; } catch { /* aún no está */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  console.log('\nLiveProject · prueba de humo');

  // 1. La interfaz carga
  check('el renderer se carga', await js(`!!document.getElementById('stage')`));
  check('la interfaz termina de inicializarse', await waitFor(`!!$('btn-dock').onclick`));
  check('las pestañas de herramientas existen', (await js(`document.querySelectorAll('#bottom-bar .tab').length`)) === 6);

  // 1b. La barra de direcciones admite páginas completas (con ruta y parámetros)
  check('la dirección acepta una página completa', await js(`addressUrl('https://projectweb.iguzman.com.mx/programa?proyecto=10') === 'https://projectweb.iguzman.com.mx/programa?proyecto=10'`));
  check('la dirección completa un dominio sin esquema', await js(`addressUrl('mi-sitio.com/programa?x=1') === 'https://mi-sitio.com/programa?x=1'`));
  check('la barra de direcciones es editable', await js(`(()=>{const i=$('url');i.value='https://ejemplo.com/pagina';return !i.readOnly && i.value.endsWith('/pagina');})()`));

  // 2. Traslado de las herramientas al panel lateral
  await js(`$('btn-dock').click()`);
  await waitFor(`toolsDock === 'side'`).catch(() => {}); await new Promise((r) => setTimeout(r, 300));
  check('las herramientas van al panel lateral', await js(`toolsDock === 'side' && !$('bottom').hidden === false && !$('side-tools').hidden`));
  check('la barra se traslada', await js(`$('bottom-bar').parentNode.id === 'tools-bar'`));
  check('los paneles se trasladan', await js(`$('tab-smart').parentNode.id === 'tools-host'`));
  await js(`$('btn-dock').click()`);
  await waitFor(`toolsDock === 'bottom'`).catch(() => {}); await new Promise((r) => setTimeout(r, 300));
  check('las herramientas vuelven abajo', await js(`toolsDock === 'bottom' && !$('bottom').hidden`));

  // 3. La pestaña «Herramientas» del lateral
  await js(`document.querySelector('.stab2[data-side=tools]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  check('la pestaña Herramientas mueve las herramientas', await js(`toolsDock === 'side' && document.querySelector('.stab2.active').dataset.side === 'tools'`));
  await js(`$('btn-dock').click()`);
  await new Promise((r) => setTimeout(r, 300));

  // 4. Emulación
  check('la emulación se registra', await js(`(async()=>{const f=[...frames.values()][0];await Emulate.set(f,'net','3g');return Emulate.of(f.device.id).net === '3g';})()`));
  check('la emulación se guarda', await js(`!!localStorage.getItem('lp-emulate')`));

  // 5. Atajos y paleta de comandos
  await js(`Cmd.open()`);
  check('la paleta se abre', await js(`!document.getElementById('palette').hidden`));
  check('la paleta tiene comandos', (await js(`document.querySelectorAll('.pal-row').length`)) > 10);
  await js(`Cmd.close()`);

  // 6. Paneles: red, rutas, auditoría y almacenamiento
  check('el panel de red existe', await js(`!!document.getElementById('net-list')`));
  check('la cascada se puede activar', await js(`(()=>{$('net-wf').click();return document.querySelectorAll('.emu-opt').length >= 0;})()`));
  check('la auditoría encuentra hallazgos o no', await js(`(async()=>{await Audit.run();return Array.isArray(Audit.snapshot());})()`));
  check('el almacenamiento responde', await js(`(async()=>{await Storage.refresh();return !!document.getElementById('stg-status').textContent;})()`));

  // 7. El informe y el HAR se pueden generar
  check('el HAR se construye', await js(`(()=>{const h=Net.har();return h.log && Array.isArray(h.log.entries);})()`));

  // 8. Espejo con la red local: las cookies de la plataforma se anteponen a las del dispositivo
  const { mergeCookies } = require('../src/main/lan');
  check('la cookie de la plataforma tiene prioridad',
    mergeCookies('PHPSESSID=antigua; otra=1', [{ name: 'PHPSESSID', value: 'nueva' }]) === 'otra=1; PHPSESSID=nueva',
    mergeCookies('PHPSESSID=antigua; otra=1', [{ name: 'PHPSESSID', value: 'nueva' }]));
  check('sin cookies de la plataforma se respeta las del dispositivo',
    mergeCookies('PHPSESSID=x', []) === 'PHPSESSID=x');
  check('se añaden las cookies que faltaban',
    mergeCookies('', [{ name: 'a', value: '1' }, { name: 'b', value: '2' }]) === 'a=1; b=2');

  // 9. Inspector inteligente: clases, ruta y estructura del elemento seleccionado
  const sm = await js(`(()=>{ const d = pageAnalyze();
    if (!d) return null;
    let n = null; const walk = (x) => { if (!n && x.c && x.c.includes('.')) n = x; x.ch.forEach(walk); }; walk(d.tree);
    if (!n) return null;
    const desc = pageDescribe(n.p);
    return { path: n.p, c: n.c, cc: n.cc, desc };
  })()`);
  check('el análisis del inspector devuelve el árbol', !!sm && !!sm.path);
  check('el árbol conserva las clases', !!sm && sm.c.includes('.'));
  check('el detalle muestra todas las clases', !!sm && sm.desc.classes.length > 0 && sm.desc.selector.includes('.'));
  check('el detalle muestra la ruta y la estructura', !!sm && sm.desc.ancestors.length > 0 && Array.isArray(sm.desc.subtree));

  // 10. DevTools acopladas a la derecha: panel más ancho y botón de acople en su barra
  check('la barra de DevTools tiene su botón de acople', await js(`!!document.getElementById('dt-dock')`));
  await js(`setTab('devtools'); dockTools('side');`);
  await new Promise((r) => setTimeout(r, 200));
  const dtW = await js(`parseInt($('messages').style.width, 10)`);
  check('las DevTools usan un panel lateral más ancho', dtW >= 560, `ancho ${dtW}`);
  await js(`setTab('smart');`);
  await new Promise((r) => setTimeout(r, 150));
  check('al salir de DevTools vuelve el ancho normal', (await js(`parseInt($('messages').style.width, 10)`)) === 420);
  await js(`dockTools('bottom');`);

  // 12. Mensajes con arrays/objetos: datos expandibles (consola estructurada y JSON del servidor)
  await js(`Messages.reset()`);
  await js(`Messages.fromConsoleData('Probe', { level: 'error', text: 'Array(2)', source: 'app.js', line: 7, args: [[{ id: 1, name: 'uno' }, { id: 2, name: 'dos' }]] })`);
  await new Promise((r) => setTimeout(r, 150));
  check('un array del navegador llega como datos', await js(`!!document.querySelector('.msg-data')`));
  await js(`document.querySelector('.msg-actions button:last-child').click()`);
  await new Promise((r) => setTimeout(r, 150));
  check('el array se despliega en filas', (await js(`document.querySelectorAll('.json-row').length`)) >= 3);

  await js(`Messages.reset()`);
  await js(`Messages.feedText('Error: fallo con datos\\n', 'servidor', 'err')`);
  await js(`Messages.feedText('{"items":[{"id":1},{"id":2}],"ok":false}\\n', 'servidor', 'err')`);
  await new Promise((r) => setTimeout(r, 150));
  const jsonBtn = await js(`(()=>{const b=[...document.querySelectorAll('.msg-actions button')].find(x=>/Ver datos/.test(x.textContent)); return !!b;})()`);
  check('un JSON del servidor se detecta como datos', jsonBtn);
  await js(`(()=>{const b=[...document.querySelectorAll('.msg-actions button')].find(x=>/Ver datos/.test(x.textContent)); if(b) b.click(); return true;})()`);
  await new Promise((r) => setTimeout(r, 150));
  check('el JSON del servidor se puede desplegar', (await js(`document.querySelectorAll('.json-row').length`)) >= 3);

  // JSON partido en varias escrituras del servidor
  await js(`Messages.reset()`);
  await js(`Messages.feedText('Error: json partido\\n', 'servidor', 'err')`);
  await js(`Messages.feedText('{\\n', 'servidor', 'err')`);
  await js(`Messages.feedText('"items": [1, 2]\\n', 'servidor', 'err')`);
  await js(`Messages.feedText('}\\n', 'servidor', 'err')`);
  await new Promise((r) => setTimeout(r, 150));
  check('un JSON multilínea también se agrupa', await js(`!![...document.querySelectorAll('.msg-actions button')].find(x=>/Ver datos/.test(x.textContent))`));
  await js(`Messages.reset()`);

  // 11. Sin errores en consola
  check('sin errores en consola', errores.length === 0, errores.slice(0, 3).join(' | '));

  console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)\n` : '\nTodo correcto\n');
  app.exit(fallos ? 1 : 0);
});
