// Barra de rendimiento: métricas de carga como las de Lighthouse / DevTools (Core Web Vitals y complementarias).

/* ======== se ejecuta DENTRO de la página ======== */
function pagePerf() {
  return new Promise((resolve) => {
    const out = { lcp: null, cls: 0, tbt: 0 };
    const watch = (type, cb) => {
      try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true }); } catch (e) { /* no soportado */ }
    };
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
    const fcp = fcpEntry ? fcpEntry.startTime : null;
    watch('largest-contentful-paint', (e) => { out.lcp = e.startTime; });
    watch('layout-shift', (e) => { if (!e.hadRecentInput) out.cls += e.value; });
    watch('longtask', (e) => { if (fcp === null || e.startTime >= fcp) out.tbt += Math.max(0, e.duration - 50); });
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const res = performance.getEntriesByType('resource');
      const bytes = res.reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0) + (nav ? nav.encodedBodySize || 0 : 0);
      resolve({
        ttfb: nav ? nav.responseStart : null,
        fcp,
        lcp: out.lcp,
        cls: Math.round(out.cls * 1000) / 1000,
        tbt: Math.round(out.tbt),
        load: nav && nav.loadEventEnd ? nav.loadEventEnd : null,
        size: bytes,
        requests: res.length + 1,
        nodes: document.getElementsByTagName('*').length,
        heap: performance.memory ? performance.memory.usedJSHeapSize : null
      });
    }, 350);
  });
}

