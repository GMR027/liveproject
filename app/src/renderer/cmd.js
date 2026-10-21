// Paleta de comandos (Ctrl/⌘+K) y atajos de teclado de la aplicación.
const Cmd = (() => {
  let items = [];     // { title, hint, run }
  let shown = [];
  let sel = 0;
  let ui = null;

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function filter(q) {
    const t = norm(q.trim());
    if (!t) return items.slice();
    return items.filter((c) => norm(`${c.title} ${c.hint || ''}`).includes(t));
  }

  function render() {
    ui.list.textContent = '';
    shown.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = `pal-row${i === sel ? ' sel' : ''}`;
      const t = document.createElement('span');
      t.textContent = c.title;
      row.appendChild(t);
      if (c.hint) {
        const h = document.createElement('span');
        h.className = 'pal-hint';
        h.textContent = c.hint;
        row.appendChild(h);
      }
      row.onclick = () => { close(); c.run(); };
      row.onmouseenter = () => { sel = i; render(); };
      ui.list.appendChild(row);
    });
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'pal-empty';
      empty.textContent = 'Ningún comando coincide';
      ui.list.appendChild(empty);
    }
  }

  function refresh() {
    shown = filter(ui.input.value);
    sel = 0;
    render();
  }

  function open() {
    ui.box.hidden = false;
    ui.input.value = '';
    refresh();
    setTimeout(() => ui.input.focus(), 0);
  }

  function close() {
    ui.box.hidden = true;
  }

  function move(d) {
    if (!shown.length) return;
    sel = (sel + d + shown.length) % shown.length;
    render();
    const el = ui.list.children[sel];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function run() {
    const c = shown[sel];
    if (!c) return;
    close();
    c.run();
  }

  function init(o) {
    ui = { box: $('palette'), input: $('pal-input'), list: $('pal-list') };
    items = o.commands;
    ui.input.oninput = refresh;
    ui.input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); run(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    ui.box.addEventListener('pointerdown', (e) => { if (e.target === ui.box) close(); });
  }

  return { init, open, close, isOpen: () => ui && !ui.box.hidden };
})();
