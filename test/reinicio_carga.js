'use strict';
// Verifica el script que borra la carga de inventario inicial de una empresa (scripts/reiniciar_carga_inicial.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abasto-reinicio-'));
process.env.DATA_DIR = dir;
const assert = require('node:assert/strict');
const D = require('../db');
const L = require('../lib');

const SLUG = 'cliente-prueba';
D.conEmpresa(SLUG, () => { D.inicializar({ adminClave: 'x12345' }); });
const cuenta = () => D.conEmpresa(SLUG, () => ({
  prod: D.get('SELECT COUNT(*) AS n FROM productos').n, mov: D.get('SELECT COUNT(*) AS n FROM inventario_movimientos').n,
  barras: D.get('SELECT COUNT(*) AS n FROM codigos_barra').n, ventas: D.get('SELECT COUNT(*) AS n FROM ventas').n, seq: (D.get("SELECT valor FROM secuencias WHERE clave='producto'") || {}).valor
}));
let vendido;
D.conEmpresa(SLUG, () => {
  const cat = D.insert('INSERT INTO categorias(nombre) VALUES(?)', 'Harinas de prueba');
  const nuevo = (codigo, nombre, stock) => {
    const id = D.insert('INSERT INTO productos(codigo,nombre,categoria_id,costo_usd,precio_usd,creado) VALUES(?,?,?,?,?,?)', codigo, nombre, cat, 1, 2, D.ahora());
    D.run('INSERT INTO codigos_barra(codigo,producto_id,principal) VALUES(?,?,1)', 'B' + codigo, id);
    if (stock) L.mov(id, 'inventario_inicial', stock, 1, 'Inventario inicial (Excel)', 'producto', id, 'admin', null);
    return id;
  };
  nuevo('PROD-0001', 'Harina duplicada', 10); nuevo('PROD-0002', 'Harina duplicada', 10); nuevo('PROD-0003', 'Arroz', 5); nuevo('MANUAL', 'Sin existencia', 0);
  vendido = nuevo('PROD-0004', 'Azúcar vendida', 20);
  const v = D.insert("INSERT INTO ventas(numero,estado,subtotal_usd,total_usd,fecha) VALUES('V-1','completada',2,2,?)", D.ahora());
  D.run('INSERT INTO venta_detalles(venta_id,producto_id,cantidad,precio_usd) VALUES(?,?,1,2)', v, vendido);
  L.mov(vendido, 'venta', -1, 1, 'Venta V-1', 'venta', v, 'admin', null);
  D.run("UPDATE secuencias SET valor=4 WHERE clave='producto'") ; if (!D.get("SELECT 1 AS x FROM secuencias WHERE clave='producto'")) D.run("INSERT INTO secuencias(clave,valor) VALUES('producto',4)");
});
const script = path.join(__dirname, '..', 'scripts', 'reiniciar_carga_inicial.js');
const correr = (...a) => spawnSync(process.execPath, ['--no-warnings', script, SLUG, ...a], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });

const antes = cuenta();
assert.equal(antes.prod, 5);

// 1. simulacro: no cambia nada y avisa del producto con ventas
let r = correr();
assert.equal(r.status, 1, 'con un producto vendido el script se detiene');
assert.match(r.stdout, /Azúcar vendida/); assert.match(r.stdout, /venta_detalles/);
assert.deepEqual(cuenta(), antes, 'el simulacro no cambia nada');

// 2. aplicar sin confirmar el producto con actividad: sigue sin tocar
r = correr('--aplicar', '--si');
assert.equal(r.status, 1); assert.deepEqual(cuenta(), antes);

// 3. empresa inexistente
r = spawnSync(process.execPath, ['--no-warnings', script, 'no-existe'], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
assert.equal(r.status, 1); assert.match(r.stderr, /No existe la empresa/);
assert.ok(!fs.existsSync(path.join(dir, 'empresas', 'no-existe.db')), 'no crea bases vacías');

// 4. simulacro con --omitir-con-actividad: no cambia nada
r = correr('--omitir-con-actividad');
assert.equal(r.status, 0); assert.match(r.stdout, /SIMULACRO/); assert.deepEqual(cuenta(), antes);

// 5. aplicar de verdad: borra la carga, deja la venta y su producto
r = correr('--aplicar', '--si', '--omitir-con-actividad');
assert.equal(r.status, 0, r.stdout + r.stderr);
const despues = cuenta();
assert.equal(despues.prod, 1, 'solo queda el producto con ventas');
assert.equal(despues.ventas, 1);
assert.equal(despues.barras, 1);
assert.equal(despues.mov, 2, 'quedan la carga y la venta del producto vendido');
assert.equal(despues.seq, 4, 'la numeración sigue desde el último PROD-#### que queda');
const resp = path.join(dir, 'respaldos', '_manual');
const archivos = fs.readdirSync(resp);
assert.equal(archivos.filter((f) => f.endsWith('.db')).length, 1, 'copia de seguridad'); assert.equal(archivos.filter((f) => f.endsWith('.csv')).length, 1, 'lista de lo borrado');
assert.match(fs.readFileSync(path.join(resp, archivos.find((f) => f.endsWith('.csv'))), 'utf8'), /Harina duplicada/);
assert.equal(D.conEmpresa(SLUG, () => D.get("SELECT COUNT(*) AS n FROM auditoria WHERE accion='reinicio_carga_inicial'").n), 1);

// 6. segunda corrida: ya no hay nada que borrar
r = correr('--aplicar', '--si', '--omitir-con-actividad');
assert.equal(r.status, 0); assert.match(r.stdout, /Solo con carga inicial \(se pueden borrar\): 0/); assert.deepEqual(cuenta(), despues);

// 7. la copia guarda lo que se borró
const { DatabaseSync } = require('node:sqlite');
const bk = new DatabaseSync(path.join(resp, archivos.find((f) => f.endsWith('.db'))));
assert.equal(bk.prepare('SELECT COUNT(*) AS n FROM productos').get().n, 5);
bk.close();

console.log('  reinicio de la carga inicial: simulacro, protección de ventas, borrado, copia y repetición OK');
