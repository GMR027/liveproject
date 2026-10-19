// Se ejecuta dentro de cada <webview>: emite y aplica scroll/clics para sincronizar dispositivos.
const { ipcRenderer } = require('electron');

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
  }
});
