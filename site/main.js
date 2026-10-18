document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = btn.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copiado';
    } catch {
      btn.textContent = 'Selecciona y copia';
    }
    setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
  });
});

// Rellena versión, tamaño y huella del paquete a partir de downloads/latest.json (si existe).
fetch('downloads/latest.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((d) => {
    const mb = (d.size / 1048576).toFixed(0);
    document.getElementById('dl-meta').textContent = `Versión ${d.version} · amd64 · ${mb} MB`;
    document.getElementById('dl-btn').textContent = `Descargar .deb (${d.version})`;
    document.getElementById('dl-sha').textContent = `SHA-256: ${d.sha256}`;
  })
  .catch(() => {});
