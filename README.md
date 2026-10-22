# LiveProject

Vista previa en vivo multi-dispositivo para proyectos con **cualquier backend** (PHP, Laravel, Django, Flask, Node, Ruby, Go, estático…).
La app vigila los archivos y recarga las vistas al guardar; sincroniza scroll/clics y captura pantallas.

## App (Electron)
    cd app && npm install
    npm start -- /ruta/al/proyecto        # o: ./app/bin/liveproject.js .

El servidor se detecta solo (`php -S`, artisan, manage.py, flask, `npm run dev`…). Para personalizarlo, crea `.liveproject.json`
en el proyecto:

    { "command": "python3 -m http.server {port}", "port": 8000, "url": "https://mi-sitio.com",
      "path": "/programa?proyecto=10", "ignore": ["logs"], "delay": 0 }

`url` = usar un servidor ya existente (XAMPP, Docker…) o una web publicada, sin lanzar proceso. Acepta el host o una página completa con su ruta y parámetros (`"url": "https://mi-sitio.com/programa?proyecto=10"`); si no se indica `path`, se usa la ruta de la URL. Placeholders: `{port}`, `{root}`.

También puedes escribir o pegar cualquier dirección en la barra superior y pulsar **Enter** para abrirla en todas las vistas, sin editar el proyecto.

Capturas, sesiones e informes en `<proyecto>/.liveproject/` (añádelo a tu `.gitignore`).

## Paneles
- **Espejo entre vistas** (por defecto): el scroll, los clics y lo que se escribe en un formulario se replican al instante en
  todas las vistas; si una navega (enlace, envío de formulario o redirección), las demás siguen su misma ruta; y la sesión
  (cookies y `sessionStorage`) es común, así que un formulario de acceso se ve igual en todas: si inicias sesión en una,
  han iniciado sesión todas. Se desactiva con *Vista → Sincronizar scroll, clics, formularios y navegación*.
- **Inspector inteligente** (abajo): árbol del DOM con barras de tamaño (rojo = desborda el viewport), modelo de caja, estilos,
  resumen, problemas de accesibilidad/responsive/contraste, paleta y encabezados. Pasa el ratón por un elemento para resaltarlo en la página.
- **DevTools**: las DevTools reales de Chromium (Elements, Console, Sources, Network…) del dispositivo elegido, ampliables a pantalla completa.
- **Emulación por dispositivo** (botón 🌐 en el título de cada vista): red (3G / 4G / sin conexión), CPU ×4 o ×6 y preferencias del sistema
  (tema claro/oscuro, movimiento reducido, colores forzados) aplicadas solo a esa vista, con el protocolo de DevTools.
- **Servidor**: salida del proceso en vivo, con filtro, desplazamiento automático y envío de texto al servidor (stdin) para responder a sus preguntas.
- **Almacenamiento** (💾): cookies, `localStorage` y `sessionStorage` de la vista elegida, con borrado individual o total.
- **Auditoría** (📋): SEO (título, meta descripción, viewport, `lang`, canonical, Open Graph, favicon, `robots.txt`, `sitemap.xml`), accesibilidad
  (encabezados, `alt`, nombres accesibles, etiquetas de formulario) y comparación entre dos dispositivos (qué media queries cambian con cada ancho).
