// ── Panel «Rutas» (proceso principal) ────────────────────────────────────────
// Descubre las rutas disponibles del proyecto combinando tres fuentes:
//   · código      → definiciones de enrutadores (Laravel, Symfony, Django, Flask/FastAPI,
//                   Express, NestJS, Rails, Gin/Echo, Spring, ASP.NET, Next, Nuxt,
//                   React/Vue Router, SvelteKit, Astro…)
//   · plantillas  → enlaces href/to/action de HTML, Blade, Twig, Vue, JSX, ERB…
//   · archivos    → páginas del sistema de archivos (PHP/HTML multipágina y routers por convención)
const fs = require('fs');
const path = require('path');

const JS_EXT = ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'];
const PHP_EXT = ['.php', '.blade.php'];
const TPL_EXT = ['.html', '.htm', '.twig', '.vue', '.jsx', '.tsx', '.svelte', '.ejs', '.hbs',
  '.handlebars', '.erb', '.pug', '.jade', '.njk', '.liquid', '.astro', '.php', '.blade.php'];
const PAGE_EXT = ['.html', '.htm', '.php', '.blade.php'];

// Rutas que apuntan a recursos estáticos: no son páginas navegables.
const ASSET_RE = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|css|js|mjs|cjs|json|xml|map|txt|md|woff2?|ttf|otf|eot|mp4|webm|ogv|mp3|wav|ogg|pdf|zip|gz|tar|csv|xlsx?|docx?|sql|db|sqlite3?|lock)$/i;
// Ficheros que no hace falta leer para buscar rutas.
const SKIP_FILE_RE = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|css|map|woff2?|ttf|otf|eot|mp4|webm|ogv|mp3|wav|ogg|pdf|zip|gz|tar|exe|dll|so|dylib|db|sqlite3?|lock|sum|class|jar|wasm|iso|tgz|rar|7z|bin|dat|tmp|bak|swp|orig)$/i;

const MAX_FILES = 3000;          // techo de ficheros recorridos
const MAX_BYTES = 1200 * 1024;   // ficheros más grandes que esto suelen ser bundles
const DEFAULT_SKIP = [
  'node_modules', '.git', 'vendor', 'storage', '__pycache__', 'venv', '.venv', '.liveproject',
  '.idea', '.vscode', 'dist', 'build', '.cache', '.next', '.nuxt', '.output', '.svelte-kit',
  '.turbo', 'coverage', 'target', 'tmp', 'temp', 'bower_components', '.sass-cache', '.pytest_cache', 'migrations'
];

// Comillas simples, dobles y acento grave (comillas de plantillas de JS).
const Q = `['"\\x60]`;
const NQ = `[^'"\\x60\\n\\r]`;

