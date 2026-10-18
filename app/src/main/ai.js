const { app, safeStorage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// kind: ollama | openai (compatible con /chat/completions) | anthropic | cli
const PROVIDERS = {
  ollama: { label: 'Ollama', group: 'local', kind: 'ollama', base: 'http://127.0.0.1:11434', key: false,
    hint: 'Modelos locales con Ollama (ollama.com). Debe estar en ejecución: `ollama serve`.' },
  lmstudio: { label: 'LM Studio', group: 'local', kind: 'openai', base: 'http://127.0.0.1:1234/v1', key: false,
    hint: 'Activa el servidor local en LM Studio (pestaña Developer) y carga un modelo.' },
  custom: { label: 'Servidor compatible con OpenAI', group: 'local', kind: 'openai', base: 'http://127.0.0.1:8080/v1', key: false,
    hint: 'llama.cpp, vLLM, LocalAI, OpenRouter… cualquier endpoint /v1/chat/completions. La clave es opcional.' },
  anthropic: { label: 'Anthropic (Claude)', group: 'api', kind: 'anthropic', base: 'https://api.anthropic.com', key: true,
    hint: 'Clave de API de console.anthropic.com. Se cobra por uso, aparte de cualquier suscripción Claude.' },
  openai: { label: 'OpenAI', group: 'api', kind: 'openai', base: 'https://api.openai.com/v1', key: true,
    hint: 'Clave de API de platform.openai.com. Se cobra por uso, aparte de ChatGPT Plus/Pro.' },
  gemini: { label: 'Google Gemini', group: 'api', kind: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: true,
    hint: 'Clave de API de aistudio.google.com (endpoint compatible con OpenAI).' },
  'cli-claude': { label: 'Claude Code (suscripción)', group: 'subscription', kind: 'cli', bin: 'claude', args: (p) => ['-p', p],
    hint: 'Usa tu suscripción Claude Pro/Max a través de la CLI oficial. Instálala e inicia sesión con `claude` antes.' },
  'cli-codex': { label: 'Codex CLI (suscripción ChatGPT)', group: 'subscription', kind: 'cli', bin: 'codex', args: (p) => ['exec', p],
    hint: 'Usa tu suscripción ChatGPT mediante la CLI oficial de Codex. Inicia sesión con `codex login`.' },
  'cli-gemini': { label: 'Gemini CLI (cuenta Google)', group: 'subscription', kind: 'cli', bin: 'gemini', args: (p) => ['-p', p],
    hint: 'Usa tu cuenta de Google a través de Gemini CLI. Ejecútala una vez para iniciar sesión.' }
};

const RECOMMENDED = {
  anthropic: [
    ['claude-haiku-5-5', 'Rápido y económico: ideal para explicar errores al instante'],
    ['claude-sonnet-5-5', 'Equilibrio calidad/precio: recomendado para depurar'],
    ['claude-opus-5-5', 'Máxima calidad: problemas complejos de arquitectura']
  ],
  openai: [
    ['gpt-5-mini', 'Rápido y económico para errores y revisiones'],
    ['gpt-5', 'Mayor calidad para depuración compleja']
  ],
  gemini: [
    ['gemini-2.5-flash', 'Rápido y barato (tiene nivel gratuito)'],
    ['gemini-2.5-pro', 'Más capaz para código complejo']
  ],
  lmstudio: [
    ['qwen2.5-coder-7b-instruct', 'Buen modelo de código para 16 GB de RAM'],
    ['qwen2.5-coder-14b-instruct', 'Mejor calidad si tienes ≥ 24 GB'],
    ['deepseek-coder-v2-lite-instruct', 'Alternativa especializada en código']
  ],
  custom: [['(el que sirva tu endpoint)', 'Usa «Comprobar» para listar los modelos disponibles']]
};

function ollamaTiers(ramGB) {
  if (ramGB < 8) return [['qwen2.5-coder:3b', 'Ligero, para equipos con poca RAM'], ['llama3.2:3b', 'Respuestas generales rápidas']];
  if (ramGB < 16) return [['qwen2.5-coder:7b', 'Recomendado para tu RAM: muy bueno en código'], ['llama3.1:8b', 'Alternativa generalista']];
  if (ramGB < 32) return [['qwen2.5-coder:14b', 'Recomendado para tu RAM: mejor razonamiento sobre código'], ['gpt-oss:20b', 'Modelo abierto de razonamiento'], ['qwen2.5-coder:7b', 'Opción más rápida']];
  return [['qwen2.5-coder:32b', 'Recomendado para tu RAM: calidad cercana a modelos en la nube'], ['gpt-oss:20b', 'Razonamiento general'], ['qwen2.5-coder:14b', 'Más rápido']];
}

/* ---------- almacenamiento ---------- */
const file = () => path.join(app.getPath('userData'), 'ai.json');
const DEFAULTS = { provider: 'ollama', baseUrl: PROVIDERS.ollama.base, model: '', key: '', connected: false };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function persist(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
const encode = (k) => (!k ? '' : safeStorage.isEncryptionAvailable()
  ? 'enc:' + safeStorage.encryptString(k).toString('base64') : 'plain:' + Buffer.from(k).toString('base64'));
const decode = (s) => {
  if (!s) return '';
  try {
    return s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
      : Buffer.from(s.replace(/^plain:/, ''), 'base64').toString();
  } catch { return ''; }
};

function publicConfig() {
  const c = load();
  return {
    provider: c.provider, baseUrl: c.baseUrl, model: c.model, connected: c.connected, hasKey: !!c.key,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { label: p.label, group: p.group, kind: p.kind, base: p.base, key: p.key, hint: p.hint }]))
  };
}

