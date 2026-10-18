// Historial de errores por sesión: se guarda en <proyecto>/.liveproject/sessions/<id>.json y se puede consultar después.
const Sessions = (() => {
  let ui = null;
  let cur = null;       // { id, startedAt, project }
  let timer = null;
  let viewing = null;   // sesión antigua abierta en el visor
  let hasProject = () => false;
  const SEV_ICON = { error: '⛔', warning: '⚠️', notice: 'ℹ️' };

  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

  function start(project) {
    clearTimeout(timer);
    cur = { id: stamp(), startedAt: Date.now(), project };
    viewing = null;
  }

  function snapshot() {
    return {
      id: cur.id, project: cur.project, startedAt: cur.startedAt, updatedAt: Date.now(),
      messages: Messages.snapshot(), network: Net.snapshot(), links: Links.snapshot(), csslint: CssLint.snapshot(), perf: Perf.snapshot()
    };
  }

  // Guarda con retardo para agrupar ráfagas de mensajes; solo si hay algo que guardar.
  function touch() {
    if (!cur || !hasProject()) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = snapshot();
      if (!s.messages.length && !s.network.failed.length) return;
      await window.liveproject.historySave(s);
    }, 2500);
  }

  const when = (t) => new Date(t).toLocaleString();

  async function render() {
    if (!ui) return;
    ui.list.textContent = '';
    if (viewing) { renderViewer(); return; }
    const list = await window.liveproject.historyList();
    if (!list.length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'Aún no hay sesiones guardadas. Se guardan solas en .liveproject/sessions/ cuando aparecen errores.';
      ui.list.appendChild(h);
      return;
    }
    for (const s of list) {
      const row = document.createElement('div');
      row.className = `hist-row${cur && s.id === cur.id ? ' current' : ''}`;
      const main = document.createElement('div');
      main.className = 'hist-main';
      const t = document.createElement('b'); t.textContent = when(s.startedAt) + (cur && s.id === cur.id ? ' · sesión actual' : '');
      const d = document.createElement('small');
      d.textContent = `⛔ ${s.errors}  ⚠️ ${s.warnings}  · ${s.total} mensaje(s)${s.failedRequests ? ` · ${s.failedRequests} petición(es) fallida(s)` : ''}`;
      main.append(t, d);
      main.onclick = async () => { viewing = await window.liveproject.historyLoad(s.id); render(); };
      const del = document.createElement('button');
      del.textContent = '🗑'; del.title = 'Eliminar sesión';
      del.onclick = async (e) => { e.stopPropagation(); await window.liveproject.historyDelete(s.id); render(); };
      row.append(main, del);
      ui.list.appendChild(row);
    }
  }

  function renderViewer() {
    const back = document.createElement('button');
    back.textContent = '← Volver'; back.className = 'hist-back';
    back.onclick = () => { viewing = null; render(); };
    const head = document.createElement('div');
    head.className = 'muted hist-head';
    head.textContent = `Sesión del ${when(viewing.startedAt)} · ${viewing.messages.length} mensaje(s)`;
    ui.list.append(back, head);
    for (const m of viewing.messages) {
      const r = document.createElement('div');
      r.className = `msg sev-${m.sev}`;
      const h = document.createElement('div'); h.className = 'msg-head';
      const tag = document.createElement('span'); tag.className = 'lang-tag'; tag.textContent = m.lang;
      const meta = document.createElement('span'); meta.className = 'muted'; meta.textContent = `${(m.origins || []).join(', ')} · ${new Date(m.time).toLocaleTimeString()}`;
      const i = document.createElement('span'); i.textContent = SEV_ICON[m.sev];
      h.append(i, tag, meta);
      if (m.count > 1) { const c = document.createElement('span'); c.className = 'count'; c.textContent = `×${m.count}`; h.appendChild(c); }
      const t = document.createElement('div'); t.className = 'msg-title'; t.textContent = m.title;
      r.append(h, t);
      if (m.detail && m.detail.length) { const pre = document.createElement('pre'); pre.className = 'msg-detail'; pre.textContent = m.detail.join('\n'); r.appendChild(pre); }
      if (m.ai) { const a = document.createElement('div'); a.className = 'msg-ai'; a.textContent = m.ai; r.appendChild(a); }
      ui.list.appendChild(r);
    }
    const net = viewing.network && viewing.network.failed || [];
    if (net.length) {
      const h = document.createElement('div'); h.className = 'links-h'; h.textContent = `Peticiones fallidas (${net.length})`;
      ui.list.appendChild(h);
      for (const n of net) {
        const d = document.createElement('div'); d.className = 'issue sev-error';
        const a = document.createElement('span'); a.textContent = `${n.method} ${n.error || n.status} · ${n.device}`;
        const b = document.createElement('small'); b.textContent = n.url;
        d.append(a, b); ui.list.appendChild(d);
      }
    }
  }

  function init(o) {
    ui = o; hasProject = o.hasProject;
    o.refreshBtn.onclick = () => { viewing = null; render(); };
    o.reportBtn.onclick = o.onReport;
  }

  return { init, start, touch, snapshot, render, current: () => cur };
})();
