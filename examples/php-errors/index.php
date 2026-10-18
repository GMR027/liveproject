<?php
// Ejemplo con errores a propósito para probar el panel «Mensajes».
ini_set('display_errors', '1');
error_reporting(E_ALL);
echo "<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Errores</title></head><body>";
echo "<h1>Página con errores</h1><img src='x.png'><input type='text'><div style='width:900px;background:#eee'>ancho fijo</div>";
echo $variable_inexistente;
trigger_error('Función obsoleta de prueba', E_USER_DEPRECATED);
echo "<script>console.error('Fallo de JavaScript de prueba'); console.warn('Aviso JS de prueba');</script></body></html>";
