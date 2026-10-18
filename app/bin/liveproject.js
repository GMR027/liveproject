#!/usr/bin/env node
// Uso: liveproject [carpeta]   (por defecto, la carpeta actual)
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');
const folder = path.resolve(process.argv[2] || '.');
const child = spawn(electron, [path.join(__dirname, '..'), folder], { detached: true, stdio: 'ignore' });
child.unref();
