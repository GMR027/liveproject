// Se ejecuta dentro de cada <webview>: emite y aplica scroll/clics para sincronizar dispositivos.
const { ipcRenderer, webFrame, contextBridge } = require('electron');

// Orígenes capturados en el mundo principal de la página (listeners y APIs del DOM).
let interactionOriginEvents = [];

/* ---------- consola estructurada ----------
   El evento console-message de Electron entrega una cadena («[object Object]»,
   «1,2,3»), así que se instala un gancho en el mundo de la página que envía los
   arrays y objetos serializados al panel Mensajes. El gancho va en el mundo
   principal porque el preload, con aislamiento de contexto, tiene otra consola. */
function installConsoleHook(bridge) {
  if (typeof bridge !== 'function' || window.__lpConsoleHooked) return;
  window.__lpConsoleHooked = true;
  const SENTINEL = '\u2063';
  const MAX_DEPTH = 6;
  const MAX_ITEMS = 300;

  function serialize(value, seen, depth, budget) {
    if (budget && budget.n-- <= 0) return { __lpType: 'truncated', value: '…' };
    if (value === null) return null;
    const t = typeof value;
    if (t === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
    if (t === 'number') return Number.isFinite(value) ? value : { __lpType: 'number', value: String(value) };
    if (t === 'boolean') return value;
    if (t === 'undefined') return { __lpType: 'undefined' };
    if (t === 'bigint') return { __lpType: 'bigint', value: `${value}n` };
    if (t === 'symbol') return { __lpType: 'symbol', value: String(value) };
    if (t === 'function') return { __lpType: 'function', value: `ƒ ${value.name || 'anónima'}()` };
    if (depth > MAX_DEPTH) return { __lpType: 'truncated', value: Array.isArray(value) ? `Array(${value.length})` : '…' };
    if (value instanceof Error) return { __lpType: 'error', name: value.name, message: value.message, stack: String(value.stack || '').slice(0, 4000) };
    if (value instanceof Date) return { __lpType: 'date', value: value.toISOString() };
    if (value instanceof RegExp) return { __lpType: 'regexp', value: String(value) };
    if (typeof Element !== 'undefined' && value instanceof Element) {
      const cls = value.classList && value.classList.length ? `.${[...value.classList].slice(0, 3).join('.')}` : '';
      return { __lpType: 'element', value: `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ''}${cls}>` };
    }
    if (typeof Node !== 'undefined' && value instanceof Node) return { __lpType: 'node', value: value.nodeName };
    if (typeof Window !== 'undefined' && value instanceof Window) return { __lpType: 'window', value: '[Window]' };
    if (seen.has(value)) return { __lpType: 'circular', value: '[Circular]' };
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const out = value.slice(0, MAX_ITEMS).map((v) => serialize(v, seen, depth + 1, budget));
        if (value.length > MAX_ITEMS) out.push({ __lpType: 'truncated', value: `… ${value.length - MAX_ITEMS} elementos más` });
        return out;
      }
      if (value instanceof Map) {
        return [...value.entries()].slice(0, MAX_ITEMS).map(([k, v]) => ({ key: serialize(k, seen, depth + 1, budget), value: serialize(v, seen, depth + 1, budget) }));
      }
      if (value instanceof Set) return [...value].slice(0, MAX_ITEMS).map((v) => serialize(v, seen, depth + 1, budget));
      const out = {};
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length && i < MAX_ITEMS; i++) {
        const k = keys[i];
        try { out[k] = serialize(value[k], seen, depth + 1, budget); }
        catch { out[k] = { __lpType: 'error', name: 'Error', message: '[no accesible]' }; }
      }
      if (keys.length > MAX_ITEMS) out['…'] = `${keys.length - MAX_ITEMS} claves más`;
      return out;
    } catch {
      return { __lpType: 'error', name: 'Error', message: '[no serializable]' };
    } finally {
      seen.delete(value);
    }
  }

  function preview(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'object') {
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Map) return `Map(${value.size})`;
      if (value instanceof Set) return `Set(${value.size})`;
      return '{…}';
    }
    return String(value);
  }

  // Primera línea de la pila que no sea este gancho: sitúa el mensaje en su fichero de la página.
  function site() {
    const lines = String((new Error()).stack || '').split('\n').slice(1);
    for (const l of lines) {
      if (/installConsoleHook|webview-preload/.test(l)) continue;
      const m = l.match(/(https?:\/\/[^\s)]+|file:\/\/[^\s)]+):(\d+):(\d+)/);
      if (m) return { source: m[1], line: parseInt(m[2], 10) };
    }
    return { source: '', line: 0 };
  }

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      try {
        const hasObject = args.some((a) => a !== null && typeof a === 'object');
        if (hasObject) {
          const at = site();
          bridge({
            level,
            text: args.map(preview).join(' '),
            args: args.map((a) => serialize(a, new Set(), 0, { n: 4000 })),
            source: at.source,
            line: at.line
          });
          // la copia nativa de esta llamada se reconoce por el separador invisible
          return original.apply(console, [SENTINEL, ...args]);
        }
      } catch { /* nunca romper la consola de la página */ }
      return original.apply(console, args);
    };
  }
}