- **Panel lateral** (pestañas, ancho ajustable):
  - **Mensajes**: errores/avisos de PHP, Python, Node, Ruby, Go, Java, C#, SQL, HTTP y JavaScript del navegador, con etiqueta de lenguaje
    y color por gravedad. Detecta los de la salida del servidor y los impresos en la propia página (opcionalmente también los `console.log`).
  - **Red**: todas las peticiones de cada vista (método, estado, tipo, tamaño, tiempo, cabeceras clave). Filtros por tipo/URL y «solo fallos»;
    los 4xx/5xx y fallos de red también se añaden a *Mensajes*. Vista de **cascada** (waterfall) y **exportación a HAR** (`.liveproject/reports/`).
  - **Enlaces**: comprueba enlaces, imágenes, scripts, estilos, iframes y medios (HEAD/GET), anclajes `#id` inexistentes, contenido mixto y redirecciones.
  - **Rutas**: lista las rutas del proyecto (`/login`, `/admin`…) para abrirlas con un clic en las vistas: las busca en el código (Laravel, Symfony, Django, Flask/FastAPI, Express, NestJS, Rails, Gin/Echo, Spring, ASP.NET, Next, Nuxt, React/Vue Router, SvelteKit, Astro y páginas PHP/HTML),
    en los enlaces de las páginas cargadas y en las rutas ya visitadas. `✔` comprueba cada una con HTTP y muestra su estado; Shift+clic abre la ruta solo en la vista seleccionada.
    Pulsando el nombre del fichero se abre en tu editor de código (VS Code, VSCodium, Sublime, Zed…) en la línea exacta, y `📱` muestra su código QR para el móvil.
  - **Historial**: cada sesión se guarda sola en `<proyecto>/.liveproject/sessions/<fecha>.json` (últimas 50). Puedes reabrirlas o borrarlas.
  - **Herramientas**: las mismas herramientas del panel inferior (Inspector inteligente, DevTools, CSS responsive, Servidor, Almacenamiento y Auditoría)
    trasladadas aquí con el botón **⇱ Derecha** para liberar espacio vertical. Con **⇲ Abajo** (o con la pestaña 🔧 Herramientas) vuelven al panel inferior; la posición se recuerda.
- **Comparar capturas**: `🧰 Herramientas → 🔍 Comparar capturas` contrasta la captura actual con la anterior y guarda la imagen de
  diferencias en `.liveproject/screenshots/` (la primera vez fija la base).
- **CSS responsive** (panel inferior): linter que analiza cada dispositivo activo con su viewport real (desbordes, anchos fijos, objetivos táctiles,
  tipografía, imágenes, `100vh`, media queries…), resalta los elementos en la página y propone correcciones; con IA conectada, «Corregir con IA» y «Revisión con IA».
- **📄 Informe**: exporta HTML y Markdown a `<proyecto>/.liveproject/reports/` (errores, red, enlaces, CSS responsive y rendimiento).
- **📡 Red local**: proxy en el puerto 4777 (o libre) para abrir el proyecto en un móvil real, tableta u otro equipo de la misma red (URL + QR).
  Recarga solos al guardar, funciona con HMR/WebSocket y sus errores de JavaScript llegan al panel *Mensajes*. Mientras está activo, cualquier equipo
  de la red puede ver el proyecto; si no conecta, abre el puerto en el cortafuegos.
  Con la red local activa, el móvil es **otro espejo** de la plataforma: comparte la sesión (las cookies de las vistas se inyectan en sus
  peticiones y las suyas se copian a las vistas), sigue la misma ruta y replica al instante lo que se escribe o se pulsa en cualquiera de los dos lados.
- **Interfaz**: menús *Vista* y *Herramientas*, barras de dispositivos y rendimiento plegables, botón **⟲ Girar** en cada teléfono/tableta (o *Vista → Girar móviles y tabletas*) para ver el modo horizontal,
  paleta de comandos **Ctrl/⌘+K** con atajos (Ctrl+R recargar, Ctrl+B panel inferior, Ctrl+Shift+D mover herramientas, F12 DevTools, Ctrl+1…6 paneles),
  historial de proyectos recientes (**🕘**) y plantillas de arranque del servidor en *Ajustes → Proyecto*.
- **Ajustes**: **Manual de usuario** integrado (pestaña 📖 Manual, también en el botón *Ayuda*), dispositivos personalizados (presets 2026 incluidos) y conexión de IA (Ollama/LM Studio locales, API de Anthropic/OpenAI/Gemini
  o CLI de suscripción: Claude Code, Codex, Gemini CLI) con comprobación y modelos recomendados.

## Pruebas

    cd app && npm test           # prueba de humo (carga la interfaz y comprueba lo esencial)
    cd app && npm run test:mirror  # prueba del espejo (sesión, formularios y navegación en las 3 vistas y en el túnel)

## Licencia

MIT. Consulta [LICENSE](LICENSE).
