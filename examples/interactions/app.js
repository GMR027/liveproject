function toggleSaludo() {
  const card = document.getElementById('card');
  card.classList.toggle('saludo');
  card.textContent = card.classList.contains('saludo') ? 'Hola con saludo' : 'Hola';
}

function changeText() {
  const card = document.getElementById('card');
  card.textContent = `Texto cambiado ${new Date().toLocaleTimeString()}`;
}

function notify() {
  const card = document.getElementById('card');
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = 'Aviso creado por una interacción';
  card.after(toast);
  setTimeout(() => toast.remove(), 2000);
}

document.getElementById('toggle').addEventListener('click', toggleSaludo);
document.getElementById('change-text').addEventListener('click', changeText);
document.getElementById('notify').addEventListener('click', notify);

//# sourceMappingURL=app.js.map