/* ---------- origen del código (mundo principal) ----------
   Se instala antes de los scripts de la página. Registra quién añade listeners
   y qué API del DOM produjo cada cambio. Solo envía datos mientras se graba. */
function installOriginHook(bridge) {
  if (window.__lpOriginHooked || typeof bridge !== 'function') return;
  window.__lpOriginHooked = true;
  window.__lpOriginEnabled = false;

  const MAX = 6000;
  const own = (node) => {
    const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    return !!(el && el.closest && el.closest('[data-lp-ui], #__lp_overlay'));
  };
  const pathOf = (node) => {
    let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    if (!el) return '';
    const chain = (start) => {
      const parts = [];
      let n = start;
      while (n && n.nodeType === 1) {
        if (n === document.documentElement) return { top: 'html', parts };
        if (n === document.body) return { top: 'body', parts };
        const parent = n.parentElement;
        if (!parent) {
          const root = n.getRootNode && n.getRootNode();
          if (root && root.host) return { shadow: root.host, parts };
          return { top: '', parts };
        }
        parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${Array.prototype.indexOf.call(parent.children, n) + 1})`);
        n = parent;
      }
      return { top: '', parts };
    };
    const r = chain(el);
    if (r.shadow) return `${pathOf(r.shadow)} >>> shadow > ${r.parts.join(' > ')}`;
    if (r.top === 'html') return 'html';
    if (r.top === 'body') return r.parts.length ? `body > ${r.parts.join(' > ')}` : 'body';
    return r.parts.length ? `body > ${r.parts.join(' > ')}` : '';
  };
  const labelOf = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const cls = (el.getAttribute && el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls.length ? `.${cls.slice(0, 3).join('.')}${cls.length > 3 ? `+${cls.length - 3}` : ''}` : ''}`;
  };
  const parseStack = (stack) => {
    const lines = String(stack || '').split('\n').slice(1);
    for (const l of lines) {
      if (/installOriginHook|__lpOrigin|webview-preload/.test(l)) continue;
      const m = l.match(/((?:https?|file|blob):[^\s)]+):(\d+):(\d+)/);
      if (m) return { source: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10) };
      const local = l.match(/\(?([^\s()]+):(\d+):(\d+)\)?\s*$/);
      if (local) return { source: local[1], line: parseInt(local[2], 10), column: parseInt(local[3], 10) };
    }
    return { source: '', line: 0, column: 0 };
  };
  const capture = () => {
    const stack = String((new Error()).stack || '').slice(0, MAX);
    return { stack, ...parseStack(stack) };
  };
  const send = (payload) => {
    try { if (window.__lpOriginEnabled) bridge(payload); } catch { /* puente cerrado */ }
  };
  const report = (kind, el, api, extra) => {
    if (!window.__lpOriginEnabled || (el && own(el))) return;
    const c = capture();
    send({ t: Date.now(), kind, api, selector: el ? pathOf(el) : '', label: el ? labelOf(el) : '', ...c, ...(extra || {}) });
  };

  /* ---- listeners registrados por la página ---- */
  const listeners = new WeakMap();
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  const keyOf = (l) => `${l.source || ''}|${l.line || 0}|${l.column || 0}|${l.capture ? 1 : 0}`;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    try {
      if (listener) {
        const captureOpt = typeof options === 'boolean' ? options : !!(options && options.capture);
        const once = typeof options === 'object' && !!(options && options.once);
        const c = capture();
        let map = listeners.get(this);
        if (!map) { map = new Map(); listeners.set(this, map); }
        const arr = map.get(type) || [];
        arr.push({ listener, capture: captureOpt, once, ...c });
        map.set(type, arr);
      }
    } catch { /* registro ajeno */ }
    return origAdd.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    try {
      const captureOpt = typeof options === 'boolean' ? options : !!(options && options.capture);
      const map = listeners.get(this);
      const arr = map && map.get(type);
      if (arr) {
        const i = arr.findIndex((r) => r.listener === listener && r.capture === captureOpt);
        if (i >= 0) arr.splice(i, 1);
      }
    } catch { /* sin registro */ }
    return origRemove.apply(this, arguments);
  };

  const reportListeners = (e) => {
    if (!window.__lpOriginEnabled || !e.isTrusted) return;
    try {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const out = [];
      const seen = new Set();
      const addPhase = (target, capturePhase) => {
        const map = listeners.get(target);
        if (!map) return;
        for (const r of (map.get(e.type) || [])) {
          if (!!r.capture !== capturePhase) continue;
          const key = keyOf(r);
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ eventType: e.type, targetSelector: pathOf(target), capture: !!r.capture, once: !!r.once, source: r.source, line: r.line, column: r.column, stack: String(r.stack || '').slice(0, 3000) });
        }
      };
      for (let i = 0; i < path.length; i++) addPhase(path[i], true);
      for (let i = path.length - 1; i >= 0; i--) addPhase(path[i], false);
      if (out.length) send({ t: Date.now(), kind: 'listener', eventType: e.type, selector: pathOf(e.target), label: labelOf(e.target), listeners: out.slice(0, 8) });
    } catch { /* composición rara */ }
  };

  // Nuestro propio listener no pasa por el registro para no contaminar la lista.
  for (const type of ['pointerdown', 'click', 'input', 'change', 'submit', 'keydown']) {
    origAdd.call(document, type, reportListeners, true);
  }

  /* ---- APIs que modifican el DOM ---- */
  const listOwner = new WeakMap();
  try {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'classList');
    if (desc && desc.get && desc.configurable) {
      Object.defineProperty(Element.prototype, 'classList', {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          const list = desc.get.call(this);
          if (list) listOwner.set(list, this);
          return list;
        }
      });
    }
  } catch { /* classList no configurable */ }
  for (const m of ['add', 'remove', 'toggle', 'replace']) {
    const orig = DOMTokenList.prototype[m];
    if (typeof orig !== 'function') continue;
    DOMTokenList.prototype[m] = function (...args) {
      try { report('mutation', listOwner.get(this) || null, `classList.${m}`, { attr: 'class', classes: args.map(String) }); } catch { /* ajeno */ }
      return orig.apply(this, args);
    };
  }

  const wrapMethod = (proto, name, api, extra) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      try {
        if (!(extra && extra.skip && extra.skip(this, args))) report('mutation', this, api, extra && extra.data ? extra.data(this, args) : {});
      } catch { /* ajeno */ }
      return orig.apply(this, args);
    };
  };
  const childSkip = (_parent, args) => args.some((n) => n && n.nodeType && own(n));
  for (const [name, api] of [['appendChild', 'appendChild'], ['insertBefore', 'insertBefore'], ['removeChild', 'removeChild'], ['replaceChild', 'replaceChild']]) {
    wrapMethod(Node.prototype, name, api, { skip: childSkip, data: () => ({ kindHint: 'childList' }) });
  }
  for (const name of ['append', 'prepend', 'replaceChildren', 'remove', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText']) {
    wrapMethod(Element.prototype, name, name, { skip: childSkip, data: () => ({ kindHint: 'childList' }) });
  }
  for (const name of ['setAttribute', 'removeAttribute', 'setAttributeNS', 'removeAttributeNS']) {
    wrapMethod(Element.prototype, name, name, { data: (_el, args) => ({ attr: String(args[0] || '') }) });
  }
  try {
    const inner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (inner && inner.set && inner.configurable) {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: true, enumerable: inner.enumerable,
        get: inner.get,
        set(v) { try { report('mutation', this, 'innerHTML', { attr: 'innerHTML', kindHint: 'childList' }); } catch { /* ajeno */ } return inner.set.call(this, v); }
      });
    }
  } catch { /* innerHTML no configurable */ }
  try {
    const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (text && text.set && text.configurable) {
      Object.defineProperty(Node.prototype, 'textContent', {
        configurable: true, enumerable: text.enumerable,
        get: text.get,
        set(v) { try { report('mutation', this.nodeType === 1 ? this : this.parentElement, 'textContent', { attr: 'textContent', kindHint: 'text' }); } catch { /* ajeno */ } return text.set.call(this, v); }
      });
    }
  } catch { /* textContent no configurable */ }
}

