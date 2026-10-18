// Se ejecuta dentro de cada <webview>: emite y aplica scroll/clics para sincronizar dispositivos.
const { ipcRenderer } = require('electron');

let applying = false;
const guard = (fn) => {
  applying = true;
  try { fn(); } finally { setTimeout(() => { applying = false; }, 80); }
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

let scrollTimer = null;
window.addEventListener('scroll', () => {
  if (applying) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    ipcRenderer.sendToHost('sync', { type: 'scroll', ratio: max > 0 ? window.scrollY / max : 0 });
  }, 10);
}, { passive: true });

window.addEventListener('click', (e) => {
  if (applying || !e.isTrusted || !(e.target instanceof Element)) return;
  ipcRenderer.sendToHost('sync', { type: 'click', selector: selectorFor(e.target) });
}, true);

ipcRenderer.on('sync', (_e, msg) => {
  if (msg.type === 'scroll') {
    guard(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.round(max * msg.ratio));
    });
  } else if (msg.type === 'click') {
    guard(() => {
      const el = document.querySelector(msg.selector);
      if (el) el.click();
    });
  }
});
