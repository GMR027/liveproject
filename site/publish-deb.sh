#!/usr/bin/env bash
# Construye el paquete .deb de la app y lo deja en site/downloads/ junto con latest.json y SHA256SUMS.
# Después, ./deploy.sh lo incluye en la imagen de la web. Uso: ./publish-deb.sh
set -euo pipefail
cd "$(dirname "$0")"
APP=../app

(cd "$APP" && npm run build:deb)

VERSION="$(node -p "require('$APP/package.json').version")"
SRC="$APP/dist/liveproject_${VERSION}_amd64.deb"
[[ -f "$SRC" ]] || { echo "No se generó $SRC" >&2; exit 1; }

mkdir -p downloads
cp "$SRC" "downloads/liveproject_${VERSION}_amd64.deb"
cp "$SRC" downloads/liveproject_amd64.deb          # alias estable: lo que enlaza la web
(cd downloads && sha256sum liveproject_*.deb > SHA256SUMS)

SHA="$(sha256sum "$SRC" | cut -d' ' -f1)"
SIZE="$(stat -c %s "$SRC")"
node -e "
const [v, sha, size] = process.argv.slice(1);
const base = 'https://liveproject.iguzman.com.mx/downloads';
require('fs').writeFileSync('downloads/latest.json', JSON.stringify({
  version: v, url: base + '/liveproject_' + v + '_amd64.deb', sha256: sha, size: Number(size),
  date: new Date().toISOString().slice(0, 10), notes: ''
}, null, 2) + '\n');
" "$VERSION" "$SHA" "$SIZE"

echo "✔ site/downloads: liveproject_${VERSION}_amd64.deb ($((SIZE / 1048576)) MB) · sha256 ${SHA:0:12}…"
echo "  Siguiente paso: ./deploy.sh"