try {
  contextBridge.exposeInMainWorld('__lpConsoleBridge', (payload) => ipcRenderer.sendToHost('console', payload));
  const run = webFrame.executeJavaScript(`(${installConsoleHook.toString()})(window.__lpConsoleBridge);`);
  if (run && run.catch) run.catch(() => {});
} catch { /* sin puente de consola */ }

try {
  contextBridge.exposeInMainWorld('__lpOriginBridge', (payload) => {
    if (!payload || !payload.kind) return;
    interactionOriginEvents.push(payload);
    if (interactionOriginEvents.length > 1200) interactionOriginEvents.splice(0, 400);
  });
  const run = webFrame.executeJavaScript(`(${installOriginHook.toString()})(window.__lpOriginBridge);`);
  if (run && run.catch) run.catch(() => {});
} catch { /* sin puente de origen */ }

function setOriginEnabled(on) {
  try {
    const run = webFrame.executeJavaScript(`window.__lpOriginEnabled = ${on ? 'true' : 'false'};`);
    if (run && run.catch) run.catch(() => {});
  } catch { /* sin mundo principal */ }
}


// Mientras se aplica un evento remoto no se reemite (evita bucles de eco entre vistas).
let applyUntil = 0;
let lastApply = 0;
const isApplying = () => performance.now() < applyUntil;
const guard = (fn, ms = 80) => {
  applyUntil = performance.now() + ms;
  lastApply = performance.now();
  fn();
};

