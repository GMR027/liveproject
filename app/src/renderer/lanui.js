// Red local: abre el proyecto en otros dispositivos (móvil real, tableta, otro equipo) de la misma red, con QR y recarga automática.
const Lan = (() => {
  let ui = null;
  let st = { running: false, addresses: [], clients: [] };
  let pathOf = () => '/';
  let chosen = 0;

  const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e; };

  function drawQr(canvas, text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), cell = 5, m = 3;
    canvas.width = canvas.height = (n + m * 2) * cell;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + m) * cell, (r + m) * cell, cell, cell);
  }

  function render() {
    if (!ui) return;
    ui.btn.classList.toggle('active', st.running);
    ui.toggle.textContent = st.running ? '⏹ Detener' : '▶ Compartir en la red local';
    ui.body.textContent = '';
    if (!st.running) {
      el('p', 'muted', ui.body, 'Reenvía tu proyecto a la red Wi-Fi/Ethernet para abrirlo en un móvil real, una tableta u otro equipo. Los dispositivos se recargan solos al guardar y sus errores de JavaScript aparecen en el panel Mensajes.');
      el('p', 'lan-warn', ui.body, '⚠ Mientras esté activo, cualquier equipo de tu red podrá ver este proyecto. Úsalo solo en redes de confianza.');
      if (!st.addresses.length) el('p', 'muted', ui.body, 'No se detectó ninguna interfaz de red local.');
      return;
    }
    const addrs = st.addresses;
    if (!addrs.length) { el('p', 'lan-warn', ui.body, 'Activo, pero no hay interfaz de red local: conéctate a una red.'); return; }
    if (chosen >= addrs.length) chosen = 0;
    const urlFor = (a) => `http://${a.address}:${st.port}${pathOf()}`;
    const top = el('div', 'lan-top', ui.body);
    const left = el('div', 'lan-urls', top);
    el('div', 'muted', left, 'Abre esta dirección en el otro dispositivo (o escanea el QR):');
    addrs.forEach((a, i) => {
      const row = el('div', `lan-url${i === chosen ? ' sel' : ''}`, left);
      el('code', '', row, urlFor(a));
      el('small', 'muted', row, a.name);
      const cp = el('button', '', row, 'Copiar');
      cp.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(urlFor(a)); };
      row.onclick = () => { chosen = i; render(); };
    });
    const canvas = el('canvas', 'lan-qr', top);
    try { drawQr(canvas, urlFor(addrs[chosen])); } catch { canvas.remove(); }
    el('h4', '', ui.body, `Dispositivos conectados (${st.clients.length})`);
    if (!st.clients.length) el('div', 'muted', ui.body, 'Ninguno todavía.');
    for (const c of st.clients) el('div', 'lan-client', ui.body, `📱 ${c.name} · ${c.ip}`);
    el('p', 'muted', ui.body, `Si no conecta, revisa el cortafuegos del equipo (puerto ${st.port}) y que ambos estén en la misma red. Los servidores con HMR/WebSocket también funcionan a través del túnel.`);
  }

  function set(s) {
    st = { ...st, ...s };
    ui.count.textContent = st.running ? String(st.clients.length) : '';
    ui.count.hidden = !(st.running && st.clients.length);
    render();
  }

  async function toggle() {
    const r = st.running ? await window.liveproject.lanStop() : await window.liveproject.lanStart();
    if (r.ok === false) ui.toast(`No se pudo abrir el puerto: ${r.error}`);
    set(r);
  }

  async function open() {
    set(await window.liveproject.lanStatus());
    window.liveproject.devtoolsVisible(false);
    ui.dialog.showModal();
  }

  function init(o) {
    ui = o; pathOf = o.pathOf;
    o.btn.onclick = open;
    o.toggle.onclick = toggle;
    o.close.onclick = () => o.dialog.close();
    o.dialog.addEventListener('close', () => window.liveproject.devtoolsVisible(true));
    window.liveproject.onLanClients((clients) => set({ clients }));
    render();
  }

  return { init };
})();
