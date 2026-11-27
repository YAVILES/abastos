'use strict';
// Borra la carga de inventario inicial de UNA empresa para poder volver a montarla bien desde el Excel.
//
// Qué borra: los productos que solo tienen movimientos de la carga inicial (inventario inicial o cambio de costo) y que no aparecen en
// ninguna venta, compra, pedido, reserva, conteo ni preparación; con ellos se van sus movimientos de inventario y sus códigos de barras.
// Qué NO toca: ventas, compras, clientes, cajas, cuentas, usuarios ni parámetros. Un producto con cualquier otra actividad se deja
// tal cual y se informa (por defecto el script se detiene si encuentra alguno).
//
// Uso (desde la carpeta de la app, en el servidor, con el mismo DATA_DIR que usa el sistema):
//   node --no-warnings scripts/reiniciar_carga_inicial.js <empresa>                 simulacro: muestra qué borraría, no cambia nada
//   node --no-warnings scripts/reiniciar_carga_inicial.js <empresa> --aplicar       borra de verdad (pide escribir el código de la empresa)
// Opciones:
//   --si                           no pide confirmación escrita (para correrlo sin terminal interactiva)
//   --omitir-con-actividad         si hay productos con ventas/compras/etc., los deja y borra el resto (sin esto el script se detiene)
//   --desde "AAAA-MM-DD HH:MM"     solo productos creados desde esa fecha y hora
//   --hasta "AAAA-MM-DD HH:MM"     solo productos creados hasta esa fecha y hora
//   --borrar-categorias-vacias     al final borra también categorías y proveedores que quedaron sin ningún producto ni compra
// Antes de borrar guarda una copia completa de la base y la lista de lo borrado en DATA_DIR/respaldos/_manual/.
// Después: Productos › Inventario inicial (Excel) y se sube el archivo corregido.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const D = require('../db');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const slug = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--desde', '--hasta'].includes(args[i - 1])));
const APLICAR = flag('--aplicar');

function salir(msg, codigo = 1) { console.error(msg); process.exit(codigo); }
if (!slug) salir('Falta el código de la empresa.\nUso: node --no-warnings scripts/reiniciar_carga_inicial.js <empresa> [--aplicar]');
if (!D.existeEmpresa(slug)) salir(`No existe la empresa «${slug}» en ${D.EMP_DIR}. Revisa el código y que DATA_DIR apunte al disco de datos del sistema.`);
const FECHA = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;
for (const n of ['--desde', '--hasta']) if (valor(n) && !FECHA.test(valor(n))) salir(`${n} debe verse como 2026-11-27 o 2026-11-27 14:30`);

const TIPOS_CARGA = ['inventario_inicial', 'revalorizacion'];
const q = (ruta) => `'${ruta.replace(/'/g, "''")}'`;
const confirmar = (pregunta) => new Promise((ok) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(pregunta, (r) => { rl.close(); ok(r.trim()); }); });

function analizar() {
  const tablas = D.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
  // tablas que apuntan a un producto, además de los movimientos y los códigos de barras (que se van con el producto)
  const refs = tablas.filter((t) => !['inventario_movimientos', 'codigos_barra', 'productos'].includes(t)
    && D.all(`PRAGMA table_info(${t})`).some((c) => c.name === 'producto_id'));
  const w = []; const a = [];
  if (valor('--desde')) { w.push('p.creado >= ?'); a.push(valor('--desde')); }
  if (valor('--hasta')) { w.push('p.creado <= ?'); a.push(valor('--hasta') + (valor('--hasta').length === 10 ? ' 23:59:59' : ':59')); }
  const productos = D.all(`SELECT p.id, p.codigo, p.nombre, p.creado,
      COALESCE((SELECT SUM(m.cantidad) FROM inventario_movimientos m WHERE m.producto_id=p.id),0) AS stock, p.costo_usd,
      (SELECT COUNT(*) FROM inventario_movimientos m WHERE m.producto_id=p.id AND m.tipo NOT IN (${TIPOS_CARGA.map(() => '?').join(',')})) AS otros_mov
    FROM productos p ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.id`, ...TIPOS_CARGA, ...a);
  const borrar = [], con_actividad = [];
  for (const p of productos) {
    const motivos = [];
    if (p.otros_mov > 0) motivos.push(`${p.otros_mov} movimiento(s) de inventario que no son de la carga`);
    for (const t of refs) { const n = D.get(`SELECT COUNT(*) AS n FROM ${t} WHERE producto_id=?`, p.id).n; if (n) motivos.push(`${n} registro(s) en ${t}`); }
    (motivos.length ? con_actividad : borrar).push({ ...p, motivos });
  }
  return { total: productos.length, refs, borrar, con_actividad };
}

function listaCsv(filas) {
  const c = (x) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  return ['codigo,nombre,existencia,costo_usd,creado', ...filas.map((p) => [p.codigo, p.nombre, p.stock, p.costo_usd, p.creado].map(c).join(','))].join('\n');
}

