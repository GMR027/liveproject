// Panel «Almacenamiento»: cookies, localStorage y sessionStorage de la vista seleccionada,
// con la opción de limpiarlos (útil cuando una sesión no se cierra o hay datos de otra versión).
const Storage = (() => {
  let ui = null;
  let getView = () => null;
  let toast = () => {};
  let items = { cookies: [], local: [], session: [], url: '' };

  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };

  // Se ejecuta dentro de la página.
  function pageStore() {
    const out = { local: [], session: [] };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out.local.push({ key: k, value: String(localStorage.getItem(k)).slice(0, 400) });
      }
    } catch { /* sin acceso */ }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        out.session.push({ key: k, value: String(sessionStorage.getItem(k)).slice(0, 400) });
      }
    } catch { /* sin acceso */ }
    return out;
  }

  function render() {
    if (!ui) return;
    ui.list.textContent = '';
    const total = items.cookies.length + items.local.length + items.session.length;
    ui.status.textContent = total
      ? `${items.cookies.length} cookie(s) · ${items.local.length} clave(s) local · ${items.session.length} de sesión`
      : 'Sin datos de almacenamiento en esta vista';

    const section = (title, list, kind) => {
      const box = el('div', 'stg-sec', ui.list);
      el('h5', '', box, `${title} (${list.length})`);
      if (!list.length) { el('div', 'muted', box, '—'); return; }
      for (const it of list) {
        const row = el('div', 'stg-row', box);
        const k = el('code', 'stg-key', row, it.key);
        k.title = it.key;
        if (it.value !== undefined) {
          const v = el('span', 'stg-val', row, it.value);
          v.title = it.value;
        } else if (it.domain) {
          const d = el('span', 'stg-val', row, `${it.domain}${it.path || ''}`);
          d.title = `${it.domain}${it.path || ''} · ${it.secure ? 'segura' : 'sin cifrar'}${it.expires ? ` · caduca ${it.expires}` : ' · sesión'}`;
        }
        const del = el('button', '', row, '🗑');
        del.type = 'button';
        del.title = 'Borrar';
        del.onclick = () => remove(kind, it);
      }
    };
    section('Cookies', items.cookies, 'cookie');
    section('localStorage', items.local, 'local');
    section('sessionStorage', items.session, 'session');
  }

  async function refresh() {
    if (!ui) return;
    const v = getView();
    if (!v) { items = { cookies: [], local: [], session: [], url: '' }; render(); return; }
    ui.status.textContent = 'Leyendo…';
    let store = { local: [], session: [] };
    try { store = await v.executeJavaScript(`(${pageStore.toString()})()`); } catch { /* sin acceso */ }
    let url = '';
    try { url = typeof v.getURL === 'function' ? (v.getURL() || '') : ''; } catch { /* sin adjuntar */ }
    let cookies = [];
    try { cookies = await window.liveproject.cookiesFor(url); } catch { /* sin cookies */ }
    items = { cookies: cookies || [], local: store.local || [], session: store.session || [], url };
    render();
  }

  async function remove(kind, it) {
    const v = getView();
    if (!v) return;
    if (kind === 'cookie') {
      const r = await window.liveproject.cookieDelete(it.domain, it.name, it.path);
      if (!r || !r.ok) return toast('No se pudo borrar la cookie');
    } else {
      const key = JSON.stringify(it.key);
      try {
        await v.executeJavaScript(kind === 'local'
          ? `localStorage.removeItem(${key})`
          : `sessionStorage.removeItem(${key})`);
      } catch { /* sin acceso */ }
    }
    refresh();
  }

  async function clearAll() {
    const v = getView();
    if (!v) return;
    try { await v.executeJavaScript('localStorage.clear(); sessionStorage.clear();'); } catch { /* sin acceso */ }
    if (items.url) await window.liveproject.cookiesClear(items.url);
    toast('Almacenamiento de la vista limpiado');
    refresh();
  }

  function init(o) {
    ui = o;
    getView = o.getView;
    toast = o.toast;
    o.btn.onclick = refresh;
    o.clearBtn.onclick = clearAll;
    render();
  }

  return { init, refresh, render };
})();
