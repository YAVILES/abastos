'use strict';
// Datos de demostración (productos, proveedores, clientes, medios de pago). Uso: npm run demo [codigo-empresa]
const D = require('./db');
const L = require('./lib');
const P = require('./plataforma');
P.iniciar();
const slug = process.argv[2] || 'principal';
if (!D.existeEmpresa(slug)) { console.error('No existe la empresa "' + slug + '"'); process.exit(1); }
D.conEmpresa(slug, () => {
if (D.get('SELECT id FROM productos LIMIT 1')) { console.log('La empresa ya tiene productos: no se cargó la demo.'); return; }

const prov = {};
for (const [n, d] of [['Distribuidora Central C.A.', 15], ['Alimentos del Valle', 7], ['Licores y Bebidas Oriente', 0], ['Productos de Aseo Express', 7]])
  prov[n] = D.insert('INSERT INTO proveedores(nombre,dias_credito,rif) VALUES(?,?,?)', n, d, 'J-' + (30000000 + Math.floor(Math.random() * 9e6)));
const cat = Object.fromEntries(D.all('SELECT id,nombre FROM categorias').map((c) => [c.nombre, c.id]));
const P = 'Distribuidora Central C.A.', V = 'Alimentos del Valle', B = 'Licores y Bebidas Oriente', E = 'Productos de Aseo Express';
// [nombre, categoría, presentación, costo, precio, stock, min, max, proveedor, factor]
const lista = [
  ['Harina de maíz precocida 1 kg', 'Harinas', '1 kg', 0.95, 1.30, 60, 24, 120, P, 20], ['Arroz blanco 1 kg', 'Granos', '1 kg', 0.90, 1.25, 48, 24, 120, P, 24],
  ['Pasta larga 1 kg', 'Granos', '1 kg', 1.10, 1.55, 36, 18, 90, P, 20], ['Caraotas negras 500 g', 'Granos', '500 g', 0.80, 1.15, 30, 12, 60, P, 24],
  ['Azúcar 1 kg', 'Otros', '1 kg', 1.00, 1.40, 40, 20, 100, P, 20], ['Sal 1 kg', 'Otros', '1 kg', 0.45, 0.70, 30, 12, 60, P, 40],
  ['Aceite vegetal 1 L', 'Otros', '1 L', 2.60, 3.40, 24, 12, 60, P, 12], ['Atún en lata 140 g', 'Enlatados', '140 g', 1.30, 1.85, 40, 24, 96, V, 24],
  ['Sardinas en salsa 170 g', 'Enlatados', '170 g', 0.95, 1.40, 30, 12, 72, V, 24], ['Margarina 500 g', 'Lácteos', '500 g', 1.80, 2.50, 18, 10, 40, V, 12],
  ['Leche en polvo 400 g', 'Lácteos', '400 g', 3.90, 5.00, 14, 8, 30, V, 12], ['Queso blanco duro kg', 'Lácteos', 'kg', 4.50, 6.50, 10, 5, 20, V, 1],
  ['Jamón de pierna kg', 'Charcutería', 'kg', 5.50, 7.50, 6, 3, 12, V, 1], ['Mortadela kg', 'Charcutería', 'kg', 3.20, 4.50, 8, 4, 16, V, 1],
  ['Refresco cola 2 L', 'Bebidas', '2 L', 1.10, 1.60, 48, 24, 120, B, 6], ['Refresco cola 355 ml', 'Bebidas', '355 ml', 0.45, 0.70, 72, 36, 144, B, 24],
  ['Agua mineral 600 ml', 'Bebidas', '600 ml', 0.30, 0.55, 96, 48, 192, B, 24], ['Jugo de naranja 1 L', 'Bebidas', '1 L', 1.20, 1.75, 24, 12, 48, B, 12],
  ['Cerveza lata 355 ml', 'Bebidas', '355 ml', 0.85, 1.25, 96, 48, 240, B, 24], ['Malta botella 250 ml', 'Bebidas', '250 ml', 0.60, 0.90, 48, 24, 96, B, 24],
  ['Papel higiénico 4 rollos', 'Aseo personal', '4 rollos', 1.60, 2.30, 30, 12, 60, E, 12], ['Jabón de baño', 'Aseo personal', '125 g', 0.55, 0.85, 40, 18, 90, E, 48],
  ['Crema dental 75 ml', 'Aseo personal', '75 ml', 1.30, 1.90, 24, 12, 48, E, 24], ['Champú sobre', 'Aseo personal', '20 ml', 0.12, 0.25, 100, 50, 300, E, 100],
  ['Detergente en polvo 500 g', 'Limpieza', '500 g', 1.70, 2.40, 20, 10, 40, E, 20], ['Cloro 1 L', 'Limpieza', '1 L', 0.80, 1.20, 24, 12, 48, E, 12],
  ['Lavaplatos 500 g', 'Limpieza', '500 g', 1.20, 1.75, 18, 10, 36, E, 24], ['Galletas de soda', 'Snacks', 'paquete', 0.35, 0.60, 60, 30, 120, V, 48],
  ['Papas fritas bolsa', 'Snacks', '40 g', 0.50, 0.85, 40, 20, 80, V, 24], ['Chocolate barra', 'Snacks', '30 g', 0.40, 0.70, 50, 25, 100, V, 48],
  ['Café molido 250 g', 'Otros', '250 g', 2.20, 3.10, 20, 10, 40, P, 20], ['Mayonesa 445 g', 'Otros', '445 g', 2.10, 2.95, 16, 8, 32, P, 12]
];
lista.forEach((f, i) => {
  const [nombre, c, pres, costo, precio, stock, min, max, pv, factor] = f;
  const id = D.insert(`INSERT INTO productos(codigo,nombre,categoria_id,presentacion,unidad_compra,unidad_venta,factor,costo_usd,precio_usd,margen,precio_fijo,stock_min,stock_max,ubicacion,proveedor_id,creado)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, D.siguiente('producto', 'PROD', 4), nombre, cat[c], pres, factor > 1 ? 'caja' : 'unidad', 'unidad', factor, costo, precio,
    Math.round((precio / costo - 1) * 1000) / 10, 1, min, max, 'Pasillo ' + (1 + (i % 5)), prov[pv], D.ahora());
  D.run('INSERT INTO codigos_barra(codigo,producto_id,principal) VALUES(?,?,1)', '759100000' + String(1000 + i).padStart(4, '0'), id);
  L.mov(id, 'inventario_inicial', stock, costo, 'Inventario inicial demo', 'producto', id, 'demo', null);
});
const banco = D.get("SELECT id FROM cuentas WHERE tipo='banco'").id;
D.run('UPDATE cuentas SET saldo_inicial=? WHERE id=?', 200000, banco);
D.run("UPDATE cuentas SET saldo_inicial=100 WHERE tipo='caja' AND moneda='USD'");
D.insert("INSERT INTO medios_pago_app(medio,banco,cuenta_id,tipo_doc,documento,telefono,moneda,observacion,estado) VALUES('pago_movil','Banesco',?,'J','123456789','04141112233','VES','Indica tu referencia completa','publicado')", banco);
D.insert("INSERT INTO medios_pago_app(medio,banco,cuenta_id,titular,documento,num_cuenta,tipo_cuenta,moneda,estado) VALUES('transferencia','Mercantil',?,'Mi Abasto C.A.','J-123456789','01050000000000000000','corriente','VES','publicado')", banco);
D.insert('INSERT INTO clientes(nombre,documento,telefono,credito_habilitado,limite_usd,dias_credito,creado) VALUES(?,?,?,?,?,?,?)', 'Doña Marta Pérez', 'V-8123456', '04141234567', 1, 30, 7, D.ahora());
D.insert('INSERT INTO clientes(nombre,documento,telefono,creado) VALUES(?,?,?,?)', 'José Rodríguez', 'V-12345678', '04241234567', D.ahora());
D.setParam('empresa', { nombre: 'Abasto Demo', rif: 'J-12345678-9', direccion: 'Calle Principal, local 1', telefono: '0414-1112233', correo: '', moneda_base: 'USD' });
console.log(`Demo cargada: ${lista.length} productos, ${Object.keys(prov).length} proveedores.`);
});
