# Web de LiveProject

Sitio estático (HTML, CSS y un poco de JS, sin dependencias ni paso de build).

    node serve.js                      # http://localhost:5173
    docker build -t liveproject-site . # imagen nginx (puerto 8080, usuario no root)

- `/healthz` responde `ok` para las sondas del cluster.
- Las capturas de `assets/` son de la app real; para actualizarlas, vuelve a capturarlas y conviértelas a WebP.
- La comparativa de `index.html` se basa en la documentación pública de cada herramienta (octubre de 2026). Revísala antes de cada publicación.

## Despliegue (Kubernetes + Helm)

- Dominio: `liveproject.iguzman.com.mx` · namespace `liveproject` · imagen `gmr27/liveproject-site` (Docker Hub).
- Chart en `helm/liveproject-site/` (Deployment de 2 réplicas sin root y con sistema de archivos de solo lectura, Service, Ingress `nginx` con certificado de Let's Encrypt y PodDisruptionBudget).

      ./deploy.sh              # construye, sube la imagen y actualiza el release
      DRY_RUN=1 ./deploy.sh    # construye y valida sin subir ni desplegar

  Cada despliegue usa una etiqueta única (`fecha-hora-commit`) y `--atomic`: si falla, Helm vuelve a la versión anterior.
  Variables opcionales: `NAMESPACE`, `RELEASE`, `IMAGE`, `TAG`.
