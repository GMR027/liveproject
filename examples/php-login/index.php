<?php
// Formulario de sesión (login) para probar el espejo entre vistas y con el túnel.
session_start();
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $user = trim($_POST['usuario'] ?? '');
  $pass = (string)($_POST['clave'] ?? '');
  if ($user === 'admin' && $pass === '1234') {
    $_SESSION['usuario'] = $user;
    header('Location: dashboard.php');
    exit;
  }
  $error = 'Usuario o clave incorrectos.';
}
?><!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso</title><style>
body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#11131a;color:#e9ecf5}
form{background:#1b1e29;padding:24px;border-radius:14px;width:min(320px,86vw);box-shadow:0 12px 40px #0008}
h1{font-size:20px;margin:0 0 16px}
label{display:block;font-size:13px;color:#a9b0c6;margin:10px 0 4px}
input{width:100%;padding:9px;border-radius:8px;border:1px solid #333a4d;background:#0f1118;color:#e9ecf5;font-size:15px}
button{margin-top:16px;width:100%;padding:10px;border:0;border-radius:8px;background:#6c8cff;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
p.err{color:#ef6b6b;font-size:13px}
</style></head>
<body>
<form method="post" action="index.php" id="login">
  <h1>Iniciar sesión</h1>
  <?php if ($error) { ?><p class="err"><?= htmlspecialchars($error) ?></p><?php } ?>
  <label for="usuario">Usuario</label>
  <input id="usuario" name="usuario" type="text" autocomplete="username" value="<?= htmlspecialchars($_POST['usuario'] ?? '') ?>">
  <label for="clave">Clave</label>
  <input id="clave" name="clave" type="password" autocomplete="current-password">
  <button type="submit" id="entrar">Entrar</button>
</form>
</body></html>
