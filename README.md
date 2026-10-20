# LiveProject

Vista previa en vivo multi-dispositivo para proyectos con **cualquier backend** (PHP, Laravel, Django, Flask, Node, Ruby, Go, estático…).
La app vigila los archivos y recarga las vistas al guardar; sincroniza scroll/clics y captura pantallas.

## App (Electron)
    cd app && npm install
    npm start -- /ruta/al/proyecto        # o: ./app/bin/liveproject.js .

El servidor se detecta solo (`php -S`, artisan, manage.py, flask, `npm run dev`…). Para personalizarlo, crea `.liveproject.json`
en el proyecto:

    { "command": "python3 -m http.server {port}", "port": 8000, "url": "http://localhost:8080",
      "path": "/", "ignore": ["logs"], "delay": 0 }

`url` = usar un servidor ya existente (XAMPP, Docker…) sin lanzar proceso. Placeholders: `{port}`, `{root}`.
Capturas, sesiones e informes en `<proyecto>/.liveproject/` (añádelo a tu `.gitignore`).

## Paneles
- **Inspector inteligente** (abajo): árbol del DOM con barras de tamaño (rojo = desborda el viewport), modelo de caja, estilos,
  resumen, problemas de accesibilidad/responsive/contraste, paleta y encabezados. Pasa el ratón por un elemento para resaltarlo en la página.
- **DevTools**: las DevTools reales de Chromium (Elements, Console, Sources, Network…) del dispositivo elegido.
- **Panel lateral** (pestañas, ancho ajustable):
  - **Mensajes**: errores/avisos de PHP, Python, Node, Ruby, Go, Java, C#, SQL, HTTP y JavaScript del navegador, con etiqueta de lenguaje
    y color por gravedad. Detecta los de la salida del servidor y los impresos en la propia página.
  - **Red**: todas las peticiones de cada vista (método, estado, tipo, tamaño, tiempo, cabeceras clave). Filtros por tipo/URL y «solo fallos»;
    los 4xx/5xx y fallos de red también se añaden a *Mensajes*.
  - **Enlaces**: comprueba enlaces, imágenes, scripts, estilos, iframes y medios (HEAD/GET), anclajes `#id` inexistentes, contenido mixto y redirecciones.
  - **Rutas**: lista las rutas del proyecto (`/login`, `/admin`…) para abrirlas con un clic en las vistas: las busca en el código (Laravel, Symfony, Django, Flask/FastAPI, Express, NestJS, Rails, Gin/Echo, Spring, ASP.NET, Next, Nuxt, React/Vue Router, SvelteKit, Astro y páginas PHP/HTML),
    en los enlaces de las páginas cargadas y en las rutas ya visitadas. `✔` comprueba cada una con HTTP y muestra su estado; Shift+clic abre la ruta solo en la vista seleccionada.
  - **Historial**: cada sesión se guarda sola en `<proyecto>/.liveproject/sessions/<fecha>.json` (últimas 50). Puedes reabrirlas o borrarlas.
- **CSS responsive** (panel inferior): linter que analiza cada dispositivo activo con su viewport real (desbordes, anchos fijos, objetivos táctiles,
  tipografía, imágenes, `100vh`, media queries…), resalta los elementos en la página y propone correcciones; con IA conectada, «Corregir con IA» y «Revisión con IA».
- **📄 Informe**: exporta HTML y Markdown a `<proyecto>/.liveproject/reports/` (errores, red, enlaces, CSS responsive y rendimiento).
- **📡 Red local**: proxy en el puerto 4777 (o libre) para abrir el proyecto en un móvil real, tableta u otro equipo de la misma red (URL + QR).
  Recarga solos al guardar, funciona con HMR/WebSocket y sus errores de JavaScript llegan al panel *Mensajes*. Mientras está activo, cualquier equipo
  de la red puede ver el proyecto; si no conecta, abre el puerto en el cortafuegos.
- **Interfaz**: menús *Vista* y *Herramientas*, barras de dispositivos y rendimiento plegables, y botón **⟲ Girar** en cada teléfono/tableta (o *Vista → Girar móviles y tabletas*) para ver el modo horizontal.
- **Ajustes**: **Manual de usuario** integrado (pestaña 📖 Manual, también en el botón *Ayuda*), dispositivos personalizados (presets 2026 incluidos) y conexión de IA (Ollama/LM Studio locales, API de Anthropic/OpenAI/Gemini
  o CLI de suscripción: Claude Code, Codex, Gemini CLI) con comprobación y modelos recomendados.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