/* ======== interfaz ======== */
const Perf = (() => {
  const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
  // good / poor: umbrales de Google (Web Vitals / Lighthouse); weight: peso en la nota global
  const METRICS = [
    { id: 'ttfb', label: 'TTFB', good: 800, poor: 1800, weight: 10, fmt: ms, tip: 'Tiempo hasta el primer byte del servidor' },
    { id: 'fcp', label: 'FCP', good: 1800, poor: 3000, weight: 10, fmt: ms, tip: 'First Contentful Paint: primer contenido visible' },
    { id: 'lcp', label: 'LCP', good: 2500, poor: 4000, weight: 25, fmt: ms, tip: 'Largest Contentful Paint: elemento principal visible' },
    { id: 'cls', label: 'CLS', good: 0.1, poor: 0.25, weight: 20, fmt: (v) => v.toFixed(3), tip: 'Cumulative Layout Shift: saltos del diseño' },
    { id: 'tbt', label: 'TBT', good: 200, poor: 600, weight: 25, fmt: ms, tip: 'Total Blocking Time: bloqueo del hilo principal (long tasks)' },
    { id: 'load', label: 'Load', good: 2000, poor: 4000, weight: 5, fmt: ms, tip: 'Evento load completo' },
    { id: 'size', label: 'Peso', good: 1048576, poor: 3145728, weight: 5, fmt: (v) => (v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.round(v / 1024)} KB`), tip: 'Bytes descargados (recursos + documento)' },
    { id: 'requests', label: 'Peticiones', good: 40, poor: 100, weight: 0, fmt: (v) => String(v), tip: 'Número de peticiones HTTP' },
    { id: 'nodes', label: 'Nodos DOM', good: 800, poor: 1500, weight: 0, fmt: (v) => String(v), tip: 'Elementos en el DOM (Lighthouse avisa a partir de ~800)' },
    { id: 'heap', label: 'Heap JS', good: 30 * 1048576, poor: 100 * 1048576, weight: 0, fmt: (v) => `${(v / 1048576).toFixed(1)} MB`, tip: 'Memoria JS usada' }
  ];

  const results = new Map(); // deviceId -> { name, raw, scores, overall, at }
  const history = new Map(); // deviceId -> [{ t, overall, lcp, cls, fcp }]
  const MAX_HIST = 40;
  let ui = null;
  let selectCb = () => {};
  let selectedId = () => null;

  // 1 = bueno, 0 = malo; lineal entre ambos umbrales para dar matices (verde → amarillo → rojo)
  const score = (m, v) => (v <= m.good ? 1 : v >= m.poor ? 0 : 1 - (v - m.good) / (m.poor - m.good));
  const color = (s, a = 1) => `hsla(${Math.round(s * 125)}, 72%, ${s > 0.45 && s < 0.75 ? 48 : 46}%, ${a})`;
  const label = (s) => (s >= 0.8 ? 'Bueno' : s >= 0.5 ? 'Medio' : 'Malo');

  function compute(raw) {
    const scores = {};
    let sum = 0, w = 0;
    for (const m of METRICS) {
      const v = raw[m.id];
      if (v === null || v === undefined) continue;
      scores[m.id] = score(m, v);
      if (m.weight) { sum += scores[m.id] * m.weight; w += m.weight; }
    }
    return { scores, overall: w ? sum / w : null };
  }

  async function measure(id, name, view) {
    if (!ui) return;
    try {
      const raw = await view.executeJavaScript(`(${pagePerf.toString()})()`);
      results.set(id, { name, raw, ...compute(raw), at: Date.now() });
      // historial para ver la evolución entre recargas
      const h = history.get(id) || [];
      h.push({ t: Date.now(), overall: results.get(id).overall, lcp: raw.lcp, cls: raw.cls, fcp: raw.fcp, load: raw.load });
      while (h.length > MAX_HIST) h.shift();
      history.set(id, h);
    } catch (e) { return; }
    render();
  }

  // Minigráfica del historial (SVG con la nota global de cada recarga).
  function spark(id) {
    const h = history.get(id) || [];
    const vals = h.map((x) => (x.overall == null ? null : x.overall));
    const good = vals.filter((v) => v != null);
    if (good.length < 2) return '';
    const w = 44;
    const hgt = 13;
    const min = Math.min(...good);
    const max = Math.max(...good);
    const span = Math.max(0.05, max - min);
    const pts = vals.map((v, i) => {
      if (v == null) return null;
      const x = (i / Math.max(1, vals.length - 1)) * w;
      const y = hgt - ((v - min) / span) * (hgt - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean);
    const last = good[good.length - 1];
    return `<svg class="spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".85"/>
      <circle cx="${w - 0.5}" cy="${(hgt - ((last - min) / span) * (hgt - 2) - 1).toFixed(1)}" r="1.6" fill="currentColor"/>
    </svg>`;
  }

  function render() {
    if (!ui) return;
    const bar = ui.bar;
    bar.textContent = '';
    const sel = selectedId();
    const r = results.get(sel);

    const head = document.createElement('div');
    head.className = 'perf-head';
    const title = document.createElement('b');
    title.textContent = 'Rendimiento';
    head.appendChild(title);
    for (const [id, x] of results) {
      const chip = document.createElement('span');
      chip.className = `perf-chip${id === sel ? ' sel' : ''}`;
      const dot = document.createElement('i');
      dot.style.background = x.overall === null ? '#666' : color(x.overall);
      chip.append(dot, document.createTextNode(`${x.name} ${x.overall === null ? '—' : Math.round(x.overall * 100)}`));
      const sp = spark(id);
      if (sp) {
        const s = document.createElement('span');
        s.className = 'spark-wrap';
        s.innerHTML = sp;
        chip.appendChild(s);
      }
      const h = history.get(id) || [];
      if (h.length > 1) {
        const first = h[0];
        const delta = x.overall != null && first.overall != null ? Math.round((x.overall - first.overall) * 100) : null;
        chip.title = `${h.length} medición(es) · ${delta == null ? '' : (delta >= 0 ? `+${delta}` : delta) + ' puntos desde la primera'}\nLCP ${x.raw.lcp == null ? '—' : Math.round(x.raw.lcp) + ' ms'} · CLS ${x.raw.cls}`;
      } else {
        chip.title = 'Ver métricas de este dispositivo';
      }
      chip.onclick = () => selectCb(id);
      head.appendChild(chip);
    }
    bar.appendChild(head);

    if (!r) {
      const e = document.createElement('span');
      e.className = 'muted';
      e.textContent = 'Las métricas se miden cuando carga cada vista.';
      bar.appendChild(e);
      return;
    }

    // nota global + medidor con degradado
    const total = document.createElement('div');
    total.className = 'perf-total';
    const num = document.createElement('b');
    num.textContent = r.overall === null ? '—' : String(Math.round(r.overall * 100));
    num.style.color = r.overall === null ? '' : color(r.overall);
    const txt = document.createElement('small');
    txt.textContent = r.overall === null ? 'sin datos' : label(r.overall);
    const meter = document.createElement('div');
    meter.className = 'perf-meter';
    if (r.overall !== null) {
      const pin = document.createElement('i');
      pin.style.left = `${Math.round(r.overall * 100)}%`;
      meter.appendChild(pin);
    }
    total.append(num, txt, meter);
    total.title = `Nota global (ponderada como Lighthouse) · ${r.name}`;
    bar.appendChild(total);

    const cells = document.createElement('div');
    cells.className = 'perf-cells';
    for (const m of METRICS) {
      const v = r.raw[m.id];
      const cell = document.createElement('div');
      cell.className = 'perf-cell';
      const s = r.scores[m.id];
      const lb = document.createElement('span');
      lb.textContent = m.label;
      const val = document.createElement('b');
      val.textContent = v === null || v === undefined ? 'n/d' : m.fmt(v);
      if (s !== undefined) val.style.color = color(s);
      const track = document.createElement('div');
      track.className = 'perf-track';
      if (s !== undefined) {
        const fill = document.createElement('i');
        fill.style.width = `${Math.max(8, Math.round(s * 100))}%`;
        fill.style.background = color(s);
        track.appendChild(fill);
      }
      cell.append(lb, val, track);
      cell.title = `${m.tip}\nBueno ≤ ${m.fmt(m.good)} · Malo > ${m.fmt(m.poor)}`;
      cells.appendChild(cell);
    }
    bar.appendChild(cells);
  }

  function init({ bar, onSelect, getSelected }) {
    ui = { bar };
    selectCb = onSelect;
    selectedId = getSelected;
    render();
  }

  const snapshot = () => [...results.values()].map((x) => ({
    device: x.name, score: x.overall === null ? null : Math.round(x.overall * 100),
    metrics: METRICS.filter((m) => x.raw[m.id] !== null && x.raw[m.id] !== undefined).map((m) => ({ id: m.label, value: m.fmt(x.raw[m.id]), level: label(x.scores[m.id]) }))
  }));

  return { init, measure, render, snapshot, remove: (id) => { results.delete(id); render(); } };
})();
