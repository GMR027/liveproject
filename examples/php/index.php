<?php $now = date('H:i:s'); ?>
<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="style.css"><title>Demo PHP</title></head>
<body><h1>Hola desde PHP <?= PHP_VERSION ?></h1><p>Generado a las <?= $now ?></p>
<?php for ($i = 1; $i <= 40; $i++): ?><p>Línea de relleno <?= $i ?> para probar el scroll sincronizado.</p><?php endfor; ?>
<button onclick="this.textContent='¡clic!'">Probar clic</button></body></html>
