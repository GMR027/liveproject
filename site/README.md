# Web de LiveProject

Sitio estático (HTML, CSS y un poco de JS, sin dependencias ni paso de build).

    node serve.js                      # http://localhost:5173
    docker build -t liveproject-site . # imagen nginx (puerto 8080, usuario no root)

- `/healthz` responde `ok` para las sondas del cluster.
- Las capturas de `assets/` son de la app real; para actualizarlas, vuelve a capturarlas y conviértelas a WebP.
- La comparativa de `index.html` se basa en la documentación pública de cada herramienta (octubre de 2026). Revísala antes de cada publicación.