function selectorFor(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  while (el && el.nodeType === 1 && el !== document.body) {
    let part = el.tagName.toLowerCase();
    const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
    parts.unshift(part);
    el = el.parentElement;
  }
  return 'body > ' + parts.join(' > ');
}

// Scroll: se envía en cuanto hay movimiento, a un mensaje por fotograma (sin esperar a que pare).
let scrollQueued = false;
let lastApplied = null;
window.addEventListener('scroll', () => {
  if (isApplying() || scrollQueued) return;
  // Eco de un scroll aplicado (p. ej. con scroll-behavior: smooth): no se devuelve.
  if (lastApplied !== null && Math.abs(window.scrollY - lastApplied) < 2) return;
  lastApplied = null;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    ipcRenderer.sendToHost('sync', { type: 'scroll', ratio: max > 0 ? window.scrollY / max : 0 });
  });
}, { passive: true });

window.addEventListener('click', (e) => {
  if (isApplying() || !e.isTrusted || !(e.target instanceof Element)) return;
  ipcRenderer.sendToHost('sync', { type: 'click', selector: selectorFor(e.target) });
}, true);

// Formularios: lo que se escribe o elige en una vista se replica en las demás (checkbox y radio ya viajan con el clic).
const isField = (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
  || (el instanceof HTMLInputElement && !/^(checkbox|radio|file|button|submit|reset|image)$/i.test(el.type));

function onField(e) {
  if (isApplying() || !e.isTrusted || !isField(e.target)) return;
  ipcRenderer.sendToHost('sync', { type: 'input', selector: selectorFor(e.target), value: e.target.value });
}
window.addEventListener('input', onField, true);
window.addEventListener('change', onField, true);

// sessionStorage no se comparte entre vistas (cada <webview> es un contexto aparte): se replica a mano.
function sessionSnapshot() {
  const data = {};
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      data[k] = sessionStorage.getItem(k);
    }
  } catch { /* sin permiso */ }
  return data;
}
function sendSession() {
  if (isApplying()) return;
  ipcRenderer.sendToHost('sync', { type: 'storage', data: sessionSnapshot() });
}
try {
  const put = Storage.prototype.setItem;
  const del = Storage.prototype.removeItem;
  const clr = Storage.prototype.clear;
  Storage.prototype.setItem = function (k, v) {
    const r = put.call(this, k, v);
    if (this === window.sessionStorage) sendSession();
    return r;
  };
  Storage.prototype.removeItem = function (k) {
    const r = del.call(this, k);
    if (this === window.sessionStorage) sendSession();
    return r;
  };
  Storage.prototype.clear = function () {
    const r = clr.call(this);
    if (this === window.sessionStorage) sendSession();
    return r;
  };
} catch { /* sin soporte */ }
window.addEventListener('DOMContentLoaded', sendSession);
window.addEventListener('pageshow', sendSession);

// Envío con Enter (sin botón): con un botón, el clic ya se replica.
window.addEventListener('submit', (e) => {
  if (isApplying() || !e.isTrusted || e.submitter || !(e.target instanceof HTMLFormElement)) return;
  ipcRenderer.sendToHost('sync', { type: 'submit', selector: selectorFor(e.target) });
}, true);

/* ---------- grabador de interacciones ----------
   Observa los cambios que produce un clic, una escritura o el envío de un
   formulario y los envía al panel «Interacciones». Solo graba eventos de
   confianza del usuario: lo que replica el espejo no vuelve a grabarse. */
