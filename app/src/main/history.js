const fs = require('fs');
const path = require('path');

// Historial por sesión: <proyecto>/.liveproject/sessions/<id>.json
const MAX_SESSIONS = 50;
const dir = (root) => path.join(root, '.liveproject', 'sessions');
const safeId = (id) => String(id).replace(/[^\w.-]/g, '');

function save(root, session) {
  const d = dir(root);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${safeId(session.id)}.json`), JSON.stringify(session));
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_SESSIONS))) fs.unlinkSync(path.join(d, old));
}

function list(root) {
  const d = dir(root);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
      const msgs = s.messages || [];
      return {
        id: s.id, startedAt: s.startedAt, updatedAt: s.updatedAt,
        total: msgs.length, errors: msgs.filter((m) => m.sev === 'error').length,
        warnings: msgs.filter((m) => m.sev === 'warning').length, failedRequests: (s.network && s.network.failed || []).length
      };
    } catch { return null; }
  }).filter(Boolean);
}

const load = (root, id) => JSON.parse(fs.readFileSync(path.join(dir(root), `${safeId(id)}.json`), 'utf8'));
const remove = (root, id) => { try { fs.unlinkSync(path.join(dir(root), `${safeId(id)}.json`)); } catch { /* ya no existe */ } };

module.exports = { save, list, load, remove };
