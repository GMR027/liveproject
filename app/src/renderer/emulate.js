// Emulación por vista: velocidad de red, CPU lenta y preferencias del sistema
// (tema claro/oscuro, movimiento reducido y colores forzados) en cada dispositivo.
// Se aplica sobre el webContents de la vista con el protocolo de DevTools.
const Emulate = (() => {
  const DEF = { net: 'none', cpu: 1, scheme: 'auto', motion: 'auto', forced: 'auto' };
  const NETS = [['none', 'Sin límite'], ['3g', '3G'], ['4g', '4G'], ['offline', 'Sin conexión']];
  const CPUS = [[1, '×1'], [4, '×4'], [6, '×6']];
  const SCHEMES = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']];
  const MOTIONS = [['auto', 'Automático'], ['reduce', 'Reducido']];
  const FORCED = [['auto', 'Automático'], ['active', 'Forzado']];

  const state = new Map();   // id de dispositivo -> ajustes
  let frames = () => [];
  let toast = () => {};
  let menu = null;

  const KEY = 'lp-emulate';
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...state])); } catch { /* sin almacenamiento */ } };
  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (Array.isArray(raw)) for (const [k, v] of raw) if (v && typeof v === 'object') state.set(k, { ...DEF, ...v });
    } catch { /* sin almacenamiento */ }
  };

  const isDefault = (s) => s.net === 'none' && s.cpu === 1 && s.scheme === 'auto' && s.motion === 'auto' && s.forced === 'auto';
  const of = (id) => state.get(id) || DEF;
  const netLabel = (n) => ({ none: '', '3g': '3G', '4g': '4G', offline: '✈' }[n] || '');

  /* ---------- botón en el título del dispositivo ---------- */
  function mount(f) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emu-btn';
    btn.title = 'Emular red, CPU y preferencias del sistema en esta vista';
    btn.onclick = (e) => { e.stopPropagation(); toggle(f, btn); };
    f.title.insertBefore(btn, f.title.children[1] || null);  // junto al nombre del dispositivo
    f.emuBtn = btn;
    paint(f);
  }

  function paint(f) {
    if (!f.emuBtn) return;
    const s = of(f.device.id);
    const parts = [];
    if (s.net !== 'none') parts.push(netLabel(s.net));
    if (s.cpu > 1) parts.push(`${s.cpu}×`);
    if (s.scheme !== 'auto') parts.push(s.scheme === 'dark' ? '🌙' : '☀');
    if (s.motion === 'reduce') parts.push('🐌');
    if (s.forced === 'active') parts.push('🎨');
    f.emuBtn.textContent = parts.length ? `🌐 ${parts.join(' ')}` : '🌐';
    f.emuBtn.classList.toggle('on', parts.length > 0);
    const full = [];
    if (s.net !== 'none') full.push(`Red: ${s.net === 'offline' ? 'sin conexión' : s.net.toUpperCase()}`);
    if (s.cpu > 1) full.push(`CPU ${s.cpu}× más lenta`);
    if (s.scheme !== 'auto') full.push(`prefers-color-scheme: ${s.scheme}`);
    if (s.motion === 'reduce') full.push('prefers-reduced-motion: reduce');
    if (s.forced === 'active') full.push('forced-colors: active');
    f.emuBtn.title = full.length ? `Emulación activa — ${full.join(' · ')}` : 'Emular red, CPU y preferencias del sistema en esta vista';
  }

  /* ---------- menú ---------- */
  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', outside, true);
  }
  const outside = (e) => { if (menu && !menu.contains(e.target)) close(); };

  function toggle(f, btn) {
    if (menu && menu.dataset.dev === f.device.id) { close(); return; }
    close();
    const m = document.createElement('div');
    m.className = 'emu-menu';
    m.dataset.dev = f.device.id;
    const head = document.createElement('div');
    head.className = 'emu-head';
    head.textContent = `Emular · ${f.device.name}`;
    m.appendChild(head);

    const row = (label, options, key) => {
      const r = document.createElement('div');
      r.className = 'emu-row';
      const l = document.createElement('span');
      l.className = 'emu-lab';
      l.textContent = label;
      const g = document.createElement('div');
      g.className = 'emu-grp';
      for (const [val, text] of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `emu-opt${of(f.device.id)[key] === val ? ' on' : ''}`;
        b.textContent = text;
        b.dataset.key = key;
        b.dataset.val = val;
        b.onclick = () => { set(f, key, val); };
        g.appendChild(b);
      }
      r.append(l, g);
      m.appendChild(r);
    };
    row('Red', NETS, 'net');
    row('CPU', CPUS, 'cpu');
    row('Tema', SCHEMES, 'scheme');
    row('Movimiento', MOTIONS, 'motion');
    row('Colores', FORCED, 'forced');

    const foot = document.createElement('div');
    foot.className = 'emu-foot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Restablecer';
    reset.onclick = () => { set(f, 'reset', true); close(); };
    const note = document.createElement('span');
    note.textContent = 'Afecta solo a esta vista';
    foot.append(reset, note);
    m.appendChild(foot);

    document.body.appendChild(m);
    menu = m;
    const r = btn.getBoundingClientRect();
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    m.style.top = `${Math.min(window.innerHeight - h - 8, r.bottom + 8)}px`;
    document.addEventListener('pointerdown', outside, true);
  }

  /* ---------- aplicación ---------- */
  async function set(f, key, val) {
    const id = f.device.id;
    if (key === 'reset') state.delete(id);
    else state.set(id, { ...of(id), [key]: val });
    paint(f);
    save();
    if (menu) menu.querySelectorAll('.emu-opt').forEach((b) => b.classList.toggle('on', of(id)[b.dataset.key] === b.dataset.val));
    const s = of(id);
    const wcId = f.wcId;
    if (!wcId) return;
    const r = await window.liveproject.emulateSet(wcId, s);
    if (r && !r.ok && r.error === 'devtools') {
      toast('Las DevTools de esta vista tienen el control de la emulación: usa su panel de throttling (Network/CPU) o ciérralas para que LiveProject la reaplique');
    }
  }

  // Reaplica los ajustes cuando la vista termina de cargar (o se recrea).
  function onReady(f) {
    const s = of(f.device.id);
    if (isDefault(s) || !f.wcId) return;
    window.liveproject.emulateSet(f.wcId, s);
  }

  function reset() {
    state.clear();
    save();
    for (const f of frames()) paint(f);
  }

  function init(o) {
    frames = o.frames;
    toast = o.toast;
    load();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  return { init, mount, paint, set, onReady, reset, state, of };
})();