let interactionRecording = false;
let interactionObservers = [];
let interactionObserved = new WeakSet();
let interactionConfig = { settle: 700, max: 6000, continuous: false, maxChanges: 400, maxHtml: 20000 };
let interactionSession = null;
let interactionSeq = 0;

const IR_STYLE_PROPS = ['display', 'visibility', 'opacity', 'color', 'background-color', 'transform', 'width', 'height',
  'position', 'z-index', 'flex-direction', 'justify-content', 'align-items', 'gap', 'font-size', 'font-weight',
  'border-radius', 'box-shadow', 'overflow', 'pointer-events'];

const irClip = (text, max) => {
  const s = String(text == null ? '' : text);
  return { text: s.slice(0, max), truncated: s.length > max };
};

const irOwnUi = (node) => {
  const el = node && node.nodeType === 1 ? node : (node && node.parentElement);
  return !!(el && el.closest && el.closest('[data-lp-ui], #__lp_overlay'));
};

const irClasses = (el) => {
  const raw = el && el.getAttribute ? el.getAttribute('class') : '';
  return raw ? raw.trim().split(/\s+/).filter(Boolean) : [];
};

const irLabel = (el) => {
  if (!el || el.nodeType !== 1) return '';
  const classes = irClasses(el);
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes.length ? `.${classes.slice(0, 3).join('.')}${classes.length > 3 ? `+${classes.length - 3}` : ''}` : ''}`;
};

function irPath(node) {
  let el = node && node.nodeType === 1 ? node : (node && node.parentElement);
  if (!el) return '';
  const chain = (start) => {
    const parts = [];
    let n = start;
    while (n && n.nodeType === 1) {
      if (n === document.documentElement) return { top: 'html', parts };
      if (n === document.body) return { top: 'body', parts };
      const parent = n.parentElement;
      if (!parent) {
        const root = n.getRootNode && n.getRootNode();
        if (root && root.host) return { shadow: root.host, parts };
        return { top: '', parts };
      }
      parts.unshift(`${n.tagName.toLowerCase()}:nth-child(${Array.prototype.indexOf.call(parent.children, n) + 1})`);
      n = parent;
    }
    return { top: '', parts };
  };
  const r = chain(el);
  if (r.shadow) return `${irPath(r.shadow)} >>> shadow > ${r.parts.join(' > ')}`;
  if (r.top === 'html') return 'html';
  if (r.top === 'body') return r.parts.length ? `body > ${r.parts.join(' > ')}` : 'body';
  return r.parts.length ? `body > ${r.parts.join(' > ')}` : '';
}

const irText = (el) => {
  if (!el) return '';
  for (const c of el.childNodes) if (c.nodeType === 3 && c.textContent.trim()) return c.textContent.trim().slice(0, 80);
  return '';
};

function irStyleMap(el) {
  if (!el || !el.isConnected) return null;
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of IR_STYLE_PROPS) out[p] = cs.getPropertyValue(p);
  return out;
}

function irStyleDiff(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const p of IR_STYLE_PROPS) {
    if (before[p] !== after[p]) out.push({ prop: p, oldValue: before[p], newValue: after[p] });
  }
  return out;
}

function irNodeDesc(node) {
  if (!node) return null;
  if (node.nodeType === 3) {
    const text = node.textContent || '';
    if (!text.trim()) return null;
    return { kind: 'text', text: text.trim().slice(0, 160), selector: irPath(node) };
  }
  if (node.nodeType !== 1 || irOwnUi(node)) return null;
  const classes = irClasses(node);
  const html = irClip(node.outerHTML || '', 1200);
  return {
    kind: 'element', tag: node.tagName.toLowerCase(), id: node.id || '', classes: classes.slice(0, 8),
    label: irLabel(node), selector: irPath(node), text: irText(node), html: html.text,
    htmlTruncated: html.truncated, shadow: !!node.shadowRoot
  };
}

function irObserveRoot(root) {
  if (!root || interactionObserved.has(root)) return;
  interactionObserved.add(root);
  try {
    const obs = new MutationObserver(irOnMutations);
    obs.observe(root, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true });
    interactionObservers.push(obs);
  } catch { /* raíz no observable */ }
  let all = [];
  try { all = root.querySelectorAll('*'); } catch { all = []; }
  for (const el of all) if (el.shadowRoot) irObserveRoot(el.shadowRoot);
}

function irConnect() {
  irDisconnect();
  interactionObserved = new WeakSet();
  irObserveRoot(document);
}

function irDisconnect() {
  for (const o of interactionObservers) { try { o.disconnect(); } catch { /* ya desconectado */ } }
  interactionObservers = [];
}

function irNewSession(meta, target) {
  const now = Date.now();
  const before = target ? irClip(target.outerHTML || '', interactionConfig.maxHtml) : { text: '', truncated: false };
  const session = {
    id: ++interactionSeq, at: now, startedAt: performance.now(), lastMutation: performance.now(),
    url: location.href, title: document.title, event: meta, target,
    beforeHtml: before.text, beforeHtmlTruncated: before.truncated, beforeStyles: target ? irStyleMap(target) : null,
    changes: [], map: new Map(), pathCache: new WeakMap(), timer: null, hardTimer: null, truncated: false
  };
  session.hardTimer = setTimeout(() => {
    if (session === interactionSession) irFlushSession('max');
  }, interactionConfig.max);
  return session;
}

function irScheduleFlush(s) {
  if (!s || s !== interactionSession) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => { if (s === interactionSession) irFlushSession('idle'); }, interactionConfig.settle);
}

// Reglas CSS que definen las clases implicadas. La línea solo se puede calcular
// para hojas inline; el resto se resuelve en el proceso principal si hace falta.
function irCssFor(el, classes) {
  if (!el || !classes || !classes.length) return [];
  const wanted = new Set(classes);
  const out = [];
  const seen = new Set();
  const visit = (rules, sheet) => {
    for (const rule of rules) {
      try {
        if (rule.cssRules) visit(rule.cssRules, sheet);
        if (!rule.selectorText) continue;
        let hit = false;
        for (const c of wanted) if (rule.selectorText.includes(`.${c}`)) { hit = true; break; }
        if (!hit) continue;
        const key = `${sheet.href || 'inline'}|${rule.selectorText}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let line = 0;
        const text = sheet.ownerNode && sheet.ownerNode.textContent;
        if (text) {
          const i = text.indexOf(rule.selectorText);
          if (i >= 0) line = text.slice(0, i).split('\n').length;
        }
        out.push({
          selector: rule.selectorText, cssText: (rule.cssText || '').slice(0, 500),
          source: sheet.href || location.href, inline: !sheet.href, line
        });
      } catch { /* regla no accesible */ }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules, sheet); } catch { /* hoja de otro origen */ }
  }
  return out.slice(0, 10);
}

