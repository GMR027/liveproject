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
