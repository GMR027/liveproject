<?php
// Página protegida: solo se ve con la sesión iniciada.
session_start();
if (empty($_SESSION['usuario'])) {
  header('Location: index.php');
  exit;
}
?><!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Panel</title><style>
body{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#0f1118;color:#e9ecf5}
h1{font-size:22px}
a{color:#6c8cff}
</style></head>
<body>
<h1>Sesión iniciada como <?= htmlspecialchars($_SESSION['usuario']) ?></h1>
<p>Esta página solo aparece si la sesión está iniciada.</p>
<p><a href="logout.php">Cerrar sesión</a></p>
</body></html>