const irApiMatches = (origin, change) => {
  const api = String(origin.api || '');
  if (change.kind === 'attribute') {
    if (change.attr === 'class') return api.startsWith('classList.') || origin.attr === 'class';
    if (change.attr === 'style') return api === 'setAttribute' || api === 'removeAttribute' || api === 'setAttributeNS';
    if (change.attr === 'innerHTML' || change.attr === 'textContent') return true;
    return origin.attr === change.attr || api === 'setAttribute' || api === 'removeAttribute' || api === 'setAttributeNS' || api === 'removeAttributeNS';
  }
  if (change.kind === 'childList') {
    return origin.kindHint === 'childList' || /^(append|prepend|insert|remove|replace|innerHTML|textContent)/.test(api);
  }
  if (change.kind === 'text') return origin.kindHint === 'text' || api === 'textContent' || api === 'innerHTML';
  return true;
};

function irOriginsForChange(change, origins) {
  const list = origins.filter((o) => o.kind === 'mutation' && irApiMatches(o, change));
  const exact = list.filter((o) => o.selector && o.selector === change.selector);
  const pool = exact.length ? exact : (change.attr === 'class' ? list : list.filter((o) => !o.selector));
  return pool.sort((a, b) => b.t - a.t).slice(0, 3);
}

function irFlushSession(reason) {
  const s = interactionSession;
  if (!s) return;
  interactionSession = null;
  clearTimeout(s.timer); clearTimeout(s.hardTimer);
  if (!s.changes.length) return;

  let htmlBudget = 60000;
  const origins = interactionOriginEvents.filter((o) => o.t >= s.at - 50);

  for (const ch of s.changes) {
    let owner = null;
    if (ch.kind === 'attribute') {
      owner = ch._el;
      const el = ch._el;
      delete ch._el;
      if (el && el.isConnected && htmlBudget > 0) {
        const after = irClip(el.outerHTML || '', Math.min(interactionConfig.maxHtml, 12000));
        ch.afterHtml = after.text;
        try {
          const clone = el.cloneNode(true);
          if (ch.oldValue == null) clone.removeAttribute(ch.attr);
          else clone.setAttribute(ch.attr, ch.oldValue);
          const before = irClip(clone.outerHTML || '', Math.min(interactionConfig.maxHtml, 12000));
          ch.beforeHtml = before.text;
          htmlBudget -= after.text.length + before.text.length;
        } catch { /* atributo no representable */ }
      }
    }
    if (ch.kind === 'attribute' && ch.attr === 'class') {
      const a = new Set(String(ch.oldValue || '').trim().split(/\s+/).filter(Boolean));
      const b = new Set(String(ch.newValue || '').trim().split(/\s+/).filter(Boolean));
      ch.added = [...b].filter((c) => !a.has(c));
      ch.removed = [...a].filter((c) => !b.has(c));
      ch.css = irCssFor(owner, ch.added.length ? ch.added : ch.removed);
    } else if (ch.kind === 'attribute' && ch.attr === 'style') {
      ch.properties = irStyleDiff(ch.oldValue || '', ch.newValue || '');
    }
  }

  const listenerEvent = [...origins].reverse().find((o) => o.kind === 'listener' && (o.eventType === s.event.type || o.eventType === 'click'));
  if (listenerEvent && listenerEvent.listeners) s.event.listeners = listenerEvent.listeners;
  for (const ch of s.changes) {
    const found = irOriginsForChange(ch, origins);
    if (found.length) { ch.origin = found[0]; ch.originCandidates = found; }
  }

  let afterHtml = null;
  let afterStyles = null;
  let targetRemoved = false;
  if (s.target) {
    if (s.target.isConnected) {
      const after = irClip(s.target.outerHTML || '', interactionConfig.maxHtml);
      afterHtml = after.text;
      afterStyles = irStyleMap(s.target);
    } else {
      targetRemoved = true;
    }
  }
  const html = (s.target && (s.beforeHtml || afterHtml)) ? {
    before: s.beforeHtml, after: afterHtml, removed: targetRemoved,
    truncated: s.beforeHtmlTruncated || (afterHtml ? afterHtml.length >= interactionConfig.maxHtml : false)
  } : null;
  const payload = {
    id: s.id, at: s.at, url: s.url, title: s.title, durationMs: Math.max(0, Math.round(performance.now() - s.startedAt)),
    event: s.event, changes: s.changes.slice(0, interactionConfig.maxChanges), truncated: s.truncated || s.changes.length > interactionConfig.maxChanges,
    reason, html, styles: irStyleDiff(s.beforeStyles, afterStyles)
  };
  try { ipcRenderer.sendToHost('interact', payload); } catch { /* vista cerrada */ }
}

