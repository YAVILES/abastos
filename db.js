'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { AsyncLocalStorage } = require('node:async_hooks');

// Una base SQLite por empresa (aislamiento total entre abastos) dentro de DATA_DIR/empresas.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EMP_DIR = path.join(DATA_DIR, 'empresas');
fs.mkdirSync(EMP_DIR, { recursive: true });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const RESERVADOS = new Set(['plataforma', 'tienda', 'api', 'admin', 'www', 'e', 'static', 'public']);
const validarSlug = (s) => SLUG_RE.test(String(s)) && !RESERVADOS.has(String(s));

// 0424-235.6203, +58 424 2356203, 584242356203 y 4242356203 son el mismo número: se guarda como 04242356203.
function normalizarTelefono(t) {
  let d = String(t == null ? '' : t).replace(/[^0-9]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('58') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10 && d[0] === '4') d = '0' + d;
  return d;
}
const handles = new Map();
const als = new AsyncLocalStorage();
function abrir(slug) {
  if (!SLUG_RE.test(slug)) throw new Error('Código de empresa inválido');
  let db = handles.get(slug);
  if (db) return db;
  db = new DatabaseSync(path.join(EMP_DIR, slug + '.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Columnas agregadas después de la primera versión (idempotente)
  for (const [tabla, def] of [['usuarios', 'telefono TEXT'], ['ordenes_entrega', 'repartidor_id INTEGER'], ['ordenes_entrega', 'repartidor TEXT'], ['ordenes_entrega', 'repartidor_tel TEXT'],
    ['ordenes_entrega', 'asignado_en TEXT'], ['ordenes_entrega', 'salida_en TEXT'], ['ordenes_entrega', 'retirado_en TEXT'], ['ordenes_entrega', 'rechazado_en TEXT'], ['ordenes_entrega', 'motivo_rechazo TEXT'], ['ordenes_entrega', 'entregado_en TEXT'], ['ordenes_entrega', 'receptor TEXT'], ['ordenes_entrega', 'nota_entrega TEXT'], ['conteos', 'arrastre_antes TEXT'], ['compras', 'enviada_en TEXT'], ['compras', 'enviada_por TEXT'], ['compras', 'envio_medio TEXT'], ['compras', 'envio_nota TEXT'], ['compras', 'factura TEXT'], ['compras', 'factura_fecha TEXT'],
    ['compras', 'recepcion_nota TEXT'], ['compras', 'recibida_por TEXT'], ['compras', 'con_diferencias INTEGER NOT NULL DEFAULT 0'], ['compras', 'total_pedido REAL'],
    ['compra_detalles', 'cantidad_pedida REAL'], ['compra_detalles', 'costo_pedido REAL'], ['inventario_movimientos', 'saldo_cant REAL'], ['inventario_movimientos', 'saldo_valor REAL'], ['inventario_movimientos', 'costo_prom REAL'], ['pagos_reportados', 'paga_con REAL'], ['proveedores', 'plazo_entrega INTEGER NOT NULL DEFAULT 3'],
    ['pedidos', 'calificacion INTEGER'], ['pedidos', 'calificacion_nota TEXT'], ['pedidos', 'calificado_en TEXT']]) {
    if (!db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === def.split(' ')[0])) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${def}`);
  }
  // Migración: teléfonos de clientes guardados en otro formato (solo si no chocan con otro cliente)
  for (const c of db.prepare('SELECT id, telefono FROM clientes WHERE telefono IS NOT NULL').all()) {
    const n = normalizarTelefono(c.telefono);
    if (n && n !== c.telefono && !db.prepare('SELECT 1 FROM clientes WHERE telefono=? AND id<>?').get(n, c.id)) db.prepare('UPDATE clientes SET telefono=? WHERE id=?').run(n, c.id);
  }
  db.exec("UPDATE pedidos SET expira=NULL WHERE expira IS NOT NULL AND estado NOT IN ('pendiente','pago_reportado')");
  // Lo pedido en las órdenes anteriores queda igual a lo que ya se había registrado
  db.exec('UPDATE compra_detalles SET cantidad_pedida=cantidad WHERE cantidad_pedida IS NULL');
  db.exec('UPDATE compra_detalles SET costo_pedido=costo_unit WHERE costo_pedido IS NULL');
  db.exec('UPDATE compras SET total_pedido=total_moneda WHERE total_pedido IS NULL');
  // Kardex valorizado: a los movimientos anteriores se les calcula el saldo y el costo promedio repitiendo la historia de cada producto
  const pendientes = db.prepare('SELECT DISTINCT producto_id FROM inventario_movimientos WHERE saldo_cant IS NULL').all();
  if (pendientes.length) {
    const hist = db.prepare('SELECT id, tipo, cantidad, costo_usd FROM inventario_movimientos WHERE producto_id=? ORDER BY id');
    const fijar = db.prepare('UPDATE inventario_movimientos SET costo_usd=?, saldo_cant=?, saldo_valor=?, costo_prom=? WHERE id=?');
    const costoVigente = db.prepare('SELECT costo_usd FROM productos WHERE id=?');
    const nuevo = db.prepare("INSERT INTO inventario_movimientos(producto_id,fecha,tipo,cantidad,costo_usd,motivo,ref_tipo,saldo_cant,saldo_valor,costo_prom) VALUES(?,?,'revalorizacion',0,?,?,'sistema',?,?,?)");
    db.exec('BEGIN');
    try {
      for (const { producto_id } of pendientes) {
        let e = { sq: 0, sv: 0, prom: 0 };
        for (const m of hist.all(producto_id)) { const r = kardexPaso(e, m.tipo, m.cantidad, m.costo_usd); fijar.run(r.costo, r.sq, r.sv, r.prom, m.id); e = { sq: r.sq, sv: r.sv, prom: r.prom }; }
        const p = costoVigente.get(producto_id);
        // si el costo vigente del producto no coincide con el que sale de la historia, queda una revalorización que lo deja igual
        if (p && Math.abs((p.costo_usd || 0) - e.prom) > 0.00005) nuevo.run(producto_id, ahora(), p.costo_usd, 'Ajuste de migración: costo vigente del producto', e.sq, Math.round(e.sq * p.costo_usd * 1e4) / 1e4, p.costo_usd);
      }
      db.exec('COMMIT');
    } catch (er) { db.exec('ROLLBACK'); throw er; }
  }
  // El vuelto ahora se guarda también como pago (tipo 'vuelto', con su moneda y medio): se completa el de ventas anteriores
  db.exec(`INSERT INTO pagos(tipo,venta_id,fecha,medio,moneda,monto,tasa,monto_usd,cuenta_id,turno_id,usuario,jornada_id,anulado)
    SELECT 'vuelto', m.ref_id, m.fecha, 'efectivo', c.moneda, -m.monto, CASE WHEN m.monto<>0 THEN ABS(m.monto_usd/m.monto) ELSE 1 END, -m.monto_usd, m.cuenta_id, m.turno_id, m.usuario, m.jornada_id,
           CASE WHEN v.estado='anulada' THEN 1 ELSE 0 END
      FROM cuenta_movimientos m JOIN cuentas c ON c.id=m.cuenta_id JOIN ventas v ON v.id=m.ref_id
     WHERE m.tipo='vuelto' AND m.ref_tipo='venta' AND NOT EXISTS (SELECT 1 FROM pagos p WHERE p.venta_id=m.ref_id AND p.tipo='vuelto')`);
  // Tasa por fecha: se completa el registro con los días ya operados (la última tasa de cada fecha)
  db.exec(`INSERT OR IGNORE INTO tasas_cambio(fecha,tasa_usd_ves,tasa_eur_usd,fuente,usuario,registrada_en)
    SELECT j.fecha, j.tasa_usd_ves, j.tasa_eur_usd, j.fuente, j.usuario_apertura, j.abierta_en FROM jornadas j
     WHERE j.id=(SELECT MAX(id) FROM jornadas x WHERE x.fecha=j.fecha)`);
  handles.set(slug, db);
  return db;
}
function conEmpresa(slug, fn) { return als.run({ db: abrir(slug), slug }, fn); }
const slugActual = () => { const s = als.getStore(); return s ? s.slug : null; };
const cur = () => { const s = als.getStore(); if (!s) throw new Error('Operación fuera del contexto de una empresa'); return s.db; };
const existeEmpresa = (slug) => SLUG_RE.test(slug) && fs.existsSync(path.join(EMP_DIR, slug + '.db'));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, usuario TEXT NOT NULL UNIQUE,
  clave_hash TEXT NOT NULL, rol TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  codigo TEXT PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT, permisos TEXT NOT NULL DEFAULT '[]', sistema INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY, tipo TEXT NOT NULL, ref_id INTEGER NOT NULL,
  creado TEXT NOT NULL, expira TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parametros (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secuencias (clave TEXT PRIMARY KEY, valor INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, usuario TEXT, accion TEXT NOT NULL,
  entidad TEXT, ref TEXT, detalle TEXT
);

CREATE TABLE IF NOT EXISTS jornadas (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, estado TEXT NOT NULL,
  tasa_usd_ves REAL NOT NULL, tasa_eur_usd REAL NOT NULL, fuente TEXT, obs TEXT,
  usuario_apertura TEXT, abierta_en TEXT NOT NULL, cerrada_en TEXT, usuario_cierre TEXT,
  resumen TEXT
);
-- Registro oficial de la tasa de cada fecha: una sola fila por día
CREATE TABLE IF NOT EXISTS tasas_cambio (
  fecha TEXT PRIMARY KEY, tasa_usd_ves REAL NOT NULL, tasa_eur_usd REAL NOT NULL, fuente TEXT,
  usuario TEXT, registrada_en TEXT NOT NULL, actualizada_en TEXT
);
CREATE TABLE IF NOT EXISTS tasas_log (
  id INTEGER PRIMARY KEY, jornada_id INTEGER, fecha TEXT NOT NULL, usuario TEXT,
  tasa_usd_ves REAL, tasa_eur_usd REAL, fuente TEXT, motivo TEXT
);

CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, rif TEXT, telefono TEXT, correo TEXT,
  direccion TEXT, contacto TEXT, dias_credito INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id), marca TEXT, presentacion TEXT,
  unidad_compra TEXT NOT NULL DEFAULT 'unidad', unidad_venta TEXT NOT NULL DEFAULT 'unidad',
  factor REAL NOT NULL DEFAULT 1, costo_usd REAL NOT NULL DEFAULT 0, precio_usd REAL NOT NULL DEFAULT 0,
  margen REAL NOT NULL DEFAULT 30, precio_fijo INTEGER NOT NULL DEFAULT 1,
  stock_min REAL NOT NULL DEFAULT 0, stock_max REAL NOT NULL DEFAULT 0, ubicacion TEXT,
  proveedor_id INTEGER REFERENCES proveedores(id), imagen TEXT,
  activo INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codigos_barra (
  codigo TEXT PRIMARY KEY, producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  principal INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id INTEGER PRIMARY KEY, producto_id INTEGER NOT NULL REFERENCES productos(id),
  fecha TEXT NOT NULL, tipo TEXT NOT NULL, cantidad REAL NOT NULL, costo_usd REAL NOT NULL DEFAULT 0,
  motivo TEXT, ref_tipo TEXT, ref_id INTEGER, usuario TEXT, jornada_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_mov_prod ON inventario_movimientos(producto_id);

CREATE TABLE IF NOT EXISTS cuentas (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL, moneda TEXT NOT NULL,
  numero TEXT, saldo_inicial REAL NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cuenta_movimientos (
  id INTEGER PRIMARY KEY, cuenta_id INTEGER NOT NULL REFERENCES cuentas(id), fecha TEXT NOT NULL,
  monto REAL NOT NULL, monto_usd REAL NOT NULL DEFAULT 0, tipo TEXT NOT NULL, referencia TEXT,
  ref_tipo TEXT, ref_id INTEGER, usuario TEXT, jornada_id INTEGER, turno_id INTEGER, nota TEXT
);
CREATE INDEX IF NOT EXISTS ix_cmov_cuenta ON cuenta_movimientos(cuenta_id);
CREATE INDEX IF NOT EXISTS ix_cmov_turno ON cuenta_movimientos(turno_id);

CREATE TABLE IF NOT EXISTS cajas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, activo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS caja_turnos (
  id INTEGER PRIMARY KEY, caja_id INTEGER NOT NULL REFERENCES cajas(id), usuario_id INTEGER NOT NULL,
  usuario TEXT NOT NULL, jornada_id INTEGER, estado TEXT NOT NULL, abierta_en TEXT NOT NULL,
  cerrada_en TEXT, fondo TEXT NOT NULL, esperado TEXT, contado TEXT, diferencia_usd REAL,
  comentario TEXT
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, documento TEXT, telefono TEXT UNIQUE,
  direccion TEXT, credito_habilitado INTEGER NOT NULL DEFAULT 0, limite_usd REAL NOT NULL DEFAULT 0,
  dias_credito INTEGER NOT NULL DEFAULT 7, estado TEXT NOT NULL DEFAULT 'activo',
  pin_hash TEXT, creado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  moneda TEXT NOT NULL, tasa REAL NOT NULL DEFAULT 1, condicion TEXT NOT NULL DEFAULT 'contado',
  estado TEXT NOT NULL, total_moneda REAL NOT NULL DEFAULT 0, total_usd REAL NOT NULL DEFAULT 0,
  cuenta_id INTEGER, medio TEXT, referencia TEXT, dias_credito INTEGER DEFAULT 0, nota TEXT,
  fecha TEXT NOT NULL, recibida_en TEXT, jornada_id INTEGER, usuario TEXT, motivo_anulacion TEXT
);
CREATE TABLE IF NOT EXISTS compra_detalles (
  id INTEGER PRIMARY KEY, compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id), cantidad REAL NOT NULL,
  costo_unit REAL NOT NULL, unidades REAL NOT NULL DEFAULT 0, costo_usd_unidad REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cxp (
  id INTEGER PRIMARY KEY, proveedor_id INTEGER NOT NULL, compra_id INTEGER, total_usd REAL NOT NULL,
  saldo_usd REAL NOT NULL, vence TEXT, estado TEXT NOT NULL, creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cxp_pagos (
  id INTEGER PRIMARY KEY, cxp_id INTEGER NOT NULL, fecha TEXT NOT NULL, moneda TEXT NOT NULL, monto REAL NOT NULL,
  tasa REAL NOT NULL, monto_usd REAL NOT NULL, cuenta_id INTEGER NOT NULL, referencia TEXT, usuario TEXT
);

CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, cliente_id INTEGER, turno_id INTEGER,
  usuario TEXT, origen TEXT NOT NULL DEFAULT 'pos', pedido_id INTEGER, estado TEXT NOT NULL,
  subtotal_usd REAL NOT NULL, descuento_usd REAL NOT NULL DEFAULT 0, total_usd REAL NOT NULL,
  vuelto_usd REAL NOT NULL DEFAULT 0, fecha TEXT NOT NULL, jornada_id INTEGER,
  motivo_anulacion TEXT, anulada_por TEXT, anulada_en TEXT
);
CREATE INDEX IF NOT EXISTS ix_ventas_fecha ON ventas(fecha);
CREATE TABLE IF NOT EXISTS venta_detalles (
  id INTEGER PRIMARY KEY, venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id), cantidad REAL NOT NULL,
  precio_usd REAL NOT NULL, costo_usd REAL NOT NULL DEFAULT 0, descuento_usd REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, venta_id INTEGER, cxc_id INTEGER, fecha TEXT NOT NULL,
  medio TEXT NOT NULL, moneda TEXT NOT NULL, monto REAL NOT NULL, tasa REAL NOT NULL,
  monto_usd REAL NOT NULL, referencia TEXT, cuenta_id INTEGER, turno_id INTEGER, usuario TEXT,
  jornada_id INTEGER, anulado INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_pagos_venta ON pagos(venta_id);
CREATE TABLE IF NOT EXISTS cxc (
  id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, venta_id INTEGER, total_usd REAL NOT NULL,
  saldo_usd REAL NOT NULL, vence TEXT, estado TEXT NOT NULL, creado TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, categoria TEXT NOT NULL, descripcion TEXT, beneficiario TEXT,
  moneda TEXT NOT NULL, monto REAL NOT NULL, tasa REAL NOT NULL, monto_usd REAL NOT NULL, cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
  referencia TEXT, usuario TEXT, jornada_id INTEGER, anulado INTEGER NOT NULL DEFAULT 0, motivo_anulacion TEXT, creado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gastos_fecha ON gastos(fecha);

CREATE TABLE IF NOT EXISTS recordatorios (
  id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, fecha TEXT NOT NULL, usuario TEXT, medio TEXT NOT NULL,
  monto_usd REAL NOT NULL, facturas TEXT, mensaje TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recordatorios_cliente ON recordatorios(cliente_id);

CREATE TABLE IF NOT EXISTS medios_pago_app (
  id INTEGER PRIMARY KEY, medio TEXT NOT NULL, banco TEXT NOT NULL, cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
  tipo_doc TEXT, documento TEXT, telefono TEXT, titular TEXT, num_cuenta TEXT, tipo_cuenta TEXT,
  moneda TEXT NOT NULL DEFAULT 'VES', observacion TEXT, estado TEXT NOT NULL DEFAULT 'publicado'
);

CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, cliente_id INTEGER NOT NULL, origen TEXT NOT NULL DEFAULT 'app',
  estado TEXT NOT NULL, entrega TEXT NOT NULL DEFAULT 'retiro', contacto TEXT, telefono TEXT, zona TEXT,
  direccion TEXT, referencia_entrega TEXT, nota TEXT, total_usd REAL NOT NULL, creado TEXT NOT NULL,
  expira TEXT, venta_id INTEGER, vendedor TEXT, motivo TEXT
);
CREATE TABLE IF NOT EXISTS pedido_detalles (
  id INTEGER PRIMARY KEY, pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id), cantidad REAL NOT NULL, precio_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY, pedido_id INTEGER NOT NULL, producto_id INTEGER NOT NULL, cantidad REAL NOT NULL,
  expira TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'activa'
);
CREATE INDEX IF NOT EXISTS ix_res_prod ON reservas(producto_id, estado);
CREATE TABLE IF NOT EXISTS pagos_reportados (
  id INTEGER PRIMARY KEY, pedido_id INTEGER NOT NULL, medio_app_id INTEGER NOT NULL, monto REAL NOT NULL,
  moneda TEXT NOT NULL, banco_emisor TEXT, referencia TEXT, comprobante TEXT, estado TEXT NOT NULL DEFAULT 'pendiente',
  motivo TEXT, creado TEXT NOT NULL, resuelto_en TEXT, resuelto_por TEXT
);
CREATE TABLE IF NOT EXISTS ordenes_entrega (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, pedido_id INTEGER NOT NULL, venta_id INTEGER,
  tipo TEXT NOT NULL, estado TEXT NOT NULL, observacion TEXT, creado TEXT NOT NULL, actualizado TEXT
);

CREATE TABLE IF NOT EXISTS preparacion_items (
  id INTEGER PRIMARY KEY, orden_id INTEGER NOT NULL REFERENCES ordenes_entrega(id), producto_id INTEGER NOT NULL REFERENCES productos(id),
  requerido REAL NOT NULL, escaneado REAL NOT NULL DEFAULT 0, manual REAL NOT NULL DEFAULT 0, UNIQUE(orden_id, producto_id)
);
CREATE TABLE IF NOT EXISTS conteos (
  id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, fecha TEXT NOT NULL, responsable TEXT NOT NULL,
  estado TEXT NOT NULL, generado_por TEXT, cargado_en TEXT, autorizado_por TEXT, autorizado_en TEXT
);
CREATE TABLE IF NOT EXISTS conteo_items (
  id INTEGER PRIMARY KEY, conteo_id INTEGER NOT NULL REFERENCES conteos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id), clase TEXT, motivo TEXT,
  stock_sistema REAL NOT NULL, contado REAL, diferencia REAL, observacion TEXT, ajustado INTEGER NOT NULL DEFAULT 0
);
`;

// ---------- helpers ----------
const p2 = (n) => String(n).padStart(2, '0');
// Costo promedio móvil. Un paso del kardex: dado el estado antes del movimiento (existencia, valor y costo promedio), devuelve el costo
// con el que se valora el movimiento y el estado después.
//   · compra, inventario inicial y reverso de una venta entran con su propio costo y recalculan el promedio.
//   · el reverso de una compra sale al costo de esa compra y recalcula el promedio.
//   · la revalorización fija un costo nuevo sin mover unidades.
//   · todo lo demás (ventas, mermas, consumos, ajustes, diferencias de conteo) se valora al promedio vigente y no lo cambia.
const ENTRADAS_CON_COSTO = new Set(['compra', 'inventario_inicial', 'anulacion_venta']);
const CAMBIAN_PROMEDIO = new Set(['compra', 'inventario_inicial', 'anulacion_venta', 'anulacion_compra', 'revalorizacion']);
function kardexPaso(e, tipo, cant, costo) {
  const q4 = (x) => Math.round(x * 1e4) / 1e4;
  if (tipo === 'revalorizacion') return { costo, sq: e.sq, sv: q4(e.sq * costo), prom: costo };
  if (cant > 0 && ENTRADAS_CON_COSTO.has(tipo)) {
    const c = costo || 0, sq = e.sq + cant;
    if (e.sq <= 0) return { costo: c, sq, sv: q4(sq * c), prom: c };
    const sv = e.sv + cant * c;
    return { costo: c, sq, sv: q4(sv), prom: q4(sv / sq) };
  }
  if (tipo === 'anulacion_compra') {
    const c = costo || e.prom, sq = e.sq + cant, sv = e.sv + cant * c;
    return { costo: c, sq, sv: q4(sv), prom: sq > 0 ? q4(sv / sq) : e.prom };
  }
  const prom = e.prom || costo || 0, sq = e.sq + cant;
  return { costo: prom, sq, sv: q4(sq * prom), prom };
}

function ahora() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
function hoy() { return ahora().slice(0, 10); }
function sumarMinutos(min) {
  const d = new Date(Date.now() + min * 60000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
function sumarDias(dias, desde) {
  const d = desde ? new Date(desde + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function tx(fn) {
  const db = cur();
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
const all = (sql, ...a) => cur().prepare(sql).all(...a);
const get = (sql, ...a) => cur().prepare(sql).get(...a);
function run(sql, ...a) { return cur().prepare(sql).run(...a); }
function insert(sql, ...a) { return Number(cur().prepare(sql).run(...a).lastInsertRowid); }

function siguiente(clave, prefijo, ancho = 6) {
  const f = get('SELECT valor FROM secuencias WHERE clave=?', clave);
  const v = (f ? f.valor : 0) + 1;
  if (f) run('UPDATE secuencias SET valor=? WHERE clave=?', v, clave);
  else run('INSERT INTO secuencias(clave,valor) VALUES(?,?)', clave, v);
  return `${prefijo}-${String(v).padStart(ancho, '0')}`;
}

// ---------- parámetros ----------
const DEFAULTS = {
  empresa: { nombre: 'Mi Abasto', rif: '', direccion: '', telefono: '', correo: '', moneda_base: 'USD', logo: '' },
  abc: { metodo: 'ABC', criterio: 'valor', pctA: 50, pctB: 30, pctC: 20, vueltasA: 12, vueltasB: 6, vueltasC: 2, dias_operativos: 300 },
  // Lector de códigos: 'teclado' (USB/Bluetooth que escribe como teclado), 'serial' (puerto COM virtual) o 'camara'
  lector: { tipo: 'teclado', sufijo: 'Enter', prefijo: '', largo_min: 6, ms_entre_teclas: 60, captura_global: true, sonido: true, validar_digito: false, baudios: 9600 },
  operacion: { reserva_minutos: 30, reserva_extension_minutos: 240, descuento_max_pct: 5, margen_defecto: 30, stock_negativo: false, compra_ciclo_dias: 7, compra_cobertura_max_dias: 45, venta_requiere_cliente: true }
};
function param(clave) {
  const f = get('SELECT valor FROM parametros WHERE clave=?', clave);
  return { ...DEFAULTS[clave], ...(f ? JSON.parse(f.valor) : {}) };
}
function setParam(clave, valor) {
  run('INSERT INTO parametros(clave,valor) VALUES(?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor', clave, JSON.stringify(valor));
}

// ---------- claves ----------
function hashClave(clave) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(clave), salt, 32).toString('hex');
}
function verificarClave(clave, hash) {
  if (!hash) return false;
  const [salt, h] = hash.split(':');
  const a = Buffer.from(h, 'hex');
  const b = crypto.scryptSync(String(clave), salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- semillas mínimas ----------
// Prepara una empresa nueva (dentro de conEmpresa). Devuelve la clave del admin si la creó.
function inicializar({ adminClave, nombre } = {}) {
  let claveInicial = null;
  if (!get('SELECT id FROM usuarios LIMIT 1')) {
    claveInicial = adminClave || crypto.randomBytes(5).toString('hex');
    insert('INSERT INTO usuarios(nombre,usuario,clave_hash,rol,creado) VALUES(?,?,?,?,?)',
      'Administrador', 'admin', hashClave(claveInicial), 'admin', ahora());
  }
  if (nombre && !get("SELECT 1 FROM parametros WHERE clave='empresa'")) setParam('empresa', { ...DEFAULTS.empresa, nombre });
  if (!get('SELECT id FROM cuentas LIMIT 1')) {
    for (const [n, t, m] of [['Caja efectivo USD', 'caja', 'USD'], ['Caja efectivo Bs', 'caja', 'VES'],
      ['Caja efectivo EUR', 'caja', 'EUR'], ['Banco principal Bs', 'banco', 'VES']]) {
      insert('INSERT INTO cuentas(nombre,tipo,moneda) VALUES(?,?,?)', n, t, m);
    }
  }
  if (!get('SELECT id FROM cajas LIMIT 1')) {
    insert('INSERT INTO cajas(nombre) VALUES(?)', 'Caja 1');
    insert('INSERT INTO cajas(nombre) VALUES(?)', 'Caja 2');
  }
  if (!get('SELECT id FROM categorias LIMIT 1')) {
    for (const c of ['Harinas', 'Granos', 'Bebidas', 'Enlatados', 'Lácteos', 'Charcutería', 'Aseo personal', 'Limpieza', 'Snacks', 'Otros'])
      insert('INSERT INTO categorias(nombre) VALUES(?)', c);
  }
  return claveInicial;
}

module.exports = { kardexPaso, CAMBIAN_PROMEDIO, normalizarTelefono, DATA_DIR, EMP_DIR, abrir, conEmpresa, slugActual, existeEmpresa, validarSlug, handles, tx, all, get, run, insert, ahora, hoy, sumarMinutos, sumarDias, siguiente, param, setParam, hashClave, verificarClave, inicializar };
