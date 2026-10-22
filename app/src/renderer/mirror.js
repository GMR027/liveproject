// Espejo: mantiene las vistas de la plataforma (y los dispositivos del túnel) viendo siempre lo mismo.
// - Lo que se escribe, se hace clic o se navega en una vista se replica en las demás.
// - Las vistas siguen al túnel y al revés: mismo contenido, misma sesión y misma ruta.
const Mirror = (() => {
  let api = null;
  const want = new Map();   // id de vista -> URL que debe mostrar
  const waiters = new Map(); // id de vista -> rutas pendientes de aplicar (esperan a que termine la carga)
  const tried = new Map();  // id de vista -> URL que ya se reintentó (evita bucles con URLs que fallan)
  const own = new Map();    // vistas cuya próxima navegación es intencionada (no se replica)

  const norm = (u) => {
    try { const x = new URL(u); x.hash = ''; return x.href; } catch { return String(u || ''); }
  };
  const origin = (u) => {
    try { return new URL(u).origin; } catch { return ''; }
  };
  const pathOf = (u) => {
    try { const x = new URL(u); return `${x.pathname}${x.search}${x.hash}`; } catch { return '/'; }
  };
  const hashOf = (u) => {
    try { return new URL(u).hash; } catch { return ''; }
  };
  const loading = (f) => { try { return f.view.isLoading(); } catch { return false; } };

  function init(o) { api = o; }

  // Cuando la vista termine de cargar lo que está, se aplican las rutas pendientes.
  function whenIdle(f, cb) {
    const id = f.device.id;
    const list = waiters.get(id) || [];
    list.push(cb);
    waiters.set(id, list);
    if (list.length > 1) return;   // ya estamos esperando a esta vista
    const done = () => {
      f.view.removeEventListener('did-finish-load', done);
      f.view.removeEventListener('did-stop-loading', done);
      const cbs = waiters.get(id) || [];
      waiters.delete(id);
      for (const c of cbs) { try { c(); } catch { /* sin adjuntar */ } }
    };
    f.view.addEventListener('did-finish-load', done);
    f.view.addEventListener('did-stop-loading', done);
    if (!loading(f)) done();        // ya terminó mientras tanto: no esperamos
  }

  // Carga una URL en una vista (sin recargar si solo cambia el ancla).
  function apply(f, url) {
    const id = f.device.id;
    try {
      if (loading(f)) {                       // está cargando: se aplica al terminar
        whenIdle(f, () => {
          if (want.get(id) !== url) return;   // ya no queremos esta ruta
          if (tried.get(id) === url) return;  // no insistir con una URL que falla
          tried.set(id, url);
          apply(f, url);
        });
        return;
      }
      const cur = f.view.getURL();
      if (cur === url) return;
      if (cur && norm(cur) === norm(url)) {   // solo cambia el ancla (#): sin recargar
        f.view.executeJavaScript(`location.hash = ${JSON.stringify(hashOf(url))}`).catch(() => {});
        return;
      }
      f.view.loadURL(url);
    } catch { /* la vista aún no está adjunta */ }
  }

  // Pide que una vista muestre una URL.
  function navigate(f, url) {
    if (!f || !f.view || !url) return;
    const id = f.device.id;
    if (want.get(id) === url) return;   // ya se le pidió esa URL
    want.set(id, url);
    tried.delete(id);
    apply(f, url);
  }
  // Mensaje de una vista (clic, texto, scroll, formulario…).
  function onSync(fromId, msg) {
    if (!api || !msg || !api.enabled()) return;
    const m = { ...msg, src: `app:${fromId}` };
    for (const f of api.frames()) {
      if (f.device.id === fromId || !f.ready) continue;
      try { f.view.send('sync', m); } catch { /* sin adjuntar */ }
    }
    // El túnel ve lo mismo que la plataforma (el sessionStorage es propio de cada origen).
    if (m.type !== 'storage' && m.type !== 'storage-get') api.sendTunnel(m);
  }

  // Una vista ha cambiado de página: las demás la siguen.
  function onNavigate(f, url) {
    if (!api || !f || !url) return;
    const id = f.device.id;
    // Navegación intencionada en una sola vista (p. ej. «abrir solo aquí»): no se replica.
    const t = own.get(id);
    if (t && Date.now() - t < 8000) { own.delete(id); want.delete(id); return; }
    const w = want.get(id);
    if (w === url) { want.delete(id); return; }   // es la ruta que le pedimos: no se devuelve
    if (w) want.set(id, url);                     // era una redirección: manda la ruta final
    if (!api.enabled()) return;
    for (const other of api.frames()) {
      if (other === f || !other.ready) continue;
      navigate(other, url);
    }
    // El túnel solo replica las páginas del propio proyecto.
    const target = api.targetOrigin();
    if (target && origin(url) === target) api.sendTunnel({ type: 'nav', path: pathOf(url) });
  }

  // Mensaje de un dispositivo conectado al túnel: se aplica a todas las vistas.
  function onTunnel(msg) {
    if (!api || !msg || !api.enabled()) return;
    for (const f of api.frames()) {
      if (!f.ready) continue;
      try { f.view.send('sync', msg); } catch { /* sin adjuntar */ }
    }
  }

  // Un dispositivo del túnel ha navegado: las vistas van a su misma ruta.
  function onTunnelNav(path) {
    if (!api || !api.enabled()) return;
    const target = api.targetOrigin();
    if (!target) return;
    // Solo si las vistas están en el proyecto (si no, están en otra web y no se tocan).
    const current = api.currentUrl();
    if (current && origin(current) !== target) return;
    const url = target + (String(path || '/').startsWith('/') ? path : `/${path}`);
    for (const f of api.frames()) navigate(f, url);
    api.onUrl(url);
  }
  // Marca la siguiente navegación de una vista como propia (no se replica).
  function suppress(id) { own.set(id, Date.now()); }

  // Marca una URL como esperada en una vista (no se replica cuando llegue).
  function expect(id, url) { want.set(id, url); }

  // Origen del proyecto (el que sirve el túnel).
  const target = () => (api ? api.targetOrigin() : '');

  return { init, onSync, onNavigate, onTunnel, onTunnelNav, suppress, expect, target };
})();