async function principal() {
  D.conEmpresa(slug, () => { /* abre la base */ });
  const R = D.conEmpresa(slug, analizar);
  console.log(`\nEmpresa: ${slug}   Base: ${path.join(D.EMP_DIR, slug + '.db')}`);
  console.log(`Productos en la base: ${R.total}`);
  console.log(`  Solo con carga inicial (se pueden borrar): ${R.borrar.length}`);
  console.log(`  Con otra actividad (no se tocan):          ${R.con_actividad.length}`);
  if (R.borrar.length) {
    console.log('\nPrimeros productos que se borrarían:');
    for (const p of R.borrar.slice(0, 15)) console.log(`  ${p.codigo.padEnd(12)} ${String(p.stock).padStart(8)} u  ${p.nombre}`);
    if (R.borrar.length > 15) console.log(`  … y ${R.borrar.length - 15} más`);
    const valor = R.borrar.reduce((t, p) => t + p.stock * p.costo_usd, 0);
    console.log(`Existencia que sale del inventario: ${R.borrar.reduce((t, p) => t + p.stock, 0)} unidades, ${valor.toFixed(2)} USD al costo`);
  }
  if (R.con_actividad.length) {
    console.log('\nProductos que NO se pueden borrar sin perder historial:');
    for (const p of R.con_actividad.slice(0, 30)) console.log(`  ${p.codigo.padEnd(12)} ${p.nombre}  →  ${p.motivos.join('; ')}`);
    if (R.con_actividad.length > 30) console.log(`  … y ${R.con_actividad.length - 30} más`);
  }
  if (!R.borrar.length) salir('\nNo hay nada que borrar.', 0);
  if (R.con_actividad.length && !flag('--omitir-con-actividad')) {
    salir('\nSe detiene porque hay productos con actividad. Revisa la lista: si quieres borrar solo el resto y dejar esos, agrega --omitir-con-actividad.\n'
      + 'Si los duplicados están entre ellos, se resuelven desde el sistema (ajuste de inventario y desactivar el sobrante).');
  }
  if (!APLICAR) { console.log('\nSIMULACRO: no se cambió nada. Para borrar de verdad agrega --aplicar'); return; }

  if (!flag('--si')) {
    const r = await confirmar(`\nVas a borrar ${R.borrar.length} productos de «${slug}». Escribe el código de la empresa para confirmar: `);
    if (r !== slug) salir('No coincide. No se borró nada.');
  }

  const marca = D.ahora().replace(/[: ]/g, '-');
  const dirRespaldo = path.join(D.DATA_DIR, 'respaldos', '_manual');
  fs.mkdirSync(dirRespaldo, { recursive: true });
  const copia = path.join(dirRespaldo, `${slug}-antes-de-reiniciar-carga-${marca}.db`);
  D.conEmpresa(slug, () => D.run(`VACUUM INTO ${q(copia)}`));
  fs.writeFileSync(copia.replace(/\.db$/, '.csv'), listaCsv(R.borrar), 'utf8');
  console.log(`\nCopia de seguridad: ${copia}`);

  const res = D.conEmpresa(slug, () => D.tx(() => {
    const ids = R.borrar.map((p) => p.id);
    let movs = 0, barras = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const lote = ids.slice(i, i + 500), ph = lote.map(() => '?').join(',');
      movs += Number(D.run(`DELETE FROM inventario_movimientos WHERE producto_id IN (${ph})`, ...lote).changes);
      barras += Number(D.run(`DELETE FROM codigos_barra WHERE producto_id IN (${ph})`, ...lote).changes);
      D.run(`DELETE FROM productos WHERE id IN (${ph})`, ...lote);
    }
    // El próximo producto sin código interno vuelve a numerarse desde el último PROD-#### que queda (o desde PROD-0001)
    const resto = D.all("SELECT codigo FROM productos WHERE codigo GLOB 'PROD-[0-9]*'").map((p) => Number(p.codigo.slice(5))).filter(Number.isFinite);
    const maximo = resto.length ? Math.max(...resto) : 0;
    if (D.get("SELECT 1 AS x FROM secuencias WHERE clave='producto'")) D.run("UPDATE secuencias SET valor=? WHERE clave='producto'", maximo);
    let catsBorradas = 0, provBorrados = 0;
    if (flag('--borrar-categorias-vacias')) {
      catsBorradas = Number(D.run('DELETE FROM categorias WHERE id NOT IN (SELECT categoria_id FROM productos WHERE categoria_id IS NOT NULL)').changes);
      provBorrados = Number(D.run('DELETE FROM proveedores WHERE id NOT IN (SELECT proveedor_id FROM productos WHERE proveedor_id IS NOT NULL) AND id NOT IN (SELECT proveedor_id FROM compras) AND id NOT IN (SELECT proveedor_id FROM cxp)').changes);
    }
    D.run('INSERT INTO auditoria(fecha,usuario,accion,entidad,ref,detalle) VALUES(?,?,?,?,?,?)', D.ahora(), 'script', 'reinicio_carga_inicial', 'producto', null,
      JSON.stringify({ productos: ids.length, movimientos: movs, codigos_barra: barras, categorias: catsBorradas, proveedores: provBorrados, respaldo: path.basename(copia) }));
    const malas = D.all('PRAGMA foreign_key_check');
    if (malas.length) throw new Error('La revisión de integridad falló (' + malas.length + ' referencias rotas); no se borró nada');
    return { productos: ids.length, movs, barras, catsBorradas, provBorrados, quedan: D.get('SELECT COUNT(*) AS n FROM productos').n };
  }));
  console.log(`Borrados: ${res.productos} productos, ${res.movs} movimientos de inventario, ${res.barras} códigos de barras`
    + (flag('--borrar-categorias-vacias') ? `, ${res.catsBorradas} categorías, ${res.provBorrados} proveedores` : ''));
  console.log(`Productos que quedan en la base: ${res.quedan}`);
  console.log('Listo. Ahora entra al sistema: Productos › Inventario inicial (Excel) y sube el archivo corregido.');
}

principal().catch((e) => salir('Error: ' + e.message));
