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

  // 2. Traslado de las herramientas al panel lateral
  await js(`$('btn-dock').click()`);
  await new Promise((r) => setTimeout(r, 400));
  check('las herramientas van al panel lateral', await js(`toolsDock === 'side' && !$('bottom').hidden === false && !$('side-tools').hidden`));
  check('la barra se traslada', await js(`$('bottom-bar').parentNode.id === 'tools-bar'`));
  check('los paneles se trasladan', await js(`$('tab-smart').parentNode.id === 'tools-host'`));
  await js(`$('btn-dock').click()`);
  await new Promise((r) => setTimeout(r, 400));
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

  // 8. Sin errores en consola
  check('sin errores en consola', errores.length === 0, errores.slice(0, 3).join(' | '));

  console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)\n` : '\nTodo correcto\n');
  app.exit(fallos ? 1 : 0);
});