// patch.apiKey: undefined = conservar, '' = borrar, texto = reemplazar
function save(patch) {
  const c = load();
  if (patch.provider && patch.provider !== c.provider && typeof patch.apiKey !== 'string') { c.key = ''; c.connected = false; }
  if (patch.provider) c.provider = patch.provider;
  if (typeof patch.baseUrl === 'string') c.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '');
  if (typeof patch.model === 'string') c.model = patch.model.trim();
  if (typeof patch.apiKey === 'string') c.key = encode(patch.apiKey.trim());
  if (typeof patch.connected === 'boolean') c.connected = patch.connected;
  persist(c);
  return publicConfig();
}

/* ---------- red ---------- */
function runtime() {
  const c = load();
  const p = PROVIDERS[c.provider] || PROVIDERS.ollama;
  return { c, p, base: c.baseUrl || p.base, key: decode(c.key) };
}

async function http(method, url, { headers = {}, body, timeout = 120000 } = {}) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no JSON */ }
  if (!res.ok) {
    const detail = (json && (json.error?.message || json.error || json.message)) || text.slice(0, 200);
    const err = new Error(`HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function friendly(e, p, model) {
  if (e.status === 404 && model && /model/i.test(e.message)) {
    return `El modelo «${model}» no está disponible en ${p.label}. Elige uno de la lista en Ajustes → Inteligencia artificial` +
      (p.kind === 'ollama' ? ` o instálalo con «ollama pull ${model}».` : '.');
  }
  const code = e.cause && e.cause.code;
  if (code === 'ECONNREFUSED') return `No se pudo conectar. ¿Está ${p.label} en ejecución y la URL es correcta?`;
  if (code === 'ENOTFOUND') return 'No se encontró el servidor (revisa la URL y tu conexión a internet).';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'Tiempo de espera agotado.';
  if (e.status === 401 || e.status === 403) return 'La clave de API no es válida o no tiene permisos.';
  if (e.status === 404) return 'Ruta no encontrada: revisa la URL base.';
  if (e.code === 'ENOENT') return `No se encontró el comando «${p.bin}». Instálalo e inicia sesión.`;
  return e.message;
}

const execP = (bin, args, timeout) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 4e6, shell: false }, (err, stdout, stderr) => {
    if (err) { err.message = (stderr || err.message).toString().slice(0, 300); reject(err); } else resolve(stdout.toString());
  });
});

const authHeaders = (p, key) => (p.kind === 'anthropic'
  ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  : key ? { Authorization: `Bearer ${key}` } : {});

async function listModels() {
  const { p, base, key } = runtime();
  if (p.kind === 'ollama') {
    const j = await http('GET', `${base}/api/tags`, { timeout: 5000 });
    return (j.models || []).map((m) => m.name);
  }
  if (p.kind === 'anthropic') {
    const j = await http('GET', `${base}/v1/models?limit=100`, { headers: authHeaders(p, key), timeout: 10000 });
    return (j.data || []).map((m) => m.id);
  }
  const j = await http('GET', `${base}/models`, { headers: authHeaders(p, key), timeout: 10000 });
  return (j.data || []).map((m) => (m.id || '').replace(/^models\//, ''));
}

async function test() {
  const { p, key } = runtime();
  const t0 = Date.now();
  try {
    if (p.kind === 'cli') {
      const out = await execP(p.bin, ['--version'], 8000);
      return { ok: true, message: `CLI disponible (${out.trim().split('\n')[0]})`, models: [], ms: Date.now() - t0 };
    }
    if (p.key && !key) return { ok: false, message: 'Falta la clave de API.', models: [] };
    const models = await listModels();
    return { ok: true, message: `Conexión correcta · ${models.length} modelo(s) disponible(s)`, models, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: friendly(e, p), models: [] };
  }
}

async function recommend() {
  const { c, p } = runtime();
  const ramGB = Math.round(os.totalmem() / 1073741824);
  let items;
  let installed = [];
  if (p.kind === 'ollama') {
    items = ollamaTiers(ramGB);
    try { installed = await listModels(); } catch { /* sin conexión */ }
  } else {
    items = RECOMMENDED[c.provider] || [];
  }
  return {
    ramGB,
    local: p.group === 'local',
    installed,
    items: items.map(([model, note]) => ({ model, note, installed: installed.includes(model) })),
    pullHint: p.kind === 'ollama' ? 'ollama pull <modelo>' : null,
    note: p.kind === 'cli' ? 'Esta opción usa el modelo que tengas configurado en la propia CLI.' : null
  };
}

const SYSTEM = 'Eres un asistente para desarrolladores web integrado en una herramienta de vista previa. ' +
  'Responde en español, de forma breve y concreta, con la causa probable y los pasos para corregirlo; incluye código solo si ayuda.';

async function ask(prompt) {
  const { c, p, base, key } = runtime();
  try {
    if (p.kind === 'cli') return { ok: true, text: (await execP(p.bin, p.args(`${SYSTEM}\n\n${prompt}`), 180000)).trim() };
    if (!c.model) return { ok: false, text: 'Elige un modelo en Ajustes → Inteligencia artificial.' };
    let text;
    if (p.kind === 'ollama') {
      const j = await http('POST', `${base}/api/chat`, { body: { model: c.model, stream: false, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] } });
      text = j.message && j.message.content;
    } else if (p.kind === 'anthropic') {
      const j = await http('POST', `${base}/v1/messages`, { headers: authHeaders(p, key), body: { model: c.model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content: prompt }] } });
      text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    } else {
      const j = await http('POST', `${base}/chat/completions`, { headers: authHeaders(p, key), body: { model: c.model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] } });
      text = j.choices && j.choices[0] && j.choices[0].message.content;
    }
    return { ok: true, text: (text || '(respuesta vacía)').trim() };
  } catch (e) {
    return { ok: false, text: friendly(e, p, c.model) };
  }
}

module.exports = { publicConfig, save, test, recommend, ask };