// Cada patrón debe tener UN SOLO grupo de captura (la ruta). Al unirlos, la ruta del
// patrón i-ésimo queda siempre en el grupo i+1 del resultado.
const PATTERNS = [
  // ── PHP: Laravel ──
  { label: 'Laravel', ext: PHP_EXT, re: `Route\\s*::\\s*(?:get|post|put|patch|delete|any|fallback|resource|apiResource)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },
  // ── PHP: Symfony (atributo y anotación) ──
  { label: 'Symfony', ext: PHP_EXT, re: `#\\[\\s*Route\\s*\\(\\s*${Q}(${NQ}*)${Q}` },
  { label: 'Symfony', ext: PHP_EXT, re: `@(?:Route|Get|Post|Put|Patch|Delete)\\s*\\(\\s*${Q}(${NQ}*)${Q}` },
  // ── PHP: Slim y routers encadenados ($router->get('/x')) ──
  { label: 'PHP', ext: PHP_EXT, abs: true, re: `->\\s*(?:get|post|put|patch|delete|any|options)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },
  // ── PHP: funciones de plantilla (url(), site_url()…) ──
  { label: 'Plantilla', ext: PHP_EXT, re: `\\b(?:url|site_url|base_url)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },

  // ── Python: Flask / FastAPI ──
  { label: 'Python', ext: ['.py'], abs: true, re: `@[\\w.]*\\s*\\b(?:route|get|post|put|patch|delete)\\s*\\(\\s*${Q}(${NQ}*)${Q}` },
  // ── Python: add_url_rule() y redirecciones ──
  { label: 'Python', ext: ['.py'], abs: true, re: `\\b(?:add_url_rule|redirect|RedirectResponse)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },
  // ── Python: Django (solo en los ficheros de URL) ──
  { label: 'Django', ext: ['.py'], file: /urls?\.py$/i, re: `\\b(?:path|re_path|url)\\s*\\(\\s*r?${Q}(${NQ}*)${Q}` },

  // ── Ruby: Rails / Sinatra ──
  { label: 'Rails', ext: ['.rb', '.ru', '.rake'], abs: true, re: `\\b(?:get|post|put|patch|delete|match|root)\\s+${Q}(${NQ}+)${Q}` },
  { label: 'Rails', ext: ['.rb', '.ru', '.rake'], re: `\\b(?:resources|resource|namespace)\\s+:(\\w+)` },

  // ── Go: Gin, Echo, Chi, net/http ──
  { label: 'Go', ext: ['.go'], abs: true, re: `\\.(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Handle|HandleFunc|Any|Group)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },

  // ── Java / Kotlin: Spring ──
  { label: 'Spring', ext: ['.java', '.kt'], abs: true, re: `@(?:RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\\s*\\(\\s*(?:(?:value|path)\\s*=\\s*)?${Q}(${NQ}+)${Q}` },

  // ── C#: ASP.NET Core ──
  { label: 'ASP.NET', ext: ['.cs'], abs: true, re: `\\b(?:MapGet|MapPost|MapPut|MapDelete|MapPatch|MapFallback|Map)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },
  { label: 'ASP.NET', ext: ['.cs'], abs: true, re: `\\[(?:HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|Route)\\s*\\(\\s*${Q}(${NQ}*)${Q}` },

  // ── JavaScript / TypeScript: Express, Fastify, Koa… ──
  { label: 'Node/Express', ext: JS_EXT, abs: true, re: `\\b(?:app|router|server|api|fastify|koa|instance)\\s*\\.\\s*(?:get|post|put|patch|delete|all|use|options|head)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },
  // ── JavaScript / TypeScript: NestJS ──
  { label: 'NestJS', ext: JS_EXT, re: `@(?:Get|Post|Put|Patch|Delete|All|Options|Head|Controller)\\s*\\(\\s*${Q}(${NQ}*)${Q}` },
  // ── React Router / Vue Router (solo en ficheros que definen un router) ──
  { label: 'Router', ext: JS_EXT, gate: /createRouter|createHashRouter|createBrowserRouter|VueRouter|vue-router|useRoutes|<Routes?[\s>]/, re: `\\bpath\\s*[:=]\\s*${Q}(${NQ}+)${Q}` },
  // ── JavaScript: llamadas de navegación de una SPA ──
  { label: 'JavaScript', ext: JS_EXT, abs: true, re: `\\b(?:navigate|push|replace|redirect|goTo|jumpTo)\\s*\\(\\s*${Q}(${NQ}+)${Q}` },

  // ── Plantillas y vistas: enlaces, <Link to>, formularios ──
  { label: 'Plantilla', ext: TPL_EXT, re: `\\b(?:href|to|action|formaction)\\s*=\\s*${Q}(${NQ}+)${Q}` },
  { label: 'Plantilla', ext: TPL_EXT, re: `\\b(?:url|asset_url)\\s*\\(\\s*${Q}(${NQ}+)${Q}` }
];

// Carpetas que suelen contener piezas de plantilla, no páginas navegables.
const NO_PAGE_DIRS = new Set([
  'includes', 'include', 'inc', 'lib', 'libs', 'classes', 'class', 'config', 'configs', 'conf',
  'templates', 'template', 'partials', 'partial', 'views', 'view', 'components', 'component',
  'layouts', 'layout', 'fragments', 'mail', 'emails', 'vendor', 'src', 'app', 'helpers', 'traits',
  'models', 'controllers', 'middleware', 'modules', 'plugins', 'addons', 'themes', 'widgets',
  'blocks', 'snippets', 'macros', 'elements', 'tags', 'tests', 'test', 'docs',
  'routes', 'route', 'api', 'actions', 'handlers', 'providers', 'database', 'seeders', 'console',
  'jobs', 'events', 'listeners', 'policies', 'commands', 'services', 'repositories', 'entities'
]);
// Carpetas que hacen de raíz web al servir el proyecto.
const WEB_ROOTS = ['public', 'www', 'htdocs', 'html', 'webroot', 'web', 'static', 'dist', 'build', 'site'];

const extOf = (file) => {
  const n = file.toLowerCase();
  return n.endsWith('.blade.php') ? '.blade.php' : path.extname(n);
};

// ── recorrido de carpetas ─────────────────────────────────────────────────────
function listFiles(root, skip, limit) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (skip.has(e.name.toLowerCase())) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile()) out.push(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

// ── limpieza y validación de una ruta candidata ───────────────────────────────
function cleanRoute(raw, abs) {
  if (raw == null) return null;
  let r = String(raw).trim();
  if (r.length > 400) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(r)) return null;   // esquema, //host, #ancla o ?query
  // Parámetros de todos los marcos → :id ({id}, {lang?}, <int:id>, [id])
  r = r.replace(/\{([^{}]*)\}/g, (_s, p) => `:${p.replace(/[?*!].*$/, '')}`);
  r = r.replace(/<([^<>]+)>/g, (_s, p) => `:${p.split(':').pop().replace(/[^\w-]/g, '')}`);
  r = r.split('#')[0].split('?')[0].trim();
  if (!r) return '/';                                              // cadena vacía = raíz del enrutador
  if (abs && !r.startsWith('/')) return null;
  if (/[\s{}<>|\\^$()'"`*\[\]]/.test(r)) return null;              // regex, comodines o plantillas sin resolver
  if (/%[sd]|%%|%\(/.test(r)) return null;
  if (!r.startsWith('/')) r = `/${r}`;
  r = r.replace(/\/{2,}/g, '/');
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  if (r.length > 200 || ASSET_RE.test(r)) return null;
  const segs = r.split('/').slice(1);
  if (!segs.length || segs.length > 25) return null;
  if (segs.some((s) => !s || s.startsWith('.') || s.startsWith('_'))) return null;
  if (/^(?:undefined|NaN|null)$/i.test(r.slice(1))) return null;
  return r;
}

// ── rutas por sistema de archivos ─────────────────────────────────────────────
// Convierte una carpeta de «páginas» en ruta: /blog/[id]/index → /blog/:id
function fsPath(dir) {
  const segs = [];
  for (const s of dir.split('/').filter(Boolean)) {
    if (/^\(.+\)$/.test(s)) continue;                              // grupo de Next/SvelteKit, no segmento
    if (/^\[\[?\.\.\..+\]\]$/.test(s)) return null;                 // catch-all: no se puede abrir tal cual
    if (/^\[.+\]$/.test(s)) segs.push(`:${s.slice(1, -1).replace(/^\.{3}/, '')}`);
    else segs.push(s);
  }
  let r = `/${segs.join('/')}`;
  if (/\/index$/.test(r)) r = r.slice(0, -'/index'.length);
  return r === '' ? '/' : r;
}

function pageFileRoute(rel, ext) {
  const segs = rel.split(path.sep).join('/').split('/');
  const name = segs.pop();
  if (name.startsWith('_')) return null;
  const i = segs.findIndex((s) => WEB_ROOTS.includes(s.toLowerCase()));
  const sub = i >= 0 ? segs.slice(i + 1) : segs;                   // lo que hay dentro de la raíz web
  const maxDepth = ext === '.html' || ext === '.htm' ? 2 : 1;
  if (sub.length > maxDepth) return null;
  if (sub.some((s) => NO_PAGE_DIRS.has(s.toLowerCase()) || s.startsWith('_'))) return null;
  const isIndex = /^index\.(?:html?|php)$/i.test(name);
  const route = `/${(isIndex ? sub : [...sub, name]).join('/')}`;
  return route.length > 1 ? route.replace(/\/+$/, '') : '/';
}

function fsRoutes(rel, ext, fw) {
  const p = rel.split(path.sep).join('/');
  const out = [];
  let m;
  const add = (dir, label) => { const r = fsPath(dir); if (r) out.push({ route: r, label }); };

  // Next.js: app/router y pages/router
  if ((m = p.match(/(?:^|\/)app\/(.+?)\/(?:page|route)\.[jt]sx?$/))) add(m[1], /\/route\.[jt]sx?$/.test(m[0]) ? 'Next API' : 'Next');
  else if (/(?:^|\/)app\/(?:page|route)\.[jt]sx?$/.test(p)) add('', 'Next');
  if (fw.next && (m = p.match(/(?:^|\/)pages\/(.+?)\.(?:jsx?|tsx?|mjs)$/))) add(m[1], 'Next');
  // Nuxt
  if (fw.nuxt && (m = p.match(/(?:^|\/)pages\/(.+?)\.vue$/))) add(m[1], 'Nuxt');
  // Astro
  if (ext === '.astro' && (m = p.match(/(?:^|\/)pages\/(.+?)\.astro$/))) add(m[1], 'Astro');
  // SvelteKit
  if (fw.svelte) {
    if ((m = p.match(/(?:^|\/)routes\/(.+?)\/\+page\.(?:svelte|js|ts)$/))) add(m[1], 'SvelteKit');
    else if (/(?:^|\/)routes\/\+page\.(?:svelte|js|ts)$/.test(p)) add('', 'SvelteKit');
  }
  // Páginas sueltas: PHP y HTML multipágina
  if (PAGE_EXT.includes(ext)) {
    const r = pageFileRoute(rel, ext);
    if (r) out.push({ route: r, label: ext === '.html' || ext === '.htm' ? 'Estático' : 'PHP' });
  }
  return out;
}

// ── extracción de rutas del código ────────────────────────────────────────────
// Cada patrón se envuelve al unirlos: el grupo 2·i+2 de la alternativa i-ésima
// es la ruta capturada por ese patrón.
const capturesOf = (src) => {
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '(' && src[i + 1] !== '?') n++;
  }
  return n;
};
const VALID = PATTERNS.filter((p) => capturesOf(p.re) === 1);

function extract(rel, ext, text, cache) {
  const applicable = VALID.filter((p) =>
    (!p.ext || p.ext.includes(ext)) && (!p.file || p.file.test(rel)) && (!p.gate || p.gate.test(text)));
  if (!applicable.length) return [];
  const key = applicable.map((p) => VALID.indexOf(p)).join(',');
  let re = cache.get(key);
  if (!re) {
    try { re = new RegExp(applicable.map((p) => `(${p.re})`).join('|'), 'g'); } catch { return []; }
    cache.set(key, re);
  }
  const out = [];
  let line = 1, pos = 0, m, hits = 0;
  while ((m = re.exec(text)) && hits < 300) {
    for (let i = pos; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
    pos = m.index;
    for (let i = 0; i < applicable.length; i++) {
      const raw = m[2 * i + 2];   // 2·i = grupo envolvente, 2·i+1 = envoltura, 2·i+2 = ruta
      if (raw !== undefined) {
        out.push({ raw, label: applicable[i].label, abs: !!applicable[i].abs, line });
        break;
      }
    }
    if (m.index === re.lastIndex) re.lastIndex++;
    hits++;
  }
  return out;
}

// ── punto de entrada ──────────────────────────────────────────────────────────
function scanRoutes(root, ignore) {
  const t0 = Date.now();
  if (!root || !fs.existsSync(root)) return { routes: [], files: 0, total: 0, ms: 0 };
  const skip = new Set([...(ignore || []), ...DEFAULT_SKIP].map((s) => String(s).toLowerCase()));
  const files = listFiles(root, skip, MAX_FILES);
  const names = files.map((f) => path.basename(f));
  const fw = {
    next: names.some((n) => /^next\.config\.(?:js|mjs|cjs|ts)$/.test(n)),
    nuxt: names.some((n) => /^nuxt\.config\.(?:ts|js|mjs)$/.test(n)),
    svelte: names.some((n) => /^svelte\.config\.(?:js|ts)$/.test(n))
  };

  const map = new Map();
  const cache = new Map();
  const add = (route, label, rel, line) => {
    let it = map.get(route);
    if (!it) map.set(route, { path: route, label, file: rel, line: line || 0, param: /\/:[\w-]+/.test(route) });
    else if (!it.file && rel) { it.file = rel; it.line = line || 0; it.label = label; }
  };

  let scanned = 0;
  for (const full of files) {
    const rel = path.relative(root, full);
    const ext = extOf(full);
    for (const fr of fsRoutes(rel, ext, fw)) add(fr.route, fr.label, rel, 0);
    if (SKIP_FILE_RE.test(full) || /\.min\.(?:js|css)$/i.test(full) || rel.length > 260) continue;
    let size;
    try { size = fs.statSync(full).size; } catch { continue; }
    if (size < 1 || size > MAX_BYTES) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    scanned++;
    for (const hit of extract(rel, ext, text, cache)) {
      const route = cleanRoute(hit.raw, hit.abs);
      if (route) add(route, hit.label, rel, hit.line);
    }
  }

  const all = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { routes: all.slice(0, 1000), files: scanned, total: all.length, ms: Date.now() - t0 };
}

module.exports = { scanRoutes };