function irAddMutation(s, m) {
  let el = m.target;
  if (m.type === 'characterData') el = m.target.parentElement;
  if (!el || el.nodeType !== 1 || irOwnUi(el)) return;
  const path = irPath(el);
  if (!path) return;
  const label = irLabel(el);

  if (m.type === 'attributes') {
    const attr = m.attributeName;
    if (!attr) return;
    const oldValue = m.oldValue;
    const newValue = el.getAttribute(attr);
    if (oldValue === newValue) return;
    const key = `a|${path}|${attr}`;
    let ch = s.map.get(key);
    if (!ch) {
      ch = { kind: 'attribute', attr, selector: path, label, shadow: path.includes(' >>> '), oldValue, newValue, _el: el };
      s.map.set(key, ch); s.changes.push(ch);
    } else {
      ch.newValue = newValue;
    }
    return;
  }

  if (m.type === 'characterData') {
    const oldValue = m.oldValue || '';
    const newValue = m.target.data || '';
    if (oldValue === newValue) return;
    const key = `t|${path}`;
    let ch = s.map.get(key);
    if (!ch) {
      ch = { kind: 'text', selector: path, label, shadow: path.includes(' >>> '), oldValue, newValue };
      s.map.set(key, ch); s.changes.push(ch);
    } else {
      ch.newValue = newValue;
    }
    return;
  }

  if (m.type === 'childList') {
    const added = [];
    const removed = [];
    for (const n of m.addedNodes) {
      const d = irNodeDesc(n); if (d) added.push(d);
      if (n.nodeType === 1) {
        if (n.shadowRoot) irObserveRoot(n.shadowRoot);
        for (const sub of n.querySelectorAll('*')) if (sub.shadowRoot) irObserveRoot(sub.shadowRoot);
      }
    }
    for (const n of m.removedNodes) { const d = irNodeDesc(n); if (d) removed.push(d); }
    if (!added.length && !removed.length) return;
    const key = `c|${path}`;
    let ch = s.map.get(key);
    if (!ch) {
      ch = { kind: 'childList', selector: path, label, shadow: path.includes(' >>> '), added: [], removed: [] };
      s.map.set(key, ch); s.changes.push(ch);
    }
    ch.added.push(...added);
    ch.removed.push(...removed);
    if (ch.added.length > 20 || ch.removed.length > 20) s.truncated = true;
    ch.added = ch.added.slice(0, 20);
    ch.removed = ch.removed.slice(0, 20);
  }
}

