'use strict';
// Genera la plantilla de Excel para cargar el inventario inicial sin necesidad del servidor.
// Uso: node scripts/plantilla_inventario.js [archivo.xlsx]   (por defecto plantilla_inventario_inicial.xlsx en la raíz del proyecto)
// Dentro del sistema la plantilla se descarga ya con las categorías y proveedores de cada empresa (Productos › Inventario inicial).
const fs = require('node:fs');
const path = require('node:path');
const { plantilla } = require('../inv_excel');
const salida = process.argv[2] || path.join(__dirname, '..', 'plantilla_inventario_inicial.xlsx');
fs.writeFileSync(salida, plantilla({ categorias: ['Harinas', 'Granos', 'Bebidas', 'Lácteos', 'Aseo personal', 'Limpieza'], proveedores: ['Distribuidora Central', 'Alimentos del Valle'] }));
console.log('Plantilla escrita en', salida);
