// Se ejecuta dentro de cada <webview>: emite y aplica scroll/clics para sincronizar dispositivos.
const { ipcRenderer, webFrame, contextBridge } = require('electron');

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

try {
  contextBridge.exposeInMainWorld('__lpConsoleBridge', (payload) => ipcRenderer.sendToHost('console', payload));
  const run = webFrame.executeJavaScript(`(${installConsoleHook.toString()})(window.__lpConsoleBridge);`);
  if (run && run.catch) run.catch(() => {});
} catch { /* sin puente de consola */ }

// Mientras se aplica un evento remoto no se reemite (evita bucles de eco entre vistas).
let applyUntil = 0;
const isApplying = () => performance.now() < applyUntil;
const guard = (fn, ms = 80) => {
  applyUntil = performance.now() + ms;
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