function irOnMutations(records) {
  if (!interactionRecording) return;
  const now = performance.now();
  let created = false;
  if (!interactionSession) {
    // Modo continuo: los cambios sin interacción cercana se agrupan aparte.
    // Se silencia justo después de aplicar un evento del espejo para no duplicar.
    if (!interactionConfig.continuous || now - lastApply < 1200) return;
    interactionSession = irNewSession({ type: 'background', selector: '', label: '', text: '', shadow: false }, null);
    created = true;
  }
  const s = interactionSession;
  for (const m of records) irAddMutation(s, m);
  s.lastMutation = performance.now();
  if (!s.changes.length) {
    if (created) {
      clearTimeout(s.hardTimer);
      interactionSession = null;
    }
    return;
  }
  irScheduleFlush(s);
  if (s.changes.length >= interactionConfig.maxChanges) { s.truncated = true; irFlushSession('limit'); }
}

function irOnUserEvent(e) {
  if (!interactionRecording || isApplying() || !e.isTrusted) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  let target = e.target;
  if (!target || target.nodeType !== 1) target = target && target.parentElement;
  if (!target || irOwnUi(target)) return;

  const meta = {
    type: e.type === 'keydown' ? 'keyboard' : e.type,
    selector: irPath(target), label: irLabel(target), text: irText(target), shadow: irPath(target).includes(' >>> ')
  };
  const now = performance.now();

  if (interactionSession && !interactionSession.event.background) {
    const prev = interactionSession.event;
    const same = prev.selector === meta.selector;
    const keyToClick = prev.type === 'keyboard' && meta.type === 'click' && same;
    const pointerToClick = prev.type === 'pointerdown' && meta.type === 'click' && same;
    const typing = (meta.type === 'input' || meta.type === 'change') && (prev.type === 'input' || prev.type === 'change') && same;
    if ((keyToClick || pointerToClick || typing) && now - interactionSession.lastMutation < 1600) {
      interactionSession.event = meta;
      irScheduleFlush(interactionSession);
      return;
    }
    irFlushSession('next');
  } else if (interactionSession) {
    irFlushSession('next');
  }
  interactionSession = irNewSession(meta, target);
  irScheduleFlush(interactionSession);
}

for (const type of ['pointerdown', 'click', 'input', 'change', 'submit', 'keydown']) {
  document.addEventListener(type, irOnUserEvent, true);
}
window.addEventListener('pagehide', () => { if (interactionRecording) irFlushSession('navigation'); });

ipcRenderer.on('interact', (_e, msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'start') {
    interactionConfig = { ...interactionConfig, ...(msg.config || {}) };
    setOriginEnabled(true);
    if (!interactionRecording) {
      interactionRecording = true;
      irConnect();
    }
  } else if (msg.type === 'stop') {
    interactionRecording = false;
    setOriginEnabled(false);
    irFlushSession('stop');
    irDisconnect();
  } else if (msg.type === 'config') {
    interactionConfig = { ...interactionConfig, ...(msg.config || {}) };
  } else if (msg.type === 'clear') {
    if (interactionSession) {
      clearTimeout(interactionSession.timer);
      clearTimeout(interactionSession.hardTimer);
      interactionSession = null;
    }
  }
});

ipcRenderer.on('sync', (_e, msg) => {
  if (msg.type === 'scroll') {
    guard(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = Math.round(max * msg.ratio);
      if (Math.abs(window.scrollY - y) < 1) return;
      lastApplied = y;
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    }, 120);
  } else if (msg.type === 'input') {
    guard(() => {
      const el = document.querySelector(msg.selector);
      if (!el || !isField(el) || el.value === msg.value) return;
      el.value = msg.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  } else if (msg.type === 'submit') {
    guard(() => {
      const form = document.querySelector(msg.selector);
      if (form instanceof HTMLFormElement) form.requestSubmit();
    });
  } else if (msg.type === 'click') {
    guard(() => {
      const el = document.querySelector(msg.selector);
      if (el) el.click();
    });
  } else if (msg.type === 'storage') {
    // sessionStorage replicado desde otra vista (cada <webview> tiene el suyo).
    guard(() => {
      const data = msg.data || {};
      try {
        for (const k of Object.keys(data)) {
          if (sessionStorage.getItem(k) !== data[k]) sessionStorage.setItem(k, data[k]);
        }
      } catch { /* sin permiso */ }
    });
  } else if (msg.type === 'storage-get') {
    // Otra vista acaba de cargar y pide el sessionStorage compartido.
    sendSession();
  }
});
