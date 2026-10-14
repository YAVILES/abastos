'use strict';
const crypto = require('node:crypto');
const D = require('./db');
const L = require('./lib');
const P = require('./plataforma');
const Rec = require('./reconocer');
const F = require('./finanzas');
const { err, r2, r4 } = L;

// ---------- permisos ----------
const PERMS = ['productos.editar', 'proveedores.editar', 'compras.editar', 'ventas.crear', 'ventas.anular', 'caja.operar',
  'jornada.gestionar', 'clientes.editar', 'cobros.crear', 'cxp.pagar', 'pedidos.gestionar', 'pedidos.crear', 'inventario.ajustar',
  'conteos.generar', 'conteos.cargar', 'conteos.autorizar', 'parametros.editar', 'usuarios.editar', 'reportes.ver',
  'precio.cambiar', 'credito.autorizar', 'descuento.alto', 'caja.supervisar', 'cuentas.operar', 'reparto.operar',
  'finanzas.ver', 'gastos.registrar',
  'mod.pos', 'mod.caja', 'mod.pedidos', 'mod.app', 'mod.productos', 'mod.inventario', 'mod.conteos', 'mod.compras', 'mod.proveedores',
  'mod.cxp', 'mod.ventas', 'mod.clientes', 'mod.cxc', 'mod.cuentas', 'mod.finanzas', 'mod.reportes', 'mod.parametros'];
// Catálogo que ve el administrador al configurar roles: qué módulos (menús) y qué acciones puede tener cada rol
const CATALOGO_PERMISOS = [
  { grupo: 'Módulos que puede abrir', items: [['mod.pos', 'Punto de venta'], ['mod.caja', 'Caja'], ['mod.pedidos', 'Pedidos de la app'], ['mod.app', 'App de clientes y de repartidores'], ['mod.productos', 'Productos'],
    ['mod.inventario', 'Existencias'], ['mod.conteos', 'Conteos cíclicos'], ['mod.compras', 'Compras'], ['mod.proveedores', 'Proveedores'], ['mod.cxp', 'Cuentas por pagar'], ['mod.ventas', 'Ventas'],
    ['mod.clientes', 'Clientes y crédito'], ['mod.cxc', 'Cuentas por cobrar'], ['mod.cuentas', 'Bancos y cajas'], ['mod.finanzas', 'Análisis financiero'], ['mod.reportes', 'Reportes'], ['mod.parametros', 'Parámetros']] },
  { grupo: 'Ventas y caja', items: [['ventas.crear', 'Registrar ventas'], ['ventas.anular', 'Anular ventas'], ['caja.operar', 'Abrir y cerrar su caja'], ['caja.supervisar', 'Ver y cerrar cajas de otros'], ['precio.cambiar', 'Cambiar precios en la venta'],
    ['descuento.alto', 'Dar descuentos altos'], ['credito.autorizar', 'Autorizar crédito excepcional'], ['clientes.editar', 'Crear y editar clientes'], ['cobros.crear', 'Cobrar cuentas por cobrar']] },
  { grupo: 'Pedidos y reparto', items: [['pedidos.crear', 'Crear pedidos'], ['pedidos.gestionar', 'Validar pagos, preparar y despachar pedidos'], ['reparto.operar', 'Usar la app del repartidor']] },
  { grupo: 'Inventario y compras', items: [['productos.editar', 'Crear y editar productos'], ['inventario.ajustar', 'Ajustes y mermas de inventario'], ['conteos.generar', 'Generar conteos'], ['conteos.cargar', 'Cargar conteos'],
    ['conteos.autorizar', 'Autorizar ajustes de conteo'], ['proveedores.editar', 'Crear y editar proveedores'], ['compras.editar', 'Registrar compras'], ['cxp.pagar', 'Pagar a proveedores']] },
  { grupo: 'Finanzas y administración', items: [['finanzas.ver', 'Ver estados financieros y análisis'], ['gastos.registrar', 'Registrar gastos'], ['cuentas.operar', 'Mover dinero entre cuentas'], ['reportes.ver', 'Ver reportes y auditoría'],
    ['jornada.gestionar', 'Abrir y cerrar el día'], ['parametros.editar', 'Cambiar parámetros'], ['usuarios.editar', 'Administrar usuarios y roles']] }
];
const ROLES = {
  admin: ['*'],
  supervisor: ['*', '-usuarios.editar'],
  cajero: ['ventas.crear', 'caja.operar', 'clientes.editar', 'cobros.crear', 'pedidos.gestionar', 'pedidos.crear', 'mod.pos', 'mod.caja', 'mod.pedidos', 'mod.ventas', 'mod.clientes', 'mod.cxc'],
  compras: ['productos.editar', 'proveedores.editar', 'compras.editar', 'cxp.pagar', 'reportes.ver', 'conteos.cargar', 'mod.productos', 'mod.inventario', 'mod.conteos', 'mod.compras', 'mod.proveedores', 'mod.cxp', 'mod.reportes'],
  almacen: ['conteos.cargar', 'pedidos.gestionar', 'mod.pedidos', 'mod.inventario', 'mod.conteos'],
  vendedor: ['pedidos.crear', 'clientes.editar', 'mod.pedidos', 'mod.clientes'],
  repartidor: ['reparto.operar']
};
const ROLES_BASE = { admin: 'Administrador', supervisor: 'Supervisor', cajero: 'Cajero', compras: 'Compras', almacen: 'Almacén', vendedor: 'Vendedor', repartidor: 'Repartidor (app de reparto)' };
function expandir(def) {
  const s = new Set();
  if (def.includes('*')) PERMS.forEach((p) => s.add(p));
  def.forEach((p) => { if (p[0] === '-') s.delete(p.slice(1)); else if (p !== '*') s.add(p); });
  return s;
}
// Los roles viven en la base de cada empresa y el administrador los edita; la primera vez se siembran con los valores por defecto
function asegurarRoles() {
  if (D.get('SELECT COUNT(*) AS n FROM roles').n) return;
  for (const [codigo, def] of Object.entries(ROLES))
    D.run('INSERT INTO roles(codigo,nombre,permisos,sistema) VALUES(?,?,?,1)', codigo, ROLES_BASE[codigo], JSON.stringify(def));
}
function permisosDe(rol) {
  if (rol === 'admin') return expandir(['*']);
  asegurarRoles();
  const fila = D.get('SELECT permisos FROM roles WHERE codigo=?', rol);
  return expandir(fila ? JSON.parse(fila.permisos) : (ROLES[rol] || []));
}
const rolExiste = (codigo) => { asegurarRoles(); return !!D.get('SELECT 1 FROM roles WHERE codigo=?', codigo); };

// ---------- router ----------
const rutas = [];
function R(metodo, ruta, scope, perm, fn) {
  const keys = [];
  const re = new RegExp('^' + ruta.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  rutas.push({ metodo, re, keys, scope, perm, fn });
}
const pub = (m, r, fn) => R(m, r, 'pub', null, fn);
const staff = (m, r, perm, fn) => R(m, r, 'staff', perm, fn);
const cli = (m, r, fn) => R(m, r, 'cli', null, fn);

function nuevaSesion(tipo, ref_id, horas) {
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + horas * 3600000);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  D.run('INSERT INTO sesiones(token,tipo,ref_id,creado,expira) VALUES(?,?,?,?,?)', token, tipo, ref_id, D.ahora(), f(exp));
  return D.slugActual() + '.' + token; // el prefijo indica la empresa; la sesión vive solo en la base de esa empresa
}
const tokenCrudo = (t) => String(t || '').slice(String(t || '').lastIndexOf('.') + 1);
function sesionDe(token, tipo) {
  if (!token) return null;
  const crudo = tokenCrudo(token);
  const s = D.get('SELECT * FROM sesiones WHERE token=? AND tipo=?', crudo, tipo);
  if (!s) return null;
  if (s.expira < D.ahora()) { D.run('DELETE FROM sesiones WHERE token=?', crudo); return null; }
  return s;
}

const intentos = new Map();
function limitarIntentos(clave) {
  const ahora = Date.now();
  const lista = (intentos.get(clave) || []).filter((t) => ahora - t < 60000);
  if (lista.length >= 6) err(429, 'Demasiados intentos. Espera un minuto.');
  lista.push(ahora); intentos.set(clave, lista);
}
const limpiarIntentos = (clave) => intentos.delete(clave);

// ---------- utilidades ----------
const s = (v) => (v == null ? null : String(v).trim() || null);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'si' || v === 'true' ? 1 : 0);
function req(v, msg) { if (v == null || String(v).trim() === '') err(400, msg); return String(v).trim(); }
function num(v, msg, min) {
  const n = Number(v);
  if (!Number.isFinite(n) || (min != null && n < min)) err(400, msg);
  return n;
}
const like = (q) => `%${String(q).trim().replace(/[%_]/g, '')}%`;
function rango(q) {
  const desde = q.desde || D.hoy(), hasta = q.hasta || desde;
  return [desde, hasta];
}

const SQL_PRODUCTO = `SELECT p.*, c.nombre AS categoria, pr.nombre AS proveedor,
  COALESCE((SELECT SUM(cantidad) FROM inventario_movimientos m WHERE m.producto_id=p.id),0) AS stock,
  (SELECT group_concat(codigo, ', ') FROM codigos_barra b WHERE b.producto_id=p.id) AS barras
  FROM productos p LEFT JOIN categorias c ON c.id=p.categoria_id LEFT JOIN proveedores pr ON pr.id=p.proveedor_id`;
function conStock(p) {
  if (!p) return p;
  const reservado = L.reservadoDe(p.id);
  return { ...p, reservado, disponible: r2(p.stock - reservado) };
}
function guardarBarras(productoId, codigos) {
  if (!Array.isArray(codigos)) return;
  D.run('DELETE FROM codigos_barra WHERE producto_id=?', productoId);
  const vistos = new Set();
  codigos.map((c) => String(c).trim()).filter(Boolean).forEach((c, i) => {
    if (vistos.has(c)) return; vistos.add(c);
    const otro = D.get('SELECT p.nombre FROM codigos_barra b JOIN productos p ON p.id=b.producto_id WHERE b.codigo=? AND b.producto_id<>?', c, productoId);
    if (otro) err(409, `El código de barras ${c} ya pertenece a "${otro.nombre}"`);
    D.run('INSERT INTO codigos_barra(codigo,producto_id,principal) VALUES(?,?,?)', c, productoId, i === 0 ? 1 : 0);
  });
}

// =====================================================================
// AUTENTICACIÓN
// =====================================================================
R('GET', '/api/health', 'global', null, () => ({ ok: true, hora: D.ahora() })); // sin empresa: lo usa la verificación de salud del hosting

pub('POST', '/api/login', ({ body, ip }) => {
  const usuario = req(body.usuario, 'Indica el usuario').toLowerCase();
  const clave = req(body.clave, 'Indica la clave');
  limitarIntentos(ip + '|' + usuario);
  const u = D.get('SELECT * FROM usuarios WHERE usuario=? AND activo=1', usuario);
  if (!u || !D.verificarClave(clave, u.clave_hash)) err(401, 'Usuario o clave incorrectos');
  limpiarIntentos(ip + '|' + usuario);
  L.audit(u.usuario, 'login', 'usuario', u.id);
  return { token: nuevaSesion('staff', u.id, 12), usuario: { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol } };
});
staff('POST', '/api/logout', null, ({ token }) => { D.run('DELETE FROM sesiones WHERE token=?', tokenCrudo(token)); return { ok: true }; });
staff('GET', '/api/me', null, ({ user, perms }) => {
  const slug = D.slugActual();
  const lic = P.licencia(slug);
  return {
    usuario: user, permisos: [...perms], jornada: L.jornadaAbierta(), turno: L.turnoAbiertoDe(user.id),
    empresa: D.param('empresa'), empresa_codigo: slug, lector: D.param('lector'),
    licencia: { estado: lic.estado, vence: lic.vence, dias_restantes: lic.dias_restantes, plan: lic.plan },
    reconocimiento: { disponible: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), usados_mes: P.usoMes(slug), limite_mes: lic.max_reconocimientos }
  };
});
staff('GET', '/api/red', null, () => {
  const ips = [];
  for (const lista of Object.values(require('node:os').networkInterfaces())) for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  return { ips, empresa: D.slugActual() };
});
staff('POST', '/api/me/clave', null, ({ user, body }) => {
  const u = D.get('SELECT * FROM usuarios WHERE id=?', user.id);
  if (!D.verificarClave(String(body.actual || ''), u.clave_hash)) err(400, 'La clave actual no coincide');
  if (String(body.nueva || '').length < 6) err(400, 'La nueva clave debe tener al menos 6 caracteres');
  D.run('UPDATE usuarios SET clave_hash=? WHERE id=?', D.hashClave(body.nueva), u.id);
  L.audit(user.usuario, 'cambio_clave', 'usuario', u.id);
  return { ok: true };
});

// ---- Roles y permisos por módulo (editables por el administrador) ----
staff('GET', '/api/roles', 'usuarios.editar', () => {
  asegurarRoles();
  const roles = D.all('SELECT codigo,nombre,descripcion,sistema FROM roles ORDER BY sistema DESC, nombre').map((r) => ({
    ...r, permisos: [...permisosDe(r.codigo)], usuarios: D.get('SELECT COUNT(*) AS n FROM usuarios WHERE rol=? AND activo=1', r.codigo).n }));
  return { catalogo: CATALOGO_PERMISOS, roles };
});
staff('POST', '/api/roles', 'usuarios.editar', ({ body, user }) => {
  asegurarRoles();
  const nombre = req(body.nombre, 'Indica el nombre del rol');
  const codigo = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  if (!codigo) err(400, 'Nombre de rol no válido');
  if (D.get('SELECT 1 FROM roles WHERE codigo=?', codigo)) err(409, 'Ya existe un rol con ese nombre');
  const copia = body.copiar_de ? permisosDe(body.copiar_de) : new Set();
  D.run('INSERT INTO roles(codigo,nombre,permisos,sistema) VALUES(?,?,?,0)', codigo, nombre, JSON.stringify([...copia]));
  L.audit(user.usuario, 'rol_creado', 'rol', codigo, { nombre, copiar_de: body.copiar_de || null });
  return { codigo };
});
staff('PUT', '/api/roles/:codigo', 'usuarios.editar', ({ params, body, user }) => {
  asegurarRoles();
  const r = D.get('SELECT * FROM roles WHERE codigo=?', params.codigo);
  if (!r) err(404, 'Rol no encontrado');
  if (r.codigo === 'admin') err(400, 'El administrador siempre tiene acceso a todo');
  const nuevos = Array.isArray(body.permisos) ? body.permisos : null;
  if (nuevos) {
    if (nuevos.some((p) => !PERMS.includes(p))) err(400, 'Hay permisos que no existen');
    D.run('UPDATE roles SET permisos=? WHERE codigo=?', JSON.stringify([...new Set(nuevos)]), r.codigo);
  }
  if (!r.sistema && body.nombre) D.run('UPDATE roles SET nombre=? WHERE codigo=?', req(body.nombre, 'Indica el nombre'), r.codigo);
  L.audit(user.usuario, 'rol_editado', 'rol', r.codigo, { permisos: nuevos ? nuevos.length : undefined });
  return { ok: true };
});
staff('DELETE', '/api/roles/:codigo', 'usuarios.editar', ({ params, user }) => {
  const r = D.get('SELECT * FROM roles WHERE codigo=?', params.codigo);
  if (!r) err(404, 'Rol no encontrado');
  if (r.sistema) err(400, 'Los roles base no se pueden eliminar; puedes quitarles los permisos que no necesiten');
  if (D.get('SELECT COUNT(*) AS n FROM usuarios WHERE rol=?', r.codigo).n) err(409, 'Hay usuarios con este rol: cámbiales el rol primero');
  D.run('DELETE FROM roles WHERE codigo=?', r.codigo);
  L.audit(user.usuario, 'rol_eliminado', 'rol', r.codigo, null);
  return { ok: true };
});
staff('GET', '/api/usuarios', 'usuarios.editar', () => D.all('SELECT id,nombre,usuario,rol,telefono,activo,creado FROM usuarios ORDER BY nombre'));
staff('POST', '/api/usuarios', 'usuarios.editar', ({ body, user }) => {
  const usuario = req(body.usuario, 'Indica el usuario').toLowerCase();
  if (!rolExiste(body.rol)) err(400, 'Rol no válido');
  if (String(body.clave || '').length < 6) err(400, 'La clave debe tener al menos 6 caracteres');
  if (D.get('SELECT id FROM usuarios WHERE usuario=?', usuario)) err(409, 'Ese usuario ya existe');
  const lim = P.licencia(D.slugActual()).max_usuarios;
  if (D.get('SELECT COUNT(*) AS n FROM usuarios WHERE activo=1').n >= lim) err(402, `Tu plan permite hasta ${lim} usuarios activos. Desactiva alguno o amplía el plan.`);
  const id = D.insert('INSERT INTO usuarios(nombre,usuario,clave_hash,rol,telefono,creado) VALUES(?,?,?,?,?,?)',
    req(body.nombre, 'Indica el nombre'), usuario, D.hashClave(body.clave), body.rol, D.normalizarTelefono(body.telefono), D.ahora());
  L.audit(user.usuario, 'usuario_creado', 'usuario', id, { usuario, rol: body.rol });
  return { id };
});
staff('PUT', '/api/usuarios/:id', 'usuarios.editar', ({ params, body, user }) => {
  const u = D.get('SELECT * FROM usuarios WHERE id=?', params.id);
  if (!u) err(404, 'Usuario no encontrado');
  if (body.rol && !rolExiste(body.rol)) err(400, 'Rol no válido');
  if (u.id === user.id && body.activo === 0) err(400, 'No puedes desactivarte a ti mismo');
  D.run('UPDATE usuarios SET nombre=?, rol=?, telefono=?, activo=? WHERE id=?', s(body.nombre) || u.nombre, body.rol || u.rol, body.telefono !== undefined ? D.normalizarTelefono(body.telefono) : (u.telefono ?? null), body.activo == null ? u.activo : bool(body.activo), u.id);
  if (body.clave) {
    if (String(body.clave).length < 6) err(400, 'La clave debe tener al menos 6 caracteres');
    D.run('UPDATE usuarios SET clave_hash=? WHERE id=?', D.hashClave(body.clave), u.id);
    D.run("DELETE FROM sesiones WHERE tipo='staff' AND ref_id=?", u.id);
  }
  L.audit(user.usuario, 'usuario_editado', 'usuario', u.id, { rol: body.rol, activo: body.activo });
  return { ok: true };
});

// =====================================================================
// PARÁMETROS, CUENTAS, CAJAS, MEDIOS DE PAGO APP
// =====================================================================
staff('GET', '/api/parametros', null, () => ({ empresa: D.param('empresa'), abc: D.param('abc'), operacion: D.param('operacion'), lector: D.param('lector') }));
staff('PUT', '/api/parametros/:clave', 'parametros.editar', ({ params, body, user }) => {
  const clave = params.clave;
  if (!['empresa', 'abc', 'operacion', 'lector'].includes(clave)) err(404, 'Parámetro desconocido');
  const antes = D.param(clave);
  const nuevo = { ...antes };
  for (const k of Object.keys(antes)) if (body[k] !== undefined) nuevo[k] = typeof antes[k] === 'number' ? num(body[k], `Valor inválido en ${k}`, 0) : typeof antes[k] === 'boolean' ? !!body[k] : String(body[k]);
  if (clave === 'operacion') {
    if (nuevo.compra_ciclo_dias < 1 || nuevo.compra_ciclo_dias > 90) err(400, 'El ciclo de compra debe estar entre 1 y 90 días');
    if (nuevo.compra_cobertura_max_dias < 7 || nuevo.compra_cobertura_max_dias > 365) err(400, 'La cobertura máxima debe estar entre 7 y 365 días');
  }
  if (clave === 'empresa' && nuevo.logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(nuevo.logo) || nuevo.logo.length > 300000)) err(400, 'El logo debe ser una imagen PNG, JPG o WebP liviana');
  if (clave === 'lector') {
    if (!['teclado', 'serial', 'camara'].includes(nuevo.tipo)) err(400, 'Tipo de lector no válido');
    if (!['Enter', 'Tab', 'ninguno'].includes(nuevo.sufijo)) err(400, 'El carácter final debe ser Enter, Tab o ninguno');
    if (nuevo.largo_min < 1 || nuevo.largo_min > 30) err(400, 'El largo mínimo del código debe estar entre 1 y 30');
    if (nuevo.ms_entre_teclas < 15 || nuevo.ms_entre_teclas > 300) err(400, 'El tiempo máximo entre teclas debe estar entre 15 y 300 ms');
    if (nuevo.prefijo.length > 5) err(400, 'El prefijo puede tener hasta 5 caracteres');
    if (![1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(nuevo.baudios)) err(400, 'Velocidad (baudios) no válida');
  }
  if (clave === 'abc') {
    if (Math.abs(nuevo.pctA + nuevo.pctB + nuevo.pctC - 100) > 0.01) err(400, 'Los porcentajes A + B + C deben sumar 100%');
    if (!['valor', 'movimiento', 'mixto'].includes(nuevo.criterio)) err(400, 'Criterio no válido');
    if (nuevo.dias_operativos < 1) err(400, 'Los días operativos deben ser al menos 1');
  }
  D.setParam(clave, nuevo);
  L.audit(user.usuario, 'parametro_editado', 'parametro', clave, { antes, despues: nuevo });
  return nuevo;
});

staff('GET', '/api/cuentas', null, () => D.all('SELECT * FROM cuentas ORDER BY tipo, nombre').map((c) => ({ ...c, saldo: L.saldoCuenta(c.id) })));
staff('POST', '/api/cuentas', 'parametros.editar', ({ body, user }) => {
  if (!L.MONEDAS.includes(body.moneda)) err(400, 'Moneda no válida');
  if (!['banco', 'caja', 'digital'].includes(body.tipo)) err(400, 'Tipo no válido');
  const id = D.insert('INSERT INTO cuentas(nombre,tipo,moneda,numero,saldo_inicial) VALUES(?,?,?,?,?)',
    req(body.nombre, 'Indica el nombre'), body.tipo, body.moneda, s(body.numero), Number(body.saldo_inicial) || 0);
  L.audit(user.usuario, 'cuenta_creada', 'cuenta', id, { nombre: body.nombre, saldo_inicial: body.saldo_inicial });
  return { id };
});
staff('PUT', '/api/cuentas/:id', 'parametros.editar', ({ params, body, user }) => {
  const c = D.get('SELECT * FROM cuentas WHERE id=?', params.id);
  if (!c) err(404, 'Cuenta no encontrada');
  let saldoIni = c.saldo_inicial;
  if (body.saldo_inicial != null && Number(body.saldo_inicial) !== c.saldo_inicial) {
    if (D.get('SELECT id FROM cuenta_movimientos WHERE cuenta_id=? LIMIT 1', c.id)) err(409, 'El saldo inicial no se puede modificar después de iniciar operación');
    saldoIni = Number(body.saldo_inicial) || 0;
    L.audit(user.usuario, 'saldo_inicial_modificado', 'cuenta', c.id, { antes: c.saldo_inicial, despues: saldoIni });
  }
  D.run('UPDATE cuentas SET nombre=?, numero=?, saldo_inicial=?, activo=? WHERE id=?', s(body.nombre) || c.nombre, body.numero !== undefined ? s(body.numero) : c.numero,
    saldoIni, body.activo == null ? c.activo : bool(body.activo), c.id);
  return { ok: true };
});
staff('GET', '/api/cuentas/:id/movimientos', null, ({ params }) =>
  D.all('SELECT * FROM cuenta_movimientos WHERE cuenta_id=? ORDER BY id DESC LIMIT 300', params.id));
staff('POST', '/api/cuentas/transferir', 'cuentas.operar', ({ body, user }) => D.tx(() => {
  const jor = L.requireJornada();
  const o = D.get('SELECT * FROM cuentas WHERE id=? AND activo=1', body.origen), d = D.get('SELECT * FROM cuentas WHERE id=? AND activo=1', body.destino);
  if (!o || !d || o.id === d.id) err(400, 'Selecciona dos cuentas activas distintas');
  const monto = num(body.monto, 'Monto inválido', 0.01);
  const usd = L.aUSD(monto, o.moneda, jor);
  const montoDestino = o.moneda === d.moneda ? monto : L.deUSD(usd, d.moneda, jor);
  L.cuentaMov(o.id, -monto, -usd, 'transferencia_interna', { referencia: s(body.referencia), usuario: user.usuario, jornada_id: jor.id, nota: 'A ' + d.nombre });
  L.cuentaMov(d.id, montoDestino, usd, 'transferencia_interna', { referencia: s(body.referencia), usuario: user.usuario, jornada_id: jor.id, nota: 'Desde ' + o.nombre });
  L.audit(user.usuario, 'transferencia_interna', 'cuenta', o.id, { destino: d.id, monto, montoDestino });
  return { ok: true, monto_destino: montoDestino };
}));

staff('GET', '/api/cajas', null, () => D.all('SELECT * FROM cajas ORDER BY nombre').map((c) => ({
  ...c, turno: D.get("SELECT id, usuario, abierta_en FROM caja_turnos WHERE caja_id=? AND estado='abierta'", c.id) || null })));
staff('POST', '/api/cajas', 'parametros.editar', ({ body }) => ({ id: D.insert('INSERT INTO cajas(nombre) VALUES(?)', req(body.nombre, 'Indica el nombre')) }));

const medioApp = (b) => {
  if (!['pago_movil', 'transferencia', 'efectivo', 'punto'].includes(b.medio)) err(400, 'Medio no válido');
  if (!L.MONEDAS.includes(b.moneda || 'VES')) err(400, 'Moneda no válida');
  const c = D.get('SELECT * FROM cuentas WHERE id=?', b.cuenta_id);
  if (!c) err(400, 'Selecciona la cuenta financiera destino');
  if (c.moneda !== (b.moneda || 'VES')) err(400, `La cuenta destino es ${c.moneda}`);
  if (b.medio === 'efectivo' && c.tipo !== 'caja') err(400, 'El efectivo debe apuntar a una caja de efectivo');
  if (b.medio !== 'efectivo' && c.tipo === 'caja') err(400, 'Este medio debe apuntar a un banco, no a una caja de efectivo');
  if (['efectivo', 'punto'].includes(b.medio)) {
    const banco = s(b.banco) || (b.medio === 'efectivo' ? 'Efectivo al recibir' : 'Punto de venta inalámbrico');
    return [b.medio, banco, c.id, null, null, null, null, null, null, b.moneda || 'VES', s(b.observacion), ['publicado', 'oculto', 'inactivo'].includes(b.estado) ? b.estado : 'publicado'];
  }
  if (b.medio === 'pago_movil') { req(b.documento, 'Indica el documento'); req(b.telefono, 'Indica el teléfono'); if (!['V', 'J', 'G', 'E'].includes(b.tipo_doc)) err(400, 'Tipo de documento: V, J, G o E'); }
  else { req(b.num_cuenta, 'Indica el número de cuenta'); req(b.titular, 'Indica el titular'); req(b.documento, 'Indica el documento del titular'); }
  return [b.medio, req(b.banco, 'Indica el banco receptor'), c.id, s(b.tipo_doc), s(b.documento), s(b.telefono), s(b.titular), s(b.num_cuenta), s(b.tipo_cuenta), b.moneda || 'VES', s(b.observacion), ['publicado', 'oculto', 'inactivo'].includes(b.estado) ? b.estado : 'publicado'];
};
staff('GET', '/api/medios-app', null, () => D.all('SELECT m.*, c.nombre AS cuenta FROM medios_pago_app m JOIN cuentas c ON c.id=m.cuenta_id ORDER BY m.id'));
staff('POST', '/api/medios-app', 'parametros.editar', ({ body, user }) => {
  const id = D.insert(`INSERT INTO medios_pago_app(medio,banco,cuenta_id,tipo_doc,documento,telefono,titular,num_cuenta,tipo_cuenta,moneda,observacion,estado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, ...medioApp(body));
  L.audit(user.usuario, 'medio_pago_app_creado', 'medio_pago_app', id, body);
  return { id };
});
staff('PUT', '/api/medios-app/:id', 'parametros.editar', ({ params, body, user }) => {
  const antes = D.get('SELECT * FROM medios_pago_app WHERE id=?', params.id);
  if (!antes) err(404, 'No encontrado');
  D.run(`UPDATE medios_pago_app SET medio=?,banco=?,cuenta_id=?,tipo_doc=?,documento=?,telefono=?,titular=?,num_cuenta=?,tipo_cuenta=?,moneda=?,observacion=?,estado=? WHERE id=?`, ...medioApp(body), antes.id);
  L.audit(user.usuario, 'medio_pago_app_editado', 'medio_pago_app', antes.id, { antes, despues: body });
  return { ok: true };
});

// =====================================================================
// JORNADA OPERATIVA
// =====================================================================
// Tasas del día: Bs por 1 USD y, del euro, o bien Bs por 1 EUR (tasa_eur_ves, como la publica el BCV) o USD por 1 EUR (tasa_eur_usd).
function leerTasas(body) {
  const ves = num(body.tasa_usd_ves, 'Indica la tasa de Bs por 1 USD', 0.0001);
  const eurVes = body.tasa_eur_ves != null && body.tasa_eur_ves !== '' ? num(body.tasa_eur_ves, 'Indica la tasa de Bs por 1 EUR', 0.0001) : null;
  const eur = Math.round((eurVes != null ? eurVes / ves : num(body.tasa_eur_usd, 'Indica la tasa del euro (Bs por 1 EUR)', 0.0001)) * 1e6) / 1e6;
  if (eur < 0.3 || eur > 3) err(400, `La tasa del euro no es coherente: equivale a ${eur.toLocaleString('es-VE')} USD por cada euro (lo normal está cerca de 1). Escribe los bolívares por 1 € tal como los publica el BCV.`);
  return { ves, eur };
}
staff('GET', '/api/jornada', null, () => ({ jornada: L.jornadaAbierta(), ultima: L.ultimaTasa(), tasa_hoy: D.get('SELECT * FROM tasas_cambio WHERE fecha=?', D.hoy()) || null }));
staff('GET', '/api/jornadas', 'jornada.gestionar', () => D.all('SELECT * FROM jornadas ORDER BY id DESC LIMIT 60'));
staff('POST', '/api/jornada/abrir', 'jornada.gestionar', ({ body, user }) => D.tx(() => {
  if (L.jornadaAbierta()) err(409, 'Ya hay un día operativo abierto');
  const { ves, eur } = leerTasas(body);
  const fecha = D.hoy();
  const id = D.insert(`INSERT INTO jornadas(fecha,estado,tasa_usd_ves,tasa_eur_usd,fuente,obs,usuario_apertura,abierta_en) VALUES(?,?,?,?,?,?,?,?)`,
    fecha, 'abierta', ves, eur, s(body.fuente) || 'BCV', s(body.obs), user.usuario, D.ahora());
  guardarTasaFecha(fecha, ves, eur, s(body.fuente) || 'BCV', user.usuario);
  D.insert('INSERT INTO tasas_log(jornada_id,fecha,usuario,tasa_usd_ves,tasa_eur_usd,fuente,motivo) VALUES(?,?,?,?,?,?,?)', id, D.ahora(), user.usuario, ves, eur, s(body.fuente) || 'BCV', 'Apertura del día ' + fecha);
  L.audit(user.usuario, 'jornada_abierta', 'jornada', id, { fecha, ves, eur });
  return { id };
}));
// Cada tasa pertenece a una fecha. Si la fecha es la del día operativo abierto, también cambia la tasa con la que se vende desde ese momento.
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function guardarTasaFecha(fecha, ves, eur, fuente, usuario) {
  const ya = D.get('SELECT fecha FROM tasas_cambio WHERE fecha=?', fecha);
  if (ya) D.run('UPDATE tasas_cambio SET tasa_usd_ves=?, tasa_eur_usd=?, fuente=?, usuario=?, actualizada_en=? WHERE fecha=?', ves, eur, fuente, usuario, D.ahora(), fecha);
  else D.run('INSERT INTO tasas_cambio(fecha,tasa_usd_ves,tasa_eur_usd,fuente,usuario,registrada_en) VALUES(?,?,?,?,?,?)', fecha, ves, eur, fuente, usuario, D.ahora());
  return !!ya;
}
function registrarTasa(body, user) {
  const j = L.jornadaAbierta();
  const fecha = String(body.fecha || (j && j.fecha) || '').trim();
  if (!FECHA_RE.test(fecha) || Number.isNaN(Date.parse(fecha))) err(400, 'Indica la fecha a la que corresponde la tasa');
  if (fecha > D.sumarDias(7)) err(400, 'La fecha no puede pasar de 7 días en el futuro');
  const { ves, eur } = leerTasas(body);
  const fuente = s(body.fuente) || 'BCV';
  const existente = D.get('SELECT * FROM tasas_cambio WHERE fecha=?', fecha);
  const motivo = s(body.motivo);
  if ((existente || fecha < D.hoy()) && !motivo) err(400, existente ? 'Esa fecha ya tiene tasa: indica el motivo del cambio' : 'La fecha es anterior a hoy: indica el motivo');
  guardarTasaFecha(fecha, ves, eur, fuente, user.usuario);
  const esDelDia = !!(j && j.fecha === fecha);
  if (esDelDia) D.run('UPDATE jornadas SET tasa_usd_ves=?, tasa_eur_usd=?, fuente=? WHERE id=?', ves, eur, fuente, j.id);
  D.insert('INSERT INTO tasas_log(jornada_id,fecha,usuario,tasa_usd_ves,tasa_eur_usd,fuente,motivo) VALUES(?,?,?,?,?,?,?)', esDelDia ? j.id : null, D.ahora(), user.usuario, ves, eur, fuente, `[${fecha}] ${motivo || 'Tasa registrada'}`);
  L.audit(user.usuario, 'tasa_registrada', 'tasa', fecha, { antes: existente ? [existente.tasa_usd_ves, existente.tasa_eur_usd] : null, despues: [ves, eur], motivo });
  return { ok: true, fecha, actualiza_el_dia_abierto: esDelDia };
}
staff('POST', '/api/jornada/tasas', 'jornada.gestionar', ({ body, user }) => D.tx(() => { L.requireJornada(); return registrarTasa({ ...body, fecha: body.fecha || L.jornadaAbierta().fecha }, user); }));
staff('POST', '/api/tasas', 'jornada.gestionar', ({ body, user }) => D.tx(() => registrarTasa(body, user)));
staff('GET', '/api/tasas', null, ({ query }) => {
  const hoy = D.hoy();
  const lista = D.all('SELECT * FROM tasas_cambio ORDER BY fecha DESC LIMIT 400').slice(0, Math.min(Number(query.limite) || 60, 400));
  const j = L.jornadaAbierta();
  // fechas sin tasa desde el primer registro hasta hoy (días en que no se operó o no se cargó)
  const todas = new Set(D.all('SELECT fecha FROM tasas_cambio').map((x) => x.fecha));
  const primera = D.get('SELECT MIN(fecha) AS f FROM tasas_cambio').f;
  const faltan = [];
  if (primera) for (let d = primera; d < hoy && faltan.length < 60; d = D.sumarDias(1, d)) if (!todas.has(d)) faltan.push(d);
  return { hoy, tasa_hoy: D.get('SELECT * FROM tasas_cambio WHERE fecha=?', hoy) || null, ultima: D.get('SELECT * FROM tasas_cambio WHERE fecha<=? ORDER BY fecha DESC LIMIT 1', hoy) || null,
    jornada_fecha: j ? j.fecha : null, desactualizada: !!(j && j.fecha < hoy), lista, fechas_sin_tasa: faltan };
});
staff('GET', '/api/jornada/tasas-log', 'jornada.gestionar', () => D.all('SELECT * FROM tasas_log ORDER BY id DESC LIMIT 100'));
staff('GET', '/api/jornada/pre-cierre', 'jornada.gestionar', () => preCierre());
function preCierre() {
  const j = L.jornadaAbierta();
  if (!j) return null;
  const cajas = D.all("SELECT t.id, t.usuario, c.nombre FROM caja_turnos t JOIN cajas c ON c.id=t.caja_id WHERE t.estado='abierta'");
  const pendientes = D.get("SELECT COUNT(*) AS n FROM pagos_reportados WHERE estado='pendiente'").n;
  const v = D.get("SELECT COUNT(*) AS n, COALESCE(SUM(total_usd),0) AS total FROM ventas WHERE jornada_id=? AND estado='completada'", j.id);
  const porMedio = D.all("SELECT medio, moneda, SUM(monto) AS monto, SUM(monto_usd) AS usd FROM pagos WHERE jornada_id=? AND anulado=0 AND tipo='venta' GROUP BY medio, moneda", j.id);
  const cobros = D.get("SELECT COALESCE(SUM(monto_usd),0) AS t FROM pagos WHERE jornada_id=? AND tipo='cobro' AND anulado=0", j.id).t;
  const compras = D.get("SELECT COALESCE(SUM(total_usd),0) AS t, COUNT(*) AS n FROM compras WHERE jornada_id=? AND estado='recibida'", j.id);
  const pagosProv = D.get("SELECT COALESCE(SUM(monto_usd),0) AS t FROM cxp_pagos WHERE fecha>=?", j.abierta_en).t;
  const dif = D.get('SELECT COALESCE(SUM(diferencia_usd),0) AS t FROM caja_turnos WHERE jornada_id=?', j.id).t;
  return { jornada: j, cajas_abiertas: cajas, pagos_app_pendientes: pendientes, ventas: v, por_medio: porMedio, cobros_usd: r2(cobros), compras, pagos_proveedores_usd: r2(pagosProv), diferencia_caja_usd: r2(dif) };
}
staff('POST', '/api/jornada/cerrar', 'jornada.gestionar', ({ body, user }) => D.tx(() => {
  const j = L.requireJornada();
  const pc = preCierre();
  if (pc.cajas_abiertas.length) err(409, 'Hay cajas abiertas: ciérralas antes de cerrar el día (' + pc.cajas_abiertas.map((c) => c.nombre).join(', ') + ')');
  if (pc.pagos_app_pendientes && !body.forzar) err(409, `Hay ${pc.pagos_app_pendientes} pago(s) de la app pendientes de validar. Valídalos o confirma el cierre igualmente.`);
  D.run("UPDATE jornadas SET estado='cerrada', cerrada_en=?, usuario_cierre=?, resumen=?, obs=COALESCE(?,obs) WHERE id=?", D.ahora(), user.usuario, JSON.stringify(pc), s(body.obs), j.id);
  L.audit(user.usuario, 'jornada_cerrada', 'jornada', j.id, pc.ventas);
  return { ok: true, resumen: pc };
}));

// =====================================================================
// CATÁLOGO: categorías, proveedores, productos
// =====================================================================
staff('GET', '/api/categorias', null, () => D.all('SELECT * FROM categorias ORDER BY nombre'));
staff('POST', '/api/categorias', 'productos.editar', ({ body }) => {
  const n = req(body.nombre, 'Indica el nombre');
  if (D.get('SELECT id FROM categorias WHERE nombre=?', n)) err(409, 'La categoría ya existe');
  return { id: D.insert('INSERT INTO categorias(nombre) VALUES(?)', n) };
});
staff('PUT', '/api/categorias/:id', 'productos.editar', ({ params, body }) => {
  D.run('UPDATE categorias SET nombre=COALESCE(?,nombre), activo=COALESCE(?,activo) WHERE id=?', s(body.nombre), body.activo == null ? null : bool(body.activo), params.id);
  return { ok: true };
});

staff('GET', '/api/proveedores', null, ({ query }) => {
  const w = [], a = [];
  if (query.q) { w.push('(nombre LIKE ? OR rif LIKE ?)'); a.push(like(query.q), like(query.q)); }
  if (query.activo) { w.push('activo=?'); a.push(Number(query.activo)); }
  return D.all(`SELECT *, (SELECT COALESCE(SUM(saldo_usd),0) FROM cxp WHERE proveedor_id=proveedores.id AND estado IN ('pendiente','abonada')) AS deuda_usd
                FROM proveedores ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY nombre`, ...a);
});
const provArgs = (b) => [req(b.nombre, 'Indica el nombre del proveedor'), s(b.rif), s(b.telefono), s(b.correo), s(b.direccion), s(b.contacto), Number(b.dias_credito) || 0, Math.max(1, Math.min(60, Math.round(Number(b.plazo_entrega)) || 3))];
staff('POST', '/api/proveedores', 'proveedores.editar', ({ body, user }) => {
  const id = D.insert('INSERT INTO proveedores(nombre,rif,telefono,correo,direccion,contacto,dias_credito,plazo_entrega) VALUES(?,?,?,?,?,?,?,?)', ...provArgs(body));
  L.audit(user.usuario, 'proveedor_creado', 'proveedor', id, body.nombre);
  return { id };
});
staff('PUT', '/api/proveedores/:id', 'proveedores.editar', ({ params, body }) => {
  if (!D.get('SELECT id FROM proveedores WHERE id=?', params.id)) err(404, 'No encontrado');
  D.run('UPDATE proveedores SET nombre=?,rif=?,telefono=?,correo=?,direccion=?,contacto=?,dias_credito=?,plazo_entrega=?,activo=? WHERE id=?', ...provArgs(body), bool(body.activo ?? 1), params.id);
  return { ok: true };
});
staff('GET', '/api/proveedores/:id/historial', null, ({ params }) => ({
  compras: D.all("SELECT id,numero,fecha,estado,condicion,moneda,total_moneda,total_usd FROM compras WHERE proveedor_id=? ORDER BY id DESC LIMIT 100", params.id),
  cxp: D.all('SELECT * FROM cxp WHERE proveedor_id=? ORDER BY id DESC', params.id)
}));

staff('GET', '/api/productos', null, ({ query }) => {
  const w = [], a = [];
  if (query.q) { w.push('(p.nombre LIKE ? OR p.codigo LIKE ? OR EXISTS(SELECT 1 FROM codigos_barra b WHERE b.producto_id=p.id AND b.codigo LIKE ?))'); a.push(like(query.q), like(query.q), like(query.q)); }
  if (query.categoria_id) { w.push('p.categoria_id=?'); a.push(Number(query.categoria_id)); }
  if (query.activo != null && query.activo !== '') { w.push('p.activo=?'); a.push(Number(query.activo)); }
  let rows = D.all(`${SQL_PRODUCTO} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.nombre LIMIT 1000`, ...a).map(conStock);
  if (query.bajo_minimo) rows = rows.filter((p) => p.stock_min > 0 && p.stock <= p.stock_min);
  return rows;
});
staff('GET', '/api/productos/barra/:codigo', 'ventas.crear', ({ params }) => {
  const p = D.get(`${SQL_PRODUCTO} WHERE p.activo=1 AND (p.id=(SELECT producto_id FROM codigos_barra WHERE codigo=?) OR p.codigo=?)`, params.codigo, params.codigo);
  if (!p) err(404, 'Código no registrado: ' + params.codigo);
  return conStock(p);
});
staff('GET', '/api/productos/:id', null, ({ params }) => {
  const p = D.get(`${SQL_PRODUCTO} WHERE p.id=?`, params.id);
  if (!p) err(404, 'Producto no encontrado');
  return { ...conStock(p), codigos: D.all('SELECT codigo, principal FROM codigos_barra WHERE producto_id=? ORDER BY principal DESC', p.id).map((c) => c.codigo) };
});
function datosProducto(b, previo) {
  const op = D.param('operacion');
  const nombre = req(b.nombre ?? previo?.nombre, 'Indica el nombre del producto');
  const costo = b.costo_usd != null ? num(b.costo_usd, 'Costo inválido', 0) : (previo?.costo_usd ?? 0);
  const margen = b.margen != null ? num(b.margen, 'Margen inválido', 0) : (previo?.margen ?? op.margen_defecto);
  const fijo = b.precio_fijo != null ? bool(b.precio_fijo) : (previo?.precio_fijo ?? 1);
  let precio = b.precio_usd != null ? num(b.precio_usd, 'Precio inválido', 0) : (previo?.precio_usd ?? 0);
  if (!fijo) precio = L.precioPorMargen(costo, margen);
  const factor = b.factor != null ? num(b.factor, 'El factor de conversión debe ser mayor a 0', 0.0001) : (previo?.factor ?? 1);
  return {
    nombre, costo, margen, fijo, precio, factor,
    categoria_id: b.categoria_id !== undefined ? (b.categoria_id || null) : (previo?.categoria_id ?? null),
    marca: b.marca !== undefined ? s(b.marca) : (previo?.marca ?? null), presentacion: b.presentacion !== undefined ? s(b.presentacion) : (previo?.presentacion ?? null),
    uc: s(b.unidad_compra) || previo?.unidad_compra || 'unidad', uv: s(b.unidad_venta) || previo?.unidad_venta || 'unidad',
    smin: b.stock_min != null ? num(b.stock_min, 'Stock mínimo inválido', 0) : (previo?.stock_min ?? 0),
    smax: b.stock_max != null ? num(b.stock_max, 'Stock máximo inválido', 0) : (previo?.stock_max ?? 0),
    ubicacion: b.ubicacion !== undefined ? s(b.ubicacion) : (previo?.ubicacion ?? null), proveedor_id: b.proveedor_id !== undefined ? (b.proveedor_id || null) : (previo?.proveedor_id ?? null),
    imagen: b.imagen !== undefined ? s(b.imagen) : (previo?.imagen ?? null)
  };
}
function limiteProductos(nuevos = 1) {
  const lim = P.licencia(D.slugActual()).max_productos;
  if (D.get('SELECT COUNT(*) AS n FROM productos').n + nuevos > lim) err(402, `Tu plan permite hasta ${lim} productos. Amplía el plan para agregar más.`);
}
staff('POST', '/api/productos', 'productos.editar', ({ body, user }) => D.tx(() => {
  limiteProductos();
  const d = datosProducto(body);
  let codigo = s(body.codigo);
  if (!codigo) codigo = D.siguiente('producto', 'PROD', 4);
  if (D.get('SELECT id FROM productos WHERE codigo=?', codigo)) err(409, 'El código interno ya existe');
  const id = D.insert(`INSERT INTO productos(codigo,nombre,categoria_id,marca,presentacion,unidad_compra,unidad_venta,factor,costo_usd,precio_usd,margen,precio_fijo,stock_min,stock_max,ubicacion,proveedor_id,imagen,creado)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, codigo, d.nombre, d.categoria_id, d.marca, d.presentacion, d.uc, d.uv, d.factor, d.costo, d.precio, d.margen, d.fijo, d.smin, d.smax, d.ubicacion, d.proveedor_id, d.imagen, D.ahora());
  guardarBarras(id, body.codigos || (body.codigo_barra ? [body.codigo_barra] : []));
  const ini = Number(body.stock_inicial) || 0;
  if (ini > 0) L.mov(id, 'inventario_inicial', ini, d.costo, 'Inventario inicial', 'producto', id, user.usuario, L.jornadaAbierta()?.id);
  L.audit(user.usuario, 'producto_creado', 'producto', id, { codigo, nombre: d.nombre, precio: d.precio });
  return { id, codigo };
}));
staff('PUT', '/api/productos/:id', 'productos.editar', ({ params, body, user, perms }) => D.tx(() => {
  const p = D.get('SELECT * FROM productos WHERE id=?', params.id);
  if (!p) err(404, 'Producto no encontrado');
  const d = datosProducto(body, p);
  const cambiaPrecio = d.precio !== p.precio_usd || d.costo !== p.costo_usd || d.margen !== p.margen || d.fijo !== p.precio_fijo;
  if (cambiaPrecio && !perms.has('precio.cambiar')) err(403, 'No tienes permiso para cambiar precios, costos o márgenes');
  D.run(`UPDATE productos SET nombre=?,categoria_id=?,marca=?,presentacion=?,unidad_compra=?,unidad_venta=?,factor=?,costo_usd=?,precio_usd=?,margen=?,precio_fijo=?,stock_min=?,stock_max=?,ubicacion=?,proveedor_id=?,imagen=?,activo=? WHERE id=?`,
    d.nombre, d.categoria_id, d.marca, d.presentacion, d.uc, d.uv, d.factor, d.costo, d.precio, d.margen, d.fijo, d.smin, d.smax, d.ubicacion, d.proveedor_id, d.imagen, body.activo == null ? p.activo : bool(body.activo), p.id);
  if (body.codigos) guardarBarras(p.id, body.codigos);
  // un cambio manual del costo queda en el kardex como revalorización: el saldo pasa a valer al costo nuevo
  if (d.costo !== p.costo_usd) L.mov(p.id, 'revalorizacion', 0, d.costo, 'Cambio manual del costo', 'producto', p.id, user.usuario, L.jornadaAbierta()?.id);
  if (cambiaPrecio) L.audit(user.usuario, 'cambio_precio_costo', 'producto', p.id, { antes: { costo: p.costo_usd, precio: p.precio_usd, margen: p.margen }, despues: { costo: d.costo, precio: d.precio, margen: d.margen } });
  return { ok: true };
}));
// Kardex valorizado al costo promedio: cada fila trae el costo con el que se valoró el movimiento y el saldo (existencia, costo promedio y valor) que dejó
staff('GET', '/api/productos/:id/kardex', null, ({ params }) => {
  const p = D.get('SELECT id, codigo, nombre, costo_usd FROM productos WHERE id=?', params.id);
  if (!p) err(404, 'Producto no encontrado');
  const filas = D.all('SELECT * FROM inventario_movimientos WHERE producto_id=? ORDER BY id', p.id)
    .map((m) => ({ ...m, valor_usd: r4(m.cantidad * m.costo_usd), saldo: m.saldo_cant }));
  const ult = filas[filas.length - 1];
  return {
    producto: p, existencia: ult ? ult.saldo_cant : 0, costo_promedio: ult ? ult.costo_prom : p.costo_usd, valor_usd: ult ? r2(ult.saldo_valor) : 0,
    movimientos: filas.reverse()
  };
});

// ---- importación CSV ----
function parseCSV(texto) {
  const filas = []; let fila = [], cel = '', q = false;
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else q = false; } else cel += c; }
    else if (c === '"') q = true;
    else if (c === sep) { fila.push(cel); cel = ''; }
    else if (c === '\n') { fila.push(cel); filas.push(fila); fila = []; cel = ''; }
    else if (c !== '\r') cel += c;
  }
  if (cel !== '' || fila.length) { fila.push(cel); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}
staff('POST', '/api/productos/importar', 'productos.editar', ({ body, user }) => {
  const filas = parseCSV(String(body.csv || ''));
  limiteProductos(0);
  if (filas.length < 2) err(400, 'El archivo no tiene filas');
  const cab = filas[0].map((h) => h.trim().toLowerCase());
  const col = (n) => cab.indexOf(n);
  if (col('nombre') < 0) err(400, 'Falta la columna "nombre"');
  const res = { creados: 0, actualizados: 0, errores: [] };
  filas.slice(1).forEach((f, i) => {
    const v = (n) => (col(n) >= 0 ? (f[col(n)] || '').trim() : '');
    try {
      D.tx(() => {
        const nombre = req(v('nombre'), 'nombre vacío');
        let cat = null;
        if (v('categoria')) { const c = D.get('SELECT id FROM categorias WHERE nombre=?', v('categoria')); cat = c ? c.id : D.insert('INSERT INTO categorias(nombre) VALUES(?)', v('categoria')); }
        let prov = null;
        if (v('proveedor_principal')) { const c = D.get('SELECT id FROM proveedores WHERE nombre=?', v('proveedor_principal')); prov = c ? c.id : D.insert('INSERT INTO proveedores(nombre) VALUES(?)', v('proveedor_principal')); }
        const barra = v('codigo_barra');
        const interno = v('codigo_interno');
        let ex = (interno && D.get('SELECT * FROM productos WHERE codigo=?', interno)) || (barra && D.get('SELECT p.* FROM productos p JOIN codigos_barra b ON b.producto_id=p.id WHERE b.codigo=?', barra)) || null;
        const dat = {
          nombre, categoria_id: cat, marca: v('marca'), presentacion: v('presentacion'), unidad_compra: v('unidad_compra') || 'unidad', unidad_venta: v('unidad_venta') || 'unidad',
          factor: v('factor_conversion') || 1, costo_usd: v('costo_usd') || 0, precio_usd: v('precio_venta_usd') || 0, margen: v('margen_utilidad') || D.param('operacion').margen_defecto,
          precio_fijo: v('precio_fijo') ? bool(v('precio_fijo').toLowerCase()) : 1, stock_min: v('stock_minimo') || 0, stock_max: v('stock_maximo') || 0, ubicacion: v('ubicacion'), proveedor_id: prov
        };
        const d = datosProducto(dat, ex || undefined);
        if (ex) {
          D.run(`UPDATE productos SET nombre=?,categoria_id=?,marca=?,presentacion=?,unidad_compra=?,unidad_venta=?,factor=?,costo_usd=?,precio_usd=?,margen=?,precio_fijo=?,stock_min=?,stock_max=?,ubicacion=?,proveedor_id=? WHERE id=?`,
            d.nombre, d.categoria_id, d.marca, d.presentacion, d.uc, d.uv, d.factor, d.costo, d.precio, d.margen, d.fijo, d.smin, d.smax, d.ubicacion, d.proveedor_id, ex.id);
          if (barra && !D.get('SELECT 1 FROM codigos_barra WHERE codigo=?', barra)) D.run('INSERT INTO codigos_barra(codigo,producto_id,principal) VALUES(?,?,0)', barra, ex.id);
          if (d.costo !== ex.costo_usd) L.mov(ex.id, 'revalorizacion', 0, d.costo, 'Cambio de costo por importación CSV', 'producto', ex.id, user.usuario, null);
          res.actualizados++;
        } else {
          limiteProductos();
          const codigo = interno || D.siguiente('producto', 'PROD', 4);
          const id = D.insert(`INSERT INTO productos(codigo,nombre,categoria_id,marca,presentacion,unidad_compra,unidad_venta,factor,costo_usd,precio_usd,margen,precio_fijo,stock_min,stock_max,ubicacion,proveedor_id,creado)
                               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, codigo, d.nombre, d.categoria_id, d.marca, d.presentacion, d.uc, d.uv, d.factor, d.costo, d.precio, d.margen, d.fijo, d.smin, d.smax, d.ubicacion, d.proveedor_id, D.ahora());
          if (barra) guardarBarras(id, [barra]);
          const ini = Number(v('stock_actual')) || 0;
          if (ini > 0) L.mov(id, 'inventario_inicial', ini, d.costo, 'Carga inicial CSV', 'producto', id, user.usuario, null);
          res.creados++;
        }
      });
    } catch (e) { res.errores.push(`Fila ${i + 2}: ${e.message}`); }
  });
  L.audit(user.usuario, 'productos_importados', 'producto', null, { creados: res.creados, actualizados: res.actualizados, errores: res.errores.length });
  return res;
});

// ---- inventario ----
staff('GET', '/api/inventario', null, ({ query }) => {
  let rows = D.all(`${SQL_PRODUCTO} WHERE p.activo=1 ORDER BY p.nombre`).map(conStock).map((p) => ({ ...p, valor_usd: r2(Math.max(0, p.stock) * p.costo_usd), bajo_minimo: p.stock_min > 0 && p.stock <= p.stock_min }));
  if (query.bajo_minimo) rows = rows.filter((p) => p.bajo_minimo);
  return rows;
});
staff('POST', '/api/inventario/ajuste', 'inventario.ajustar', ({ body, user }) => D.tx(() => {
  const p = D.get('SELECT * FROM productos WHERE id=?', body.producto_id);
  if (!p) err(404, 'Producto no encontrado');
  const cant = num(body.cantidad, 'Cantidad inválida');
  if (cant === 0) err(400, 'La cantidad no puede ser cero');
  if (!['ajuste', 'merma', 'consumo_interno'].includes(body.tipo)) err(400, 'Tipo no válido');
  const motivo = req(body.motivo, 'Indica el motivo');
  if (body.tipo !== 'ajuste' && cant > 0) err(400, 'Mermas y consumos deben ser cantidades negativas');
  if (L.stockDe(p.id) + cant < 0 && !D.param('operacion').stock_negativo) err(409, 'El ajuste dejaría el stock en negativo');
  const id = L.mov(p.id, body.tipo, cant, p.costo_usd, motivo, 'ajuste', null, user.usuario, L.jornadaAbierta()?.id);
  L.audit(user.usuario, 'ajuste_inventario', 'producto', p.id, { tipo: body.tipo, cantidad: cant, motivo });
  return { id };
}));

// =====================================================================
// CLIENTES, CRÉDITO, CxC
// =====================================================================
const SQL_CLIENTE = `SELECT c.id,c.nombre,c.documento,c.telefono,c.direccion,c.credito_habilitado,c.limite_usd,c.dias_credito,c.estado,c.creado,
  (c.pin_hash IS NOT NULL) AS tiene_app,
  COALESCE((SELECT SUM(saldo_usd) FROM cxc WHERE cliente_id=c.id AND estado IN ('pendiente','abonada')),0) AS deuda_usd,
  COALESCE((SELECT SUM(saldo_usd) FROM cxc WHERE cliente_id=c.id AND estado IN ('pendiente','abonada') AND vence<?),0) AS vencido_usd FROM clientes c`;
staff('GET', '/api/clientes', null, ({ query }) => {
  const w = [], a = [D.hoy()];
  if (query.q) { w.push('(c.nombre LIKE ? OR c.documento LIKE ? OR c.telefono LIKE ?)'); a.push(like(query.q), like(query.q), like(query.q)); }
  if (query.con_credito) w.push('c.credito_habilitado=1');
  return D.all(`${SQL_CLIENTE} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY c.nombre LIMIT 500`, ...a);
});
// Búsqueda exacta por cédula o RIF (con o sin letra, con o sin guiones); la usa el punto de venta al identificar al cliente
staff('GET', '/api/clientes/por-documento', null, ({ query }) => {
  const n = normalizarDocumento(query.doc);
  if (!n || n.replace(/\D/g, '').length < 5) err(400, 'Escribe la cédula o el RIF completo');
  const f = clientePorDocumento(n);
  return { documento: n, cliente: f ? D.get(`${SQL_CLIENTE} WHERE c.id=?`, D.hoy(), f.id) : null };
});
// Estado de cuenta del cliente: lo que debe, cada factura a crédito con sus cobros y el historial de movimientos con saldo corriente
// ---- Recordatorios de saldos vencidos ----
// El sistema arma el mensaje (con lo que debe, las facturas y su vencimiento) y registra cada recordatorio; el envío se hace por WhatsApp desde el teléfono de quien cobra.
function vencidosDe(clienteId) {
  return D.all(`SELECT x.id, x.vence, x.saldo_usd, v.numero AS venta FROM cxc x LEFT JOIN ventas v ON v.id=x.venta_id
    WHERE x.cliente_id=? AND x.estado IN ('pendiente','abonada') AND x.vence<? ORDER BY x.vence, x.id`, clienteId, D.hoy());
}
function mensajeRecordatorio(c, facturas) {
  const emp = D.param('empresa'), t = L.jornadaAbierta() || L.ultimaTasa();
  const total = r2(facturas.reduce((a, f) => a + f.saldo_usd, 0));
  const ves = t ? r2(total * t.tasa_usd_ves) : null;
  const lista = facturas.map((f) => `${f.venta || 'factura'} (venció el ${f.vence}, saldo ${r2(f.saldo_usd).toFixed(2)} USD)`).join('; ');
  return `Hola ${c.nombre}, le escribimos de ${emp.nombre}. Le recordamos que tiene ${facturas.length === 1 ? 'una cuenta vencida' : facturas.length + ' cuentas vencidas'} por ${total.toFixed(2)} USD${ves ? ` (unos ${ves.toLocaleString('es-VE', { minimumFractionDigits: 2 })} Bs a la tasa de hoy)` : ''}: ${lista}. Le agradecemos regularizar su pago. Si ya lo hizo, envíenos el comprobante. ¡Gracias!`;
}
staff('GET', '/api/cxc/vencidos', null, () => {
  const hoy = D.hoy();
  const dif = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
  const clientes = D.all(`SELECT c.id, c.nombre, c.documento, c.telefono FROM clientes c WHERE EXISTS (SELECT 1 FROM cxc x WHERE x.cliente_id=c.id AND x.estado IN ('pendiente','abonada') AND x.vence<?) ORDER BY c.nombre`, hoy).map((c) => {
    const fs = vencidosDe(c.id);
    const ult = D.get('SELECT fecha FROM recordatorios WHERE cliente_id=? ORDER BY id DESC LIMIT 1', c.id);
    return { ...c, vencido_usd: r2(fs.reduce((a, f) => a + f.saldo_usd, 0)), facturas: fs.length, dias_max: dif(hoy, fs[0].vence), ultimo_recordatorio: ult ? ult.fecha : null, mensaje: mensajeRecordatorio(c, fs) };
  }).sort((a, b) => b.vencido_usd - a.vencido_usd);
  return { total_vencido_usd: r2(clientes.reduce((a, c) => a + c.vencido_usd, 0)), clientes };
});
staff('POST', '/api/clientes/:id/recordatorio', 'cobros.crear', ({ params, body, user }) => D.tx(() => {
  const c = D.get('SELECT * FROM clientes WHERE id=?', params.id);
  if (!c) err(404, 'Cliente no encontrado');
  const fs = vencidosDe(c.id);
  if (!fs.length) err(409, 'Este cliente no tiene saldos vencidos');
  const mensaje = req(body.mensaje, 'El mensaje no puede estar vacío');
  const medio = ['whatsapp', 'llamada', 'otro'].includes(body.medio) ? body.medio : 'whatsapp';
  const monto = r2(fs.reduce((a, f) => a + f.saldo_usd, 0));
  const id = D.insert('INSERT INTO recordatorios(cliente_id,fecha,usuario,medio,monto_usd,facturas,mensaje) VALUES(?,?,?,?,?,?,?)', c.id, D.ahora(), user.usuario, medio, monto, fs.map((f) => f.venta).filter(Boolean).join(', '), mensaje);
  L.audit(user.usuario, 'recordatorio_cobro', 'cliente', c.id, { medio, monto_usd: monto });
  return { id, telefono: c.telefono, monto_usd: monto };
}));
staff('GET', '/api/clientes/:id/estado-cuenta', null, ({ params }) => {
  const c = D.get('SELECT * FROM clientes WHERE id=?', params.id);
  if (!c) err(404, 'Cliente no encontrado');
  const hoy = D.hoy();
  const dif = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
  const cxcs = D.all('SELECT x.*, v.numero AS venta, v.total_usd AS venta_total, v.anulada_en FROM cxc x LEFT JOIN ventas v ON v.id=x.venta_id WHERE x.cliente_id=? ORDER BY x.id', c.id);
  const cobros = D.all(`SELECT p.*, v.numero AS venta, cu.nombre AS cuenta FROM pagos p JOIN cxc x ON x.id=p.cxc_id LEFT JOIN ventas v ON v.id=x.venta_id LEFT JOIN cuentas cu ON cu.id=p.cuenta_id
    WHERE x.cliente_id=? AND p.tipo='cobro' AND p.anulado=0 ORDER BY p.fecha, p.id`, c.id);
  const contado = D.all(`SELECT v.id, v.numero, v.fecha, v.total_usd FROM ventas v WHERE v.cliente_id=? AND v.estado='completada' AND NOT EXISTS (SELECT 1 FROM cxc x WHERE x.venta_id=v.id) ORDER BY v.id DESC LIMIT 200`, c.id);
  const cobrosPorCxc = new Map();
  for (const g of cobros) { if (!cobrosPorCxc.has(g.cxc_id)) cobrosPorCxc.set(g.cxc_id, []); cobrosPorCxc.get(g.cxc_id).push({ fecha: g.fecha, medio: g.medio, moneda: g.moneda, monto: g.monto, tasa: g.tasa, monto_usd: g.monto_usd, cuenta: g.cuenta, referencia: g.referencia, usuario: g.usuario }); }

  const mov = [];
  for (const x of cxcs) {
    const parcial = x.venta_total && x.venta_total - x.total_usd > 0.005;
    mov.push({ fecha: x.creado, orden: 0, tipo: 'cargo', doc: x.venta, detalle: `${parcial ? 'la otra parte se pagó al momento · ' : ''}vence ${x.vence}`, cargo: x.total_usd, abono: 0 });
    if (x.estado === 'anulada') mov.push({ fecha: x.anulada_en || x.creado, orden: 2, tipo: 'reverso', doc: x.venta, detalle: 'Venta anulada', cargo: 0, abono: x.total_usd });
  }
  for (const g of cobros) mov.push({ fecha: g.fecha, orden: 1, tipo: 'cobro', doc: g.venta, detalle: `${g.monto} ${g.moneda}${g.moneda !== 'USD' ? ` (tasa ${g.tasa})` : ''} · ${g.medio.replace('_', ' ')}${g.cuenta ? ' en ' + g.cuenta : ''}${g.referencia ? ' · ref. ' + g.referencia : ''}${g.usuario ? ' · ' + g.usuario : ''}`, cargo: 0, abono: g.monto_usd });
  for (const v of contado) mov.push({ fecha: v.fecha, orden: 0, tipo: 'contado', doc: v.numero, detalle: 'no genera deuda', cargo: 0, abono: 0, monto_info: v.total_usd });
  mov.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.orden - b.orden));
  let saldo = 0;
  for (const m of mov) { saldo = r2(saldo + m.cargo - m.abono); m.saldo = saldo; }

  const abiertas = cxcs.filter((x) => ['pendiente', 'abonada'].includes(x.estado));
  const ant = { vigente: 0, d1_30: 0, d31_60: 0, d60_mas: 0 };
  for (const x of abiertas) { const d = dif(hoy, x.vence); ant[d <= 0 ? 'vigente' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : 'd60_mas'] += x.saldo_usd; }
  const plazos = cxcs.filter((x) => x.estado === 'pagada' && cobrosPorCxc.has(x.id)).map((x) => dif(cobrosPorCxc.get(x.id).slice(-1)[0].fecha.slice(0, 10), x.creado.slice(0, 10)));
  const deuda = abiertas.reduce((a, x) => a + x.saldo_usd, 0);
  return {
    cliente: { id: c.id, nombre: c.nombre, documento: c.documento, telefono: c.telefono, direccion: c.direccion, estado: c.estado, credito_habilitado: c.credito_habilitado, limite_usd: c.limite_usd, dias_credito: c.dias_credito },
    resumen: {
      deuda_usd: r2(deuda), vencida_usd: r2(abiertas.filter((x) => x.vence < hoy).reduce((a, x) => a + x.saldo_usd, 0)),
      por_vencer_7d_usd: r2(abiertas.filter((x) => x.vence >= hoy && dif(x.vence, hoy) <= 7).reduce((a, x) => a + x.saldo_usd, 0)), facturas_abiertas: abiertas.length,
      credito_disponible_usd: c.credito_habilitado ? r2(Math.max(0, c.limite_usd - deuda)) : 0,
      ventas_credito_usd: r2(cxcs.filter((x) => x.estado !== 'anulada').reduce((a, x) => a + x.total_usd, 0)), ventas_contado_usd: r2(contado.reduce((a, v) => a + v.total_usd, 0)),
      cobrado_usd: r2(cobros.reduce((a, g) => a + g.monto_usd, 0)), ultima_compra: D.get("SELECT MAX(fecha) AS f FROM ventas WHERE cliente_id=? AND estado='completada'", c.id).f,
      ultimo_cobro: cobros.length ? cobros[cobros.length - 1].fecha : null, dias_promedio_cobro: plazos.length ? r2(plazos.reduce((a, b) => a + b, 0) / plazos.length) : null,
      antiguedad: { vigente: r2(ant.vigente), d1_30: r2(ant.d1_30), d31_60: r2(ant.d31_60), d60_mas: r2(ant.d60_mas) }
    },
    facturas: cxcs.map((x) => ({ id: x.id, venta: x.venta, creado: x.creado, vence: x.vence, estado: x.estado, total_usd: x.total_usd, cobrado_usd: r2(x.total_usd - x.saldo_usd), saldo_usd: x.saldo_usd,
      dias_vencida: ['pendiente', 'abonada'].includes(x.estado) ? Math.max(0, dif(hoy, x.vence)) : 0, cobros: cobrosPorCxc.get(x.id) || [] })).reverse(),
    recordatorios: D.all('SELECT fecha, usuario, medio, monto_usd, mensaje FROM recordatorios WHERE cliente_id=? ORDER BY id DESC LIMIT 10', c.id),
    mensaje_recordatorio: vencidosDe(c.id).length ? mensajeRecordatorio(c, vencidosDe(c.id)) : null,
    movimientos: mov
  };
});
staff('GET', '/api/clientes/:id', null, ({ params }) => {
  const c = D.get(`${SQL_CLIENTE} WHERE c.id=?`, D.hoy(), params.id);
  if (!c) err(404, 'Cliente no encontrado');
  return { ...c, cxc: D.all('SELECT x.*, v.numero AS venta FROM cxc x LEFT JOIN ventas v ON v.id=x.venta_id WHERE x.cliente_id=? ORDER BY x.id DESC', c.id),
    ventas: D.all("SELECT id,numero,fecha,total_usd,estado FROM ventas WHERE cliente_id=? ORDER BY id DESC LIMIT 30", c.id) };
});
// Cédula o RIF en forma única: V-12345678, J-123456789 (con letra) o solo dígitos si no se indicó la letra
function normalizarDocumento(d) {
  const t = String(d == null ? '' : d).toUpperCase().replace(/[\s.,]/g, '');
  if (!t) return null;
  const m = t.match(/^([VEJGPC])-?(\d[\d-]*)$/);
  return m ? m[1] + '-' + m[2].replace(/-/g, '') : t.replace(/-/g, '') || null;
}
const SQL_DOC = "REPLACE(REPLACE(REPLACE(UPPER(c.documento),'-',''),'.',''),' ','')";
function clientePorDocumento(doc, excluirId) {
  const n = normalizarDocumento(doc);
  if (!n) return null;
  const solo = n.replace(/-/g, ''), digitos = solo.replace(/^[A-Z]/, ''), conLetra = /^[A-Z]/.test(solo);
  return D.get('SELECT c.id, c.nombre FROM clientes c WHERE c.documento IS NOT NULL AND c.id<>? AND (' + SQL_DOC + '=? OR ' + SQL_DOC + '=? OR (?=0 AND substr(' + SQL_DOC + ",2)=? AND substr(" + SQL_DOC + ",1,1) GLOB '[A-Z]'))", excluirId || 0, solo, digitos, conLetra ? 1 : 0, digitos) || null;
}
function datosCliente(b, perms, previo) {
  const credito = b.credito_habilitado != null ? bool(b.credito_habilitado) : (previo?.credito_habilitado ?? 0);
  const limite = b.limite_usd != null ? num(b.limite_usd, 'Límite inválido', 0) : (previo?.limite_usd ?? 0);
  if ((credito !== (previo?.credito_habilitado ?? 0) || limite !== (previo?.limite_usd ?? 0)) && !perms.has('credito.autorizar')) err(403, 'Solo un supervisor puede habilitar o cambiar el crédito');
  const estado = ['activo', 'suspendido'].includes(b.estado) ? b.estado : (previo?.estado || 'activo');
  return { nombre: req(b.nombre ?? previo?.nombre, 'Indica el nombre del cliente'), documento: b.documento !== undefined ? normalizarDocumento(b.documento) : (previo?.documento ?? null), telefono: b.telefono !== undefined ? D.normalizarTelefono(b.telefono) : (previo?.telefono ?? null),
    direccion: b.direccion !== undefined ? s(b.direccion) : (previo?.direccion ?? null), credito, limite, dias: b.dias_credito != null ? num(b.dias_credito, 'Días inválidos', 0) : (previo?.dias_credito ?? 7), estado };
}
staff('POST', '/api/clientes', 'clientes.editar', ({ body, perms, user }) => {
  const d = datosCliente(body, perms);
  if (d.telefono && D.get('SELECT id FROM clientes WHERE telefono=?', d.telefono)) err(409, 'Ya existe un cliente con ese teléfono');
  { const dup = d.documento && clientePorDocumento(d.documento); if (dup) err(409, `Ya existe un cliente con ese documento: ${dup.nombre}`); }
  const id = D.insert('INSERT INTO clientes(nombre,documento,telefono,direccion,credito_habilitado,limite_usd,dias_credito,estado,creado) VALUES(?,?,?,?,?,?,?,?,?)',
    d.nombre, d.documento, d.telefono, d.direccion, d.credito, d.limite, d.dias, d.estado, D.ahora());
  L.audit(user.usuario, 'cliente_creado', 'cliente', id, { nombre: d.nombre, credito: d.credito, limite: d.limite });
  return { id };
});
staff('PUT', '/api/clientes/:id', 'clientes.editar', ({ params, body, perms, user }) => {
  const c = D.get('SELECT * FROM clientes WHERE id=?', params.id);
  if (!c) err(404, 'Cliente no encontrado');
  const d = datosCliente(body, perms, c);
  if (d.telefono && D.get('SELECT id FROM clientes WHERE telefono=? AND id<>?', d.telefono, c.id)) err(409, 'Ya existe otro cliente con ese teléfono');
  { const dup = d.documento && d.documento !== c.documento && clientePorDocumento(d.documento, c.id); if (dup) err(409, `Ya existe otro cliente con ese documento: ${dup.nombre}`); }
  D.run('UPDATE clientes SET nombre=?,documento=?,telefono=?,direccion=?,credito_habilitado=?,limite_usd=?,dias_credito=?,estado=? WHERE id=?', d.nombre, d.documento, d.telefono, d.direccion, d.credito, d.limite, d.dias, d.estado, c.id);
  if (d.credito !== c.credito_habilitado || d.limite !== c.limite_usd || d.estado !== c.estado)
    L.audit(user.usuario, 'credito_cliente_modificado', 'cliente', c.id, { antes: [c.credito_habilitado, c.limite_usd, c.estado], despues: [d.credito, d.limite, d.estado] });
  return { ok: true };
});
staff('POST', '/api/clientes/:id/pin', 'clientes.editar', ({ params, body, user }) => {
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) err(400, 'El PIN debe tener entre 4 y 8 dígitos');
  const c = D.get('SELECT * FROM clientes WHERE id=?', params.id);
  if (!c) err(404, 'Cliente no encontrado');
  if (!c.telefono) err(400, 'El cliente necesita un teléfono para usar la app');
  D.run('UPDATE clientes SET pin_hash=? WHERE id=?', D.hashClave(pin), c.id);
  D.run("DELETE FROM sesiones WHERE tipo='cli' AND ref_id=?", c.id);
  L.audit(user.usuario, 'pin_cliente_asignado', 'cliente', c.id);
  return { ok: true };
});

staff('GET', '/api/cxc', null, ({ query }) => {
  const w = [], a = [];
  if (query.estado === 'abiertas') w.push("x.estado IN ('pendiente','abonada')"); else if (query.estado) { w.push('x.estado=?'); a.push(query.estado); }
  if (query.cliente_id) { w.push('x.cliente_id=?'); a.push(Number(query.cliente_id)); }
  return D.all(`SELECT x.*, c.nombre AS cliente, v.numero AS venta, (x.estado IN ('pendiente','abonada') AND x.vence<'${D.hoy()}') AS vencida
                FROM cxc x JOIN clientes c ON c.id=x.cliente_id LEFT JOIN ventas v ON v.id=x.venta_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY x.vence, x.id LIMIT 500`, ...a);
});
staff('POST', '/api/cxc/:id/cobrar', 'cobros.crear', ({ params, body, user }) => D.tx(() => L.cobrarCxc(Number(params.id), body.pagos, user.usuario, L.turnoAbiertoDe(user.id))));
staff('GET', '/api/cxp', null, ({ query }) => {
  const w = [], a = [];
  if (query.estado === 'abiertas') w.push("x.estado IN ('pendiente','abonada')"); else if (query.estado) { w.push('x.estado=?'); a.push(query.estado); }
  return D.all(`SELECT x.*, p.nombre AS proveedor, c.numero AS compra, (x.estado IN ('pendiente','abonada') AND x.vence<'${D.hoy()}') AS vencida
                FROM cxp x JOIN proveedores p ON p.id=x.proveedor_id LEFT JOIN compras c ON c.id=x.compra_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY x.vence, x.id LIMIT 500`, ...a);
});
// Deuda por proveedor (una fila por proveedor con facturas abiertas)
staff('GET', '/api/cxp/resumen', null, () => D.all(`SELECT p.id, p.nombre, p.telefono, p.plazo_entrega, p.dias_credito, COUNT(x.id) AS facturas, COALESCE(SUM(x.saldo_usd),0) AS deuda,
    COALESCE(SUM(CASE WHEN x.vence < ? THEN x.saldo_usd ELSE 0 END),0) AS vencida, MIN(x.vence) AS proxima_vence,
    (SELECT MAX(cp.fecha) FROM cxp_pagos cp JOIN cxp y ON y.id=cp.cxp_id WHERE y.proveedor_id=p.id) AS ultimo_pago
  FROM proveedores p JOIN cxp x ON x.proveedor_id=p.id AND x.estado IN ('pendiente','abonada') GROUP BY p.id ORDER BY vencida DESC, deuda DESC`, D.hoy()));

// Estado de cuenta del proveedor: deuda, antigüedad, facturas con sus pagos y movimientos con saldo acumulado
staff('GET', '/api/proveedores/:id/estado-cuenta', null, ({ params }) => {
  const p = D.get('SELECT * FROM proveedores WHERE id=?', params.id);
  if (!p) err(404, 'Proveedor no encontrado');
  const hoy = D.hoy();
  const dif = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
  const cxps = D.all(`SELECT x.*, c.numero AS compra, c.moneda, c.total_moneda FROM cxp x LEFT JOIN compras c ON c.id=x.compra_id WHERE x.proveedor_id=? ORDER BY x.id`, p.id);
  const pagos = D.all(`SELECT cp.*, x.compra_id, c.numero AS compra, cu.nombre AS cuenta FROM cxp_pagos cp JOIN cxp x ON x.id=cp.cxp_id LEFT JOIN compras c ON c.id=x.compra_id LEFT JOIN cuentas cu ON cu.id=cp.cuenta_id
    WHERE x.proveedor_id=? ORDER BY cp.fecha, cp.id`, p.id);
  const contado = D.all("SELECT id, numero, recibida_en, fecha, moneda, total_moneda, total_usd FROM compras WHERE proveedor_id=? AND condicion='contado' AND estado='recibida' ORDER BY fecha", p.id);
  const anuladas = new Map(D.all("SELECT ref, fecha FROM auditoria WHERE accion='compra_anulada'").map((a) => [a.ref, a.fecha]));
  const pagosPorCxp = new Map();
  for (const g of pagos) { if (!pagosPorCxp.has(g.cxp_id)) pagosPorCxp.set(g.cxp_id, []); pagosPorCxp.get(g.cxp_id).push({ fecha: g.fecha, moneda: g.moneda, monto: g.monto, tasa: g.tasa, monto_usd: g.monto_usd, cuenta: g.cuenta, referencia: g.referencia, usuario: g.usuario }); }

  const mov = [];
  for (const x of cxps) {
    mov.push({ fecha: x.creado, orden: 0, tipo: 'cargo', doc: x.compra, detalle: `Compra a crédito · vence ${x.vence}`, cargo: x.total_usd, abono: 0 });
    if (x.estado === 'anulada') mov.push({ fecha: anuladas.get(String(x.compra_id)) || x.creado, orden: 2, tipo: 'reverso', doc: x.compra, detalle: 'Compra anulada', cargo: 0, abono: x.total_usd });
  }
  for (const g of pagos) mov.push({ fecha: g.fecha, orden: 1, tipo: 'pago', doc: g.compra, detalle: `Pago de ${g.monto} ${g.moneda}${g.moneda !== 'USD' ? ` (tasa ${g.tasa})` : ''} desde ${g.cuenta || 'cuenta'}${g.referencia ? ' · ref. ' + g.referencia : ''}`, cargo: 0, abono: g.monto_usd });
  for (const c of contado) mov.push({ fecha: c.recibida_en || c.fecha, orden: 0, tipo: 'contado', doc: c.numero, detalle: `Compra de contado (${c.moneda} ${c.total_moneda}): no genera deuda`, cargo: 0, abono: 0, monto_info: c.total_usd });
  mov.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.orden - b.orden));
  let saldo = 0;
  for (const m of mov) { saldo = r2(saldo + m.cargo - m.abono); m.saldo = saldo; }

  const abiertas = cxps.filter((x) => ['pendiente', 'abonada'].includes(x.estado));
  const ant = { vigente: 0, d1_30: 0, d31_60: 0, d60_mas: 0 };
  for (const x of abiertas) { const d = dif(hoy, x.vence); ant[d <= 0 ? 'vigente' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : 'd60_mas'] += x.saldo_usd; }
  const pagadas = cxps.filter((x) => x.estado === 'pagada' && pagosPorCxp.has(x.id));
  const plazos = pagadas.map((x) => dif(pagosPorCxp.get(x.id).slice(-1)[0].fecha.slice(0, 10), x.creado.slice(0, 10)));
  const credito = cxps.filter((x) => x.estado !== 'anulada').reduce((a, x) => a + x.total_usd, 0);
  const ultimaCompra = D.get("SELECT MAX(COALESCE(recibida_en, fecha)) AS f FROM compras WHERE proveedor_id=? AND estado='recibida'", p.id).f;
  return {
    proveedor: { id: p.id, nombre: p.nombre, rif: p.rif, telefono: p.telefono, correo: p.correo, contacto: p.contacto, direccion: p.direccion, dias_credito: p.dias_credito, plazo_entrega: p.plazo_entrega, activo: p.activo },
    resumen: {
      deuda_usd: r2(abiertas.reduce((a, x) => a + x.saldo_usd, 0)), vencida_usd: r2(abiertas.filter((x) => x.vence < hoy).reduce((a, x) => a + x.saldo_usd, 0)),
      por_vencer_7d_usd: r2(abiertas.filter((x) => x.vence >= hoy && dif(x.vence, hoy) <= 7).reduce((a, x) => a + x.saldo_usd, 0)), facturas_abiertas: abiertas.length,
      compras_credito_usd: r2(credito), compras_contado_usd: r2(contado.reduce((a, c) => a + c.total_usd, 0)), pagado_usd: r2(pagos.reduce((a, g) => a + g.monto_usd, 0)),
      ultima_compra: ultimaCompra, ultimo_pago: pagos.length ? pagos[pagos.length - 1].fecha : null, dias_promedio_pago: plazos.length ? r2(plazos.reduce((a, b) => a + b, 0) / plazos.length) : null,
      antiguedad: { vigente: r2(ant.vigente), d1_30: r2(ant.d1_30), d31_60: r2(ant.d31_60), d60_mas: r2(ant.d60_mas) }
    },
    facturas: cxps.map((x) => ({ id: x.id, compra: x.compra, creado: x.creado, vence: x.vence, estado: x.estado, total_usd: x.total_usd, pagado_usd: r2(x.total_usd - x.saldo_usd), saldo_usd: x.saldo_usd,
      dias_vencida: ['pendiente', 'abonada'].includes(x.estado) ? Math.max(0, dif(hoy, x.vence)) : 0, pagos: pagosPorCxp.get(x.id) || [] })).reverse(),
    movimientos: mov
  };
});
staff('POST', '/api/cxp/:id/pagar', 'cxp.pagar', ({ params, body, user }) => D.tx(() => L.pagarCxp(Number(params.id), body, user.usuario)));

// =====================================================================
// COMPRAS
// =====================================================================
staff('GET', '/api/compras', null, ({ query }) => {
  const w = [], a = [];
  if (query.estado) { w.push('c.estado=?'); a.push(query.estado); }
  if (query.proveedor_id) { w.push('c.proveedor_id=?'); a.push(Number(query.proveedor_id)); }
  return D.all(`SELECT c.*, p.nombre AS proveedor FROM compras c JOIN proveedores p ON p.id=c.proveedor_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY c.id DESC LIMIT 300`, ...a);
});
staff('GET', '/api/compras/sugerencias', null, () => L.sugerenciasCompra());
staff('GET', '/api/compras/analisis', null, () => L.analisisCompras());
staff('POST', '/api/compras/desde-sugerencias', 'compras.editar', ({ body, user }) => D.tx(() => {
  const grupos = new Map();
  for (const it of body.items || []) {
    const p = D.get('SELECT * FROM productos WHERE id=?', it.producto_id);
    if (!p) continue;
    const prov = p.proveedor_id;
    if (!prov) err(400, `"${p.nombre}" no tiene proveedor principal asignado`);
    if (!grupos.has(prov)) grupos.set(prov, []);
    grupos.get(prov).push({ producto_id: p.id, cantidad: Number(it.cantidad_compra), costo_unit: p.costo_usd * p.factor });
  }
  if (!grupos.size) err(400, 'No hay productos seleccionados');
  const ids = [];
  for (const [prov, items] of grupos) ids.push(L.guardarCompra({ proveedor_id: prov, moneda: 'USD', condicion: 'contado', items, nota: 'Generada desde sugerencias de compra' }, user.usuario));
  return { ids };
}));
staff('GET', '/api/compras/:id', null, ({ params }) => {
  const c = D.get('SELECT c.*, p.nombre AS proveedor FROM compras c JOIN proveedores p ON p.id=c.proveedor_id WHERE c.id=?', params.id);
  if (!c) err(404, 'Compra no encontrada');
  return { ...c, items: D.all('SELECT d.*, p.nombre, p.codigo, p.unidad_compra, p.factor FROM compra_detalles d JOIN productos p ON p.id=d.producto_id WHERE d.compra_id=?', c.id) };
});
staff('POST', '/api/compras', 'compras.editar', ({ body, user }) => D.tx(() => {
  const id = L.guardarCompra(body, user.usuario);
  if (body.recibir) L.recibirCompra(id, { ...body, items: undefined }, user.usuario); // compra directa: se recibe tal cual se registró
  return { id };
}));
staff('POST', '/api/compras/:id/enviar', 'compras.editar', ({ params, body, user }) => D.tx(() => { L.enviarCompra(Number(params.id), body, user.usuario); return { ok: true }; }));
staff('POST', '/api/compras/:id/recibir', 'compras.editar', ({ params, body, user }) => D.tx(() => { L.recibirCompra(Number(params.id), body, user.usuario); return { ok: true }; }));
staff('POST', '/api/compras/:id/anular', 'compras.editar', ({ params, body, user }) => D.tx(() => { L.anularCompra(Number(params.id), body.motivo, user.usuario); return { ok: true }; }));

// =====================================================================
// VENTAS / POS / CAJA
// =====================================================================
staff('GET', '/api/ventas', null, ({ query }) => {
  const [desde, hasta] = rango(query);
  const w = ['substr(v.fecha,1,10) BETWEEN ? AND ?'], a = [desde, hasta];
  if (query.estado) { w.push('v.estado=?'); a.push(query.estado); }
  if (query.q) { w.push('(v.numero LIKE ? OR c.nombre LIKE ?)'); a.push(like(query.q), like(query.q)); }
  return D.all(`SELECT v.*, c.nombre AS cliente FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id WHERE ${w.join(' AND ')} ORDER BY v.id DESC LIMIT 500`, ...a);
});
staff('GET', '/api/ventas/:id', null, ({ params }) => {
  const v = D.get('SELECT v.*, c.nombre AS cliente FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id WHERE v.id=?', params.id);
  if (!v) err(404, 'Venta no encontrada');
  return { ...v, items: D.all('SELECT d.*, p.nombre, p.codigo FROM venta_detalles d JOIN productos p ON p.id=d.producto_id WHERE d.venta_id=?', v.id),
    pagos: D.all('SELECT * FROM pagos WHERE venta_id=? ORDER BY id', v.id) };
});
staff('POST', '/api/ventas', 'ventas.crear', ({ body, user, perms }) => D.tx(() =>
  L.crearVenta({ usuario: user.usuario, perms, cliente_id: body.cliente_id || null, items: body.items, pagos: body.pagos, vuelto: body.vuelto, descuento_pct: body.descuento_pct, forzar: !!body.forzar, turno: L.turnoAbiertoDe(user.id) })));
staff('POST', '/api/ventas/:id/anular', 'ventas.anular', ({ params, body, user }) => D.tx(() => { L.anularVenta(Number(params.id), body.motivo, user.usuario); return { ok: true }; }));

staff('GET', '/api/turno', null, ({ user }) => {
  const t = L.turnoAbiertoDe(user.id);
  return t ? { ...t, caja: D.get('SELECT nombre FROM cajas WHERE id=?', t.caja_id).nombre, resumen: L.resumenTurno(t) } : null;
});
staff('POST', '/api/turnos/abrir', 'caja.operar', ({ body, user }) => D.tx(() => {
  const j = L.requireJornada();
  if (L.turnoAbiertoDe(user.id)) err(409, 'Ya tienes una caja abierta');
  const caja = D.get('SELECT * FROM cajas WHERE id=? AND activo=1', body.caja_id);
  if (!caja) err(400, 'Selecciona una caja');
  if (D.get("SELECT id FROM caja_turnos WHERE caja_id=? AND estado='abierta'", caja.id)) err(409, `${caja.nombre} ya tiene un turno abierto`);
  const f = body.fondo || {};
  const fondo = { USD: Number(f.USD) || 0, VES: Number(f.VES) || 0, EUR: Number(f.EUR) || 0 };
  const id = D.insert("INSERT INTO caja_turnos(caja_id,usuario_id,usuario,jornada_id,estado,abierta_en,fondo) VALUES(?,?,?,?,'abierta',?,?)", caja.id, user.id, user.usuario, j.id, D.ahora(), JSON.stringify(fondo));
  L.audit(user.usuario, 'caja_abierta', 'caja', caja.id, fondo);
  return { id };
}));
staff('POST', '/api/turnos/cerrar', 'caja.operar', ({ body, user }) => D.tx(() => {
  const t = L.turnoAbiertoDe(user.id);
  if (!t) err(409, 'No tienes una caja abierta');
  const jor = L.requireJornada();
  const res = L.resumenTurno(t);
  const c = body.contado || {};
  const contado = { USD: Number(c.USD) || 0, VES: Number(c.VES) || 0, EUR: Number(c.EUR) || 0 };
  let difUSD = 0; const difs = {};
  for (const m of L.MONEDAS) { difs[m] = r2(contado[m] - res.esperado[m]); difUSD += L.aUSD(difs[m], m, jor); }
  difUSD = r2(difUSD);
  if (Object.values(difs).some((d) => Math.abs(d) > 0.005) && !String(body.comentario || '').trim()) err(400, 'Hay diferencias de caja: el comentario es obligatorio');
  D.run("UPDATE caja_turnos SET estado='cerrada', cerrada_en=?, esperado=?, contado=?, diferencia_usd=?, comentario=? WHERE id=?", D.ahora(), JSON.stringify(res.esperado), JSON.stringify(contado), difUSD, s(body.comentario), t.id);
  L.audit(user.usuario, 'caja_cerrada', 'turno', t.id, { esperado: res.esperado, contado, difs });
  return { esperado: res.esperado, contado, diferencias: difs, diferencia_usd: difUSD, por_medio: res.por_medio, ventas: res.ventas };
}));
staff('GET', '/api/turnos', 'caja.supervisar', () => D.all('SELECT t.*, c.nombre AS caja FROM caja_turnos t JOIN cajas c ON c.id=t.caja_id ORDER BY t.id DESC LIMIT 100'));
staff('GET', '/api/turnos/:id', 'caja.supervisar', ({ params }) => {
  const t = D.get('SELECT t.*, c.nombre AS caja FROM caja_turnos t JOIN cajas c ON c.id=t.caja_id WHERE t.id=?', params.id);
  if (!t) err(404, 'Turno no encontrado');
  return { ...t, resumen: L.resumenTurno(t) };
});

// =====================================================================
// PEDIDOS (app cliente + vendedores)
// =====================================================================
function crearPedido(o) {
  const op = D.param('operacion');
  if (!o.items || !o.items.length) err(400, 'El carrito está vacío');
  const entrega = o.entrega === 'envio' ? 'envio' : 'retiro';
  if (entrega === 'envio') { req(o.contacto, 'Indica el nombre de contacto'); req(o.telefono, 'Indica el teléfono de contacto'); req(o.zona, 'Indica la zona'); req(o.direccion, 'Indica la dirección'); }
  L.barrerReservas();
  const agr = new Map(); const lineas = [];
  for (const it of o.items) {
    const p = D.get('SELECT * FROM productos WHERE id=?', it.producto_id);
    if (!p || !p.activo) err(400, 'Hay un producto que ya no está disponible');
    const cant = num(it.cantidad, `Cantidad inválida para "${p.nombre}"`, 0.0001);
    if (!(p.precio_usd > 0)) err(400, `"${p.nombre}" no está a la venta`);
    agr.set(p.id, (agr.get(p.id) || 0) + cant);
    lineas.push({ p, cant });
  }
  for (const [id, cant] of agr) {
    const disp = L.disponible(id);
    if (cant > disp + 1e-9) { const p = D.get('SELECT nombre FROM productos WHERE id=?', id); err(409, `Stock insuficiente de "${p.nombre}": disponible ${Math.max(0, r2(disp))}`); }
  }
  const total = r2(lineas.reduce((a, l) => a + l.cant * l.p.precio_usd, 0));
  const expira = D.sumarMinutos(op.reserva_minutos);
  const id = D.insert(`INSERT INTO pedidos(numero,cliente_id,origen,estado,entrega,contacto,telefono,zona,direccion,referencia_entrega,nota,total_usd,creado,expira,vendedor)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, D.siguiente('pedido', 'P'), o.cliente_id, o.origen || 'app', 'pendiente', entrega, s(o.contacto), s(o.telefono), s(o.zona), s(o.direccion), s(o.referencia_entrega), s(o.nota), total, D.ahora(), expira, o.vendedor || null);
  for (const l of lineas) D.insert('INSERT INTO pedido_detalles(pedido_id,producto_id,cantidad,precio_usd) VALUES(?,?,?,?)', id, l.p.id, l.cant, l.p.precio_usd);
  for (const [pid, cant] of agr) D.insert('INSERT INTO reservas(pedido_id,producto_id,cantidad,expira) VALUES(?,?,?,?)', id, pid, cant, expira);
  return { id, total_usd: total, expira };
}
function detallePedido(id, paraCliente) {
  const p = D.get('SELECT p.*, c.nombre AS cliente, c.telefono AS cliente_tel FROM pedidos p JOIN clientes c ON c.id=p.cliente_id WHERE p.id=?', id);
  if (!p) return null;
  const orden = D.get('SELECT * FROM ordenes_entrega WHERE pedido_id=?', id) || null;
  const pagos = D.all(`SELECT r.id,r.pedido_id,r.medio_app_id,r.monto,r.moneda,r.banco_emisor,r.referencia,r.estado,r.motivo,r.creado,r.resuelto_en,r.paga_con,${paraCliente ? '0' : '(r.comprobante IS NOT NULL)'} AS tiene_comprobante,
        m.medio, m.banco AS banco_receptor FROM pagos_reportados r JOIN medios_pago_app m ON m.id=r.medio_app_id WHERE r.pedido_id=? ORDER BY r.id`, id);
  return { ...p, items: D.all('SELECT d.*, pr.nombre, pr.codigo FROM pedido_detalles d JOIN productos pr ON pr.id=d.producto_id WHERE d.pedido_id=?', id), pagos, orden, semaforo: L.semaforo(p, orden) };
}
const ESTADOS_ORDEN = { retiro: ['por_preparar', 'en_preparacion', 'preparada', 'lista_retiro', 'entregada'], envio: ['por_preparar', 'en_preparacion', 'preparada', 'lista_envio', 'retirada', 'enviada', 'entregada'] };

staff('GET', '/api/pedidos', null, ({ query }) => {
  L.barrerReservas();
  const w = [], a = [];
  if (query.estado) { w.push('p.estado=?'); a.push(query.estado); }
  const rows = D.all(`SELECT p.*, c.nombre AS cliente, o.estado AS orden_estado, o.id AS orden_id, o.numero AS orden_numero, o.repartidor, o.repartidor_tel, o.repartidor_id, o.salida_en, o.entregado_en, o.receptor,
      (SELECT COUNT(*) FROM pagos_reportados r WHERE r.pedido_id=p.id AND r.estado='pendiente') AS pagos_pendientes
      FROM pedidos p JOIN clientes c ON c.id=p.cliente_id LEFT JOIN ordenes_entrega o ON o.pedido_id=p.id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 300`, ...a);
  return rows.map((p) => ({ ...p, semaforo: L.semaforo(p, p.orden_estado ? { estado: p.orden_estado } : null) }));
});
staff('GET', '/api/pedidos/:id', null, ({ params }) => detallePedido(Number(params.id)) || err(404, 'Pedido no encontrado'));
staff('GET', '/api/pagos-reportados/:id/comprobante', 'pedidos.gestionar', ({ params }) => {
  const r = D.get('SELECT comprobante FROM pagos_reportados WHERE id=?', params.id);
  if (!r || !r.comprobante) err(404, 'Sin comprobante');
  return { comprobante: r.comprobante };
});
staff('POST', '/api/pedidos', 'pedidos.crear', ({ body, user }) => D.tx(() => {
  if (!D.get('SELECT id FROM clientes WHERE id=?', body.cliente_id)) err(400, 'Selecciona el cliente');
  const r = crearPedido({ ...body, origen: 'vendedor', vendedor: user.usuario });
  L.audit(user.usuario, 'pedido_creado_vendedor', 'pedido', r.id, { total: r.total_usd });
  return r;
}));
staff('POST', '/api/pedidos/:id/validar-pago', 'pedidos.gestionar', ({ params, body, user, perms }) => D.tx(() => {
  const p = D.get('SELECT * FROM pedidos WHERE id=?', params.id);
  if (!p) err(404, 'Pedido no encontrado');
  if (!['pendiente', 'pago_reportado'].includes(p.estado)) err(409, 'El pedido no está esperando validación de pago');
  const pr = D.get("SELECT * FROM pagos_reportados WHERE id=? AND pedido_id=? AND estado='pendiente'", body.pago_id, p.id);
  if (!pr) err(404, 'Pago reportado no encontrado o ya resuelto');
  const m = D.get('SELECT * FROM medios_pago_app WHERE id=?', pr.medio_app_id);
  const turno = L.turnoAbiertoDe(user.id);
  const monto = body.monto_confirmado != null ? num(body.monto_confirmado, 'Monto inválido', 0.01) : (pr.paga_con || pr.monto);
  const items = D.all('SELECT producto_id, cantidad, precio_usd FROM pedido_detalles WHERE pedido_id=?', p.id);
  // efectivo recibido de más: el vuelto se entrega en la misma moneda del billete
  let vuelto;
  if (m.medio === 'efectivo') {
    const exceso = L.r2(monto - L.r2(L.deUSD(p.total_usd, pr.moneda, L.requireJornada())));
    if (exceso > 0.01) vuelto = [{ medio: 'efectivo', moneda: pr.moneda, monto: exceso }];
  }
  const venta = L.crearVenta({ usuario: user.usuario, perms, cliente_id: p.cliente_id, items, origen: 'app', pedido_id: p.id, turno, vuelto,
    pagos: [{ medio: m.medio, moneda: pr.moneda, monto, referencia: pr.referencia === 'AL RECIBIR' ? (m.medio === 'punto' ? 'PUNTO-' + p.numero : null) : pr.referencia, cuenta_id: m.cuenta_id }] });
  D.run("UPDATE pagos_reportados SET estado='validado', resuelto_en=?, resuelto_por=? WHERE id=?", D.ahora(), user.usuario, pr.id);
  D.run("UPDATE reservas SET estado='consumida' WHERE pedido_id=? AND estado='activa'", p.id);
  D.run("UPDATE pedidos SET estado='pagado', venta_id=?, expira=NULL WHERE id=?", venta.id, p.id);
  const oid = D.insert("INSERT INTO ordenes_entrega(numero,pedido_id,venta_id,tipo,estado,creado) VALUES(?,?,?,?,?,?)", D.siguiente('orden', 'OE'), p.id, venta.id, p.entrega, 'por_preparar', D.ahora());
  L.audit(user.usuario, 'pago_app_validado', 'pedido', p.id, { venta: venta.numero, monto, moneda: pr.moneda });
  return { venta, orden_id: oid };
}));
staff('POST', '/api/pedidos/:id/rechazar-pago', 'pedidos.gestionar', ({ params, body, user }) => D.tx(() => {
  const p = D.get('SELECT * FROM pedidos WHERE id=?', params.id);
  if (!p) err(404, 'Pedido no encontrado');
  if (!['pendiente', 'pago_reportado'].includes(p.estado)) err(409, 'El pedido no está esperando validación de pago');
  const motivo = req(body.motivo, 'Indica el motivo del rechazo');
  D.run("UPDATE pagos_reportados SET estado='rechazado', motivo=?, resuelto_en=?, resuelto_por=? WHERE pedido_id=? AND estado='pendiente'", motivo, D.ahora(), user.usuario, p.id);
  L.liberarReservas(p.id);
  D.run("UPDATE pedidos SET estado='rechazado', motivo=?, expira=NULL WHERE id=?", motivo, p.id);
  L.audit(user.usuario, 'pago_app_rechazado', 'pedido', p.id, motivo);
  return { ok: true };
}));
staff('POST', '/api/pedidos/:id/cancelar', 'pedidos.gestionar', ({ params, body, user, perms }) => D.tx(() => {
  const p = D.get('SELECT * FROM pedidos WHERE id=?', params.id);
  if (!p) err(404, 'Pedido no encontrado');
  const motivo = req(body.motivo, 'Indica el motivo');
  if (['cancelado', 'vencido', 'rechazado'].includes(p.estado)) err(409, 'El pedido ya está cerrado');
  if (['pagado', 'entregado'].includes(p.estado)) {
    if (!perms.has('ventas.anular')) err(403, 'El pedido ya fue pagado: solo un supervisor puede anularlo (genera reverso de la venta)');
    L.anularVenta(p.venta_id, 'Cancelación de pedido ' + p.numero + ': ' + motivo, user.usuario);
    D.run("UPDATE ordenes_entrega SET estado='cancelada', actualizado=? WHERE pedido_id=?", D.ahora(), p.id);
  }
  L.liberarReservas(p.id);
  D.run("UPDATE pagos_reportados SET estado='rechazado', motivo='Pedido cancelado', resuelto_en=? WHERE pedido_id=? AND estado='pendiente'", D.ahora(), p.id);
  D.run("UPDATE pedidos SET estado='cancelado', motivo=?, expira=NULL WHERE id=?", motivo, p.id);
  L.audit(user.usuario, 'pedido_cancelado', 'pedido', p.id, motivo);
  return { ok: true };
}));
staff('GET', '/api/ordenes', null, ({ query }) => D.all(`SELECT o.*, p.numero AS pedido, p.entrega, p.contacto, p.telefono, p.zona, p.direccion, p.referencia_entrega, p.nota, c.nombre AS cliente
    FROM ordenes_entrega o JOIN pedidos p ON p.id=o.pedido_id JOIN clientes c ON c.id=p.cliente_id
    ${query.abiertas ? "WHERE o.estado NOT IN ('entregada','cancelada')" : ''} ORDER BY o.id DESC LIMIT 200`));
staff('GET', '/api/ordenes/:id', null, ({ params }) => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Orden no encontrada');
  return { orden: o, pedido: detallePedido(o.pedido_id) };
});
// ---- App del repartidor: entregas a domicilio ----
// Un pedido de envío queda "listo para envío" → los repartidores reciben el aviso → uno lo toma y sale (en camino) → lo entrega.
// También se puede asignar desde el sistema a un repartidor concreto.
const SQL_REPARTO = `SELECT o.id, o.numero AS orden, o.estado, o.repartidor_id, o.repartidor, o.repartidor_tel, o.retirado_en, o.salida_en, o.rechazado_en, o.motivo_rechazo, o.entregado_en, o.receptor, o.nota_entrega, o.actualizado,
    (SELECT json_object('medio', mp.medio, 'moneda', r.moneda, 'monto', r.monto, 'paga_con', r.paga_con, 'estado', r.estado) FROM pagos_reportados r JOIN medios_pago_app mp ON mp.id=r.medio_app_id WHERE r.pedido_id=p.id AND r.estado<>'rechazado' ORDER BY r.id DESC LIMIT 1) AS pago,
    p.numero AS pedido, p.contacto, p.telefono AS tel_contacto, p.zona, p.direccion, p.referencia_entrega, p.nota, c.nombre AS cliente, c.telefono AS tel_cliente,
    COALESCE(NULLIF((SELECT SUM(requerido) FROM preparacion_items i WHERE i.orden_id=o.id), 0), (SELECT SUM(cantidad) FROM pedido_detalles d WHERE d.pedido_id=p.id), 0) AS unidades
    FROM ordenes_entrega o JOIN pedidos p ON p.id=o.pedido_id JOIN clientes c ON c.id=p.cliente_id`;
// Aviso inmediato: cada app de repartidor mantiene una conexión abierta con el servidor y recibe un evento en cuanto cambia algo
// (asignación, pedido listo, pedido tomado por otro). Si la conexión se cae, la app sigue consultando cada pocos segundos.
const canalesReparto = new Map(); // código de empresa → conexiones abiertas
function avisarReparto(evento, soloUsuarioId) {
  const lista = canalesReparto.get(D.slugActual());
  if (!lista) return;
  const texto = 'data: ' + JSON.stringify(evento) + '\n\n';
  for (const c of lista) if (!soloUsuarioId || c.userId === soloUsuarioId) { try { c.res.write(texto); } catch { /* conexión cerrada */ } }
}
staff('GET', '/api/reparto/eventos', 'reparto.operar', ({ user }) => {
  const slug = D.slugActual();
  return { __flujo: (res, req) => {
    res.write('retry: 3000\n\n: conectado\n\n');
    const c = { res, userId: user.id };
    if (!canalesReparto.has(slug)) canalesReparto.set(slug, new Set());
    canalesReparto.get(slug).add(c);
    const latido = setInterval(() => { try { res.write(': latido\n\n'); } catch { /* conexión cerrada */ } }, 25000);
    req.on('close', () => { clearInterval(latido); const l = canalesReparto.get(slug); if (l) { l.delete(c); if (!l.size) canalesReparto.delete(slug); } });
  } };
});
staff('GET', '/api/reparto/mis', 'reparto.operar', ({ user }) => {
  const yo = user.id;
  return {
    ahora: D.ahora(), repartidor: user.nombre,
    disponibles: D.all(`${SQL_REPARTO} WHERE o.tipo='envio' AND o.estado='lista_envio' AND o.repartidor_id IS NULL ORDER BY o.actualizado, o.id`),
    asignados: D.all(`${SQL_REPARTO} WHERE o.tipo='envio' AND o.estado='lista_envio' AND o.repartidor_id=? ORDER BY o.actualizado, o.id`, yo),
    proximos: D.all(`${SQL_REPARTO} WHERE o.tipo='envio' AND o.estado IN ('por_preparar','en_preparacion','preparada') AND o.repartidor_id=? ORDER BY o.id`, yo),
    retirados: D.all(`${SQL_REPARTO} WHERE o.estado='retirada' AND o.repartidor_id=? ORDER BY o.retirado_en, o.id`, yo),
    en_camino: D.all(`${SQL_REPARTO} WHERE o.estado='enviada' AND o.repartidor_id=? ORDER BY o.salida_en, o.id`, yo),
    // terminados hoy: entregados y rechazados por el cliente
    entregados: D.all(`${SQL_REPARTO} WHERE o.repartidor_id=? AND ((o.estado='entregada' AND substr(o.entregado_en,1,10)=?) OR (o.estado='rechazada' AND substr(o.rechazado_en,1,10)=?)) ORDER BY COALESCE(o.entregado_en, o.rechazado_en) DESC LIMIT 30`, yo, D.hoy(), D.hoy())
  };
});
const quienEs = (id) => D.get('SELECT nombre, telefono FROM usuarios WHERE id=?', id);
staff('POST', '/api/reparto/ordenes/:id/tomar', 'reparto.operar', ({ params, user }) => D.tx(() => {
  const u = quienEs(user.id);
  const r = D.run("UPDATE ordenes_entrega SET repartidor_id=?, repartidor=?, repartidor_tel=?, asignado_en=? WHERE id=? AND tipo='envio' AND estado='lista_envio' AND repartidor_id IS NULL", user.id, u.nombre, u.telefono || null, D.ahora(), params.id);
  if (!r.changes) {
    const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
    if (!o) err(404, 'Pedido no encontrado');
    if (o.repartidor_id === user.id) return { ok: true };
    err(409, o.repartidor_id ? 'Otro repartidor ya tomó este pedido' : 'Este pedido todavía no está listo para enviar');
  }
  L.audit(user.usuario, 'reparto_tomado', 'orden', Number(params.id), user.nombre);
  avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));
// 1.º estado del repartidor: retiró el pedido de la tienda (queda con él, todavía no sale)
staff('POST', '/api/reparto/ordenes/:id/retirar', 'reparto.operar', ({ params, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o || o.tipo !== 'envio') err(404, 'Pedido no encontrado');
  if (o.estado === 'retirada') err(409, 'Este pedido ya fue retirado de la tienda');
  if (o.estado !== 'lista_envio') err(409, ['enviada', 'entregada'].includes(o.estado) ? 'Este pedido ya salió de la tienda' : 'Este pedido todavía no está listo para enviar');
  if (o.repartidor_id && o.repartidor_id !== user.id) err(409, 'Este pedido está asignado a otro repartidor');
  const u = quienEs(user.id);
  D.run("UPDATE ordenes_entrega SET estado='retirada', repartidor_id=?, repartidor=?, repartidor_tel=?, asignado_en=COALESCE(asignado_en, ?), retirado_en=?, actualizado=? WHERE id=?",
    user.id, u.nombre, u.telefono || null, D.ahora(), D.ahora(), D.ahora(), o.id);
  L.audit(user.usuario, 'reparto_retirado', 'orden', o.id, o.numero);
  avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));
staff('POST', '/api/reparto/ordenes/:id/salir', 'reparto.operar', ({ params, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o || o.tipo !== 'envio') err(404, 'Pedido no encontrado');
  // sale en camino lo que ya retiró de la tienda (por compatibilidad también un pedido listo, que se da por retirado en ese momento)
  if (!['retirada', 'lista_envio'].includes(o.estado)) err(409, o.estado === 'enviada' ? 'Este pedido ya salió en camino' : 'Este pedido todavía no está listo para enviar');
  if (o.repartidor_id && o.repartidor_id !== user.id) err(409, 'Este pedido está asignado a otro repartidor');
  const u = quienEs(user.id);
  D.run("UPDATE ordenes_entrega SET estado='enviada', repartidor_id=?, repartidor=?, repartidor_tel=?, asignado_en=COALESCE(asignado_en, ?), retirado_en=COALESCE(retirado_en, ?), salida_en=?, actualizado=? WHERE id=?",
    user.id, u.nombre, u.telefono || null, D.ahora(), D.ahora(), D.ahora(), D.ahora(), o.id);
  L.audit(user.usuario, 'reparto_en_camino', 'orden', o.id, o.numero);
  avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));
staff('POST', '/api/reparto/ordenes/:id/entregar', 'reparto.operar', ({ params, body, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Pedido no encontrado');
  if (o.estado === 'entregada') err(409, 'Este pedido ya fue entregado');
  if (o.estado !== 'enviada') err(409, 'Primero marca que saliste en camino');
  if (o.repartidor_id !== user.id) err(409, 'Este pedido está asignado a otro repartidor');
  D.run("UPDATE ordenes_entrega SET estado='entregada', entregado_en=?, receptor=?, nota_entrega=?, actualizado=? WHERE id=?", D.ahora(), s(body.receptor), s(body.nota), D.ahora(), o.id);
  D.run("UPDATE pedidos SET estado='entregado' WHERE id=?", o.pedido_id);
  L.audit(user.usuario, 'reparto_entregado', 'orden', o.id, { receptor: s(body.receptor) });
  avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));
staff('GET', '/api/repartidores', 'pedidos.gestionar', () => D.all("SELECT id, nombre, usuario, telefono FROM usuarios WHERE rol='repartidor' AND activo=1 ORDER BY nombre"));
staff('POST', '/api/ordenes/:id/asignar', 'pedidos.gestionar', ({ params, body, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Orden no encontrada');
  if (o.tipo !== 'envio') err(400, 'Solo los pedidos con envío llevan repartidor');
  if (o.estado === 'rechazada') err(409, 'La entrega fue rechazada: primero reprograma el pedido');
  if (['retirada', 'enviada', 'entregada', 'cancelada'].includes(o.estado)) err(409, o.estado === 'retirada' ? 'El pedido ya fue retirado de la tienda: no se puede cambiar el repartidor' : 'El pedido ya salió: no se puede cambiar el repartidor');
  if (!body.repartidor_id) {
    D.run('UPDATE ordenes_entrega SET repartidor_id=NULL, repartidor=NULL, repartidor_tel=NULL, asignado_en=NULL WHERE id=?', o.id);
    L.audit(user.usuario, 'reparto_desasignado', 'orden', o.id, o.numero);
    avisarReparto({ tipo: 'cambio' });
    return { ok: true };
  }
  const rep = D.get("SELECT id, nombre, telefono FROM usuarios WHERE id=? AND rol='repartidor' AND activo=1", body.repartidor_id);
  if (!rep) err(400, 'Selecciona un repartidor activo');
  D.run('UPDATE ordenes_entrega SET repartidor_id=?, repartidor=?, repartidor_tel=?, asignado_en=? WHERE id=?', rep.id, rep.nombre, rep.telefono || null, D.ahora(), o.id);
  L.audit(user.usuario, 'reparto_asignado', 'orden', o.id, { repartidor: rep.nombre });
  if (o.repartidor_id && o.repartidor_id !== rep.id) avisarReparto({ tipo: 'cambio' }, o.repartidor_id); // el anterior ya no lo tiene
  avisarReparto({ tipo: 'asignado', orden: o.numero }, rep.id);
  return { ok: true };
}));

// ---- Preparación con verificación por escaneo (picking) ----
// Al empezar a preparar se arma la lista de productos del pedido; cada escaneo suma una unidad y no se puede
// terminar la preparación hasta que todas las líneas estén completas.
function crearLineasPrep(orden) {
  if (D.get('SELECT 1 FROM preparacion_items WHERE orden_id=? LIMIT 1', orden.id)) return;
  for (const d of D.all('SELECT producto_id, SUM(cantidad) AS cant FROM pedido_detalles WHERE pedido_id=? GROUP BY producto_id', orden.pedido_id))
    D.run('INSERT INTO preparacion_items(orden_id,producto_id,requerido) VALUES(?,?,?)', orden.id, d.producto_id, d.cant);
}
function resumenPrep(orden) {
  const lineas = D.all(`SELECT i.*, p.nombre, p.codigo, p.presentacion, (SELECT codigo FROM codigos_barra b WHERE b.producto_id=p.id ORDER BY principal DESC LIMIT 1) AS barra
      FROM preparacion_items i JOIN productos p ON p.id=i.producto_id WHERE i.orden_id=? ORDER BY p.nombre`, orden.id);
  const requerido = lineas.reduce((a, l) => a + l.requerido, 0), escaneado = lineas.reduce((a, l) => a + Math.min(l.escaneado, l.requerido), 0);
  const ped = D.get('SELECT p.numero, p.entrega, p.zona, p.direccion, p.referencia_entrega, p.contacto, c.nombre AS cliente FROM pedidos p JOIN clientes c ON c.id=p.cliente_id WHERE p.id=?', orden.pedido_id);
  return { orden: { id: orden.id, numero: orden.numero, estado: orden.estado, tipo: orden.tipo }, pedido: ped, lineas, requerido, escaneado, completo: lineas.length > 0 && lineas.every((l) => l.escaneado >= l.requerido - 1e-9) };
}
function ordenEnPreparacion(id) {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', id);
  if (!o) err(404, 'Orden no encontrada');
  if (o.estado !== 'en_preparacion') err(409, o.estado === 'por_preparar' ? 'Primero empieza la preparación del pedido' : 'La preparación de esta orden ya terminó');
  return o;
}
staff('POST', '/api/ordenes/:id/preparar/iniciar', 'pedidos.gestionar', ({ params, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Orden no encontrada');
  if (!['por_preparar', 'en_preparacion'].includes(o.estado)) err(409, 'Esta orden ya no está en preparación');
  if (o.estado === 'por_preparar') {
    D.run("UPDATE ordenes_entrega SET estado='en_preparacion', actualizado=? WHERE id=?", D.ahora(), o.id);
    L.audit(user.usuario, 'preparacion_iniciada', 'orden', o.id, o.numero);
    o.estado = 'en_preparacion';
  }
  crearLineasPrep(o);
  return resumenPrep(o);
}));
staff('GET', '/api/ordenes/:id/preparacion', null, ({ params }) => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Orden no encontrada');
  return resumenPrep(o);
});
staff('POST', '/api/ordenes/:id/preparar/escanear', 'pedidos.gestionar', ({ params, body }) => D.tx(() => {
  const o = ordenEnPreparacion(params.id);
  const cod = String(body.codigo || '').trim();
  if (!cod) err(400, 'No se leyó ningún código');
  const prod = D.get('SELECT p.id, p.nombre FROM productos p WHERE p.id=(SELECT producto_id FROM codigos_barra WHERE codigo=?) OR p.codigo=?', cod, cod);
  if (!prod) err(404, 'Código no registrado: ' + cod);
  const l = D.get('SELECT * FROM preparacion_items WHERE orden_id=? AND producto_id=?', o.id, prod.id);
  if (!l) err(409, `"${prod.nombre}" NO pertenece a este pedido. Déjalo fuera.`);
  if (l.escaneado >= l.requerido - 1e-9) err(409, `Ya incluiste todas las unidades de "${prod.nombre}" (${l.requerido} de ${l.requerido}). Esta sobra: no la incluyas.`);
  const suma = Math.min(1, l.requerido - l.escaneado);
  D.run('UPDATE preparacion_items SET escaneado=escaneado+? WHERE id=?', suma, l.id);
  const r = resumenPrep(o), linea = r.lineas.find((x) => x.producto_id === prod.id);
  return { producto: prod.nombre, escaneado: linea.escaneado, requerido: linea.requerido, linea_completa: linea.escaneado >= linea.requerido - 1e-9, completo: r.completo, faltan: Math.round((r.requerido - r.escaneado) * 1000) / 1000 };
}));
staff('POST', '/api/ordenes/:id/preparar/manual', 'pedidos.gestionar', ({ params, body, user }) => D.tx(() => {
  const o = ordenEnPreparacion(params.id);
  const motivo = String(body.motivo || '').trim();
  if (!motivo) err(400, 'Indica por qué lo marcas a mano (por ejemplo: el código no se lee)');
  const l = D.get('SELECT i.*, p.nombre FROM preparacion_items i JOIN productos p ON p.id=i.producto_id WHERE i.orden_id=? AND i.producto_id=?', o.id, body.producto_id);
  if (!l) err(404, 'Ese producto no pertenece al pedido');
  const falta = l.requerido - l.escaneado;
  const cant = body.cantidad == null ? falta : Number(body.cantidad);
  if (!(cant > 0) || cant > falta + 1e-9) err(400, `La cantidad debe estar entre 0 y ${falta}`);
  D.run('UPDATE preparacion_items SET escaneado=escaneado+?, manual=manual+? WHERE id=?', cant, cant, l.id);
  L.audit(user.usuario, 'preparacion_manual', 'orden', o.id, { producto: l.nombre, cantidad: cant, motivo });
  return resumenPrep(o);
}));
staff('POST', '/api/ordenes/:id/preparar/deshacer', 'pedidos.gestionar', ({ params, body, user }) => D.tx(() => {
  const o = ordenEnPreparacion(params.id);
  const l = D.get('SELECT i.*, p.nombre FROM preparacion_items i JOIN productos p ON p.id=i.producto_id WHERE i.orden_id=? AND i.producto_id=?', o.id, body.producto_id);
  if (!l || l.escaneado <= 0) err(409, 'No hay unidades marcadas de ese producto');
  const quita = Math.min(1, l.escaneado);
  D.run('UPDATE preparacion_items SET escaneado=escaneado-?, manual=MAX(0, manual-?) WHERE id=?', quita, quita, l.id);
  L.audit(user.usuario, 'preparacion_deshacer', 'orden', o.id, { producto: l.nombre });
  return resumenPrep(o);
}));
// El cliente no recibió el pedido en la puerta: el repartidor lo marca rechazado con su motivo y el pedido queda pendiente de resolver en el sistema
staff('POST', '/api/reparto/ordenes/:id/rechazar', 'reparto.operar', ({ params, body, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o || o.tipo !== 'envio') err(404, 'Pedido no encontrado');
  if (o.estado === 'rechazada') err(409, 'Este pedido ya fue marcado como rechazado');
  if (o.estado === 'entregada') err(409, 'Este pedido ya fue entregado');
  if (o.estado !== 'enviada') err(409, 'Solo se puede rechazar un pedido que ya salió en camino');
  if (o.repartidor_id !== user.id) err(409, 'Este pedido está asignado a otro repartidor');
  const motivo = req(body.motivo, 'Indica por qué el cliente rechazó el pedido');
  D.run("UPDATE ordenes_entrega SET estado='rechazada', rechazado_en=?, motivo_rechazo=?, nota_entrega=COALESCE(?, nota_entrega), actualizado=? WHERE id=?", D.ahora(), motivo, s(body.nota), D.ahora(), o.id);
  L.audit(user.usuario, 'reparto_rechazado', 'orden', o.id, { motivo });
  avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));
// Resolver una entrega rechazada: volver a intentarla (queda lista para que otro repartidor, o el mismo, la tome) o cancelar el pedido
staff('POST', '/api/ordenes/:id/reprogramar', 'pedidos.gestionar', ({ params, body, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Orden no encontrada');
  if (o.estado !== 'rechazada') err(409, 'Solo se reprograma una entrega que fue rechazada');
  const nota = s(body.nota);
  D.run("UPDATE ordenes_entrega SET estado='lista_envio', repartidor_id=NULL, repartidor=NULL, repartidor_tel=NULL, asignado_en=NULL, retirado_en=NULL, salida_en=NULL, rechazado_en=NULL, motivo_rechazo=NULL, observacion=?, actualizado=? WHERE id=?",
    nota ? 'Reprogramada tras rechazo: ' + nota : 'Reprogramada tras un rechazo', D.ahora(), o.id);
  L.audit(user.usuario, 'reparto_reprogramado', 'orden', o.id, { motivo_anterior: o.motivo_rechazo, nota });
  avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));
staff('POST', '/api/ordenes/:id/estado', 'pedidos.gestionar', ({ params, body, user }) => D.tx(() => {
  const o = D.get('SELECT * FROM ordenes_entrega WHERE id=?', params.id);
  if (!o) err(404, 'Orden no encontrada');
  if (['entregada', 'cancelada'].includes(o.estado)) err(409, 'La orden ya está cerrada');
  if (o.estado === 'rechazada') err(409, 'La entrega fue rechazada: reprograma el pedido o cancélalo');
  const flujo = ESTADOS_ORDEN[o.tipo];
  const i = flujo.indexOf(o.estado), j = flujo.indexOf(body.estado);
  if (j < 0) err(400, 'Estado no válido para este tipo de entrega');
  if (j <= i) err(400, 'La orden no puede retroceder de estado');
  if (j !== i + 1) err(400, `Debes avanzar paso a paso: el siguiente estado es "${flujo[i + 1].replace(/_/g, ' ')}"`);
  if (body.estado === 'en_preparacion') crearLineasPrep(o);
  if (body.estado === 'preparada') {
    crearLineasPrep(o);
    if (!resumenPrep(o).completo) err(409, 'Faltan productos por verificar: completa la lista de preparación escaneando cada producto');
  }
  D.run('UPDATE ordenes_entrega SET estado=?, observacion=COALESCE(?,observacion), actualizado=? WHERE id=?', body.estado, s(body.observacion), D.ahora(), o.id);
  if (body.estado === 'entregada') D.run("UPDATE pedidos SET estado='entregado' WHERE id=?", o.pedido_id);
  L.audit(user.usuario, 'orden_estado', 'orden', o.id, body.estado);
  if (o.tipo === 'envio') avisarReparto({ tipo: 'cambio' });
  return { ok: true };
}));

// =====================================================================
// INVENTARIOS CÍCLICOS
// =====================================================================
staff('GET', '/api/abc', null, ({ query }) => {
  const c = L.clasificarABC();
  return { cfg: c.cfg, conteo: c.conteo, items_anuales: c.items_anuales, items_diarios: c.items_diarios, cuota_hoy: L.cuotasDelDia(c, L.leerArrastre()).cuota, total: c.productos.length,
    productos: query.detalle ? c.productos.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, clase: p.clase, valor: r2(p.valor), movimiento: r2(p.mov), acumulado: p.acumulado })) : undefined };
});
staff('GET', '/api/conteos', null, ({ perms }) => D.all(`SELECT c.*, (SELECT COUNT(*) FROM conteo_items WHERE conteo_id=c.id) AS items,
    (SELECT COUNT(*) FROM conteo_items WHERE conteo_id=c.id AND diferencia IS NOT NULL AND ABS(diferencia)>0.0001) AS con_diferencia FROM conteos c ORDER BY c.id DESC LIMIT 100`).map((x) => (perms.has('conteos.autorizar') ? x : { ...x, con_diferencia: null })));
staff('GET', '/api/conteos/:id', null, ({ params, perms }) => {
  const c = D.get('SELECT * FROM conteos WHERE id=?', params.id) || D.get('SELECT * FROM conteos WHERE numero=?', params.id);
  if (!c) err(404, 'Documento de conteo no encontrado');
  // Conteo a ciegas: solo quien autoriza los ajustes ve lo que dice el sistema
  const ciego = !perms.has('conteos.autorizar');
  const items = D.all(`SELECT i.*, p.codigo, p.nombre, p.ubicacion, p.costo_usd, c.nombre AS categoria,
      (SELECT codigo FROM codigos_barra b WHERE b.producto_id=p.id ORDER BY principal DESC LIMIT 1) AS barra
      FROM conteo_items i JOIN productos p ON p.id=i.producto_id LEFT JOIN categorias c ON c.id=p.categoria_id WHERE i.conteo_id=? ORDER BY p.ubicacion, p.nombre`, c.id);
  return { ...c, ciego, arrastre_antes: undefined, items: ciego ? items.map((i) => ({ ...i, stock_sistema: null, diferencia: null, motivo: null, clase: null, costo_usd: null })) : items };
});
staff('POST', '/api/conteos/generar', 'conteos.generar', ({ body, user, perms }) => D.tx(() => {
  if (body.regenerar && !perms.has('conteos.autorizar')) err(403, 'Solo un supervisor puede regenerar el conteo');
  return L.generarConteo(user.usuario, s(body.responsable), null, !!body.regenerar); // la cantidad sale del plan ABC, no se pide
}));
staff('POST', '/api/conteos/:id/cargar', 'conteos.cargar', ({ params, body, user }) => D.tx(() => {
  const c = D.get('SELECT * FROM conteos WHERE id=?', params.id);
  if (!c) err(404, 'Conteo no encontrado');
  if (!['generado', 'cargado'].includes(c.estado)) err(409, 'El conteo ya no admite carga de resultados');
  for (const it of body.items || []) {
    const row = D.get('SELECT * FROM conteo_items WHERE id=? AND conteo_id=?', it.id, c.id);
    if (!row) continue;
    if (it.contado === '' || it.contado == null) continue;
    const cont = num(it.contado, 'Cantidad contada inválida', 0);
    D.run('UPDATE conteo_items SET contado=?, diferencia=?, observacion=? WHERE id=?', cont, r4(cont - row.stock_sistema), s(it.observacion), row.id);
  }
  const falta = D.get('SELECT COUNT(*) AS n FROM conteo_items WHERE conteo_id=? AND contado IS NULL', c.id).n;
  D.run("UPDATE conteos SET estado='cargado', cargado_en=? WHERE id=?", D.ahora(), c.id);
  L.audit(user.usuario, 'conteo_cargado', 'conteo', c.id, { pendientes: falta });
  return { pendientes: falta };
}));
staff('POST', '/api/conteos/:id/autorizar', 'conteos.autorizar', ({ params, body, user }) => D.tx(() => {
  const c = D.get('SELECT * FROM conteos WHERE id=?', params.id);
  if (!c) err(404, 'Conteo no encontrado');
  if (c.estado !== 'cargado') err(409, 'Primero se deben cargar los resultados del conteo');
  const ids = Array.isArray(body.item_ids) ? body.item_ids.map(Number) : null;
  let n = 0;
  for (const it of D.all('SELECT i.*, p.costo_usd FROM conteo_items i JOIN productos p ON p.id=i.producto_id WHERE i.conteo_id=? AND i.contado IS NOT NULL AND i.ajustado=0', c.id)) {
    if (ids && !ids.includes(it.id)) continue;
    if (Math.abs(it.diferencia) > 0.0001) {
      L.mov(it.producto_id, 'ajuste_conteo', it.diferencia, it.costo_usd, `Ajuste conteo ${c.numero}`, 'conteo', c.id, user.usuario, L.jornadaAbierta()?.id);
      L.audit(user.usuario, 'ajuste_por_conteo', 'producto', it.producto_id, { conteo: c.numero, diferencia: it.diferencia });
      n++;
    }
    D.run('UPDATE conteo_items SET ajustado=1 WHERE id=?', it.id);
  }
  const abiertos = D.get('SELECT COUNT(*) AS n FROM conteo_items WHERE conteo_id=? AND ajustado=0', c.id).n;
  if (!abiertos) D.run("UPDATE conteos SET estado='cerrado', autorizado_por=?, autorizado_en=? WHERE id=?", user.usuario, D.ahora(), c.id);
  return { ajustes: n, pendientes: abiertos };
}));

// =====================================================================
// RECONOCIMIENTO POR IMAGEN Y RESPALDO
// =====================================================================
staff('POST', '/api/reconocer', 'ventas.crear', async ({ body, user }) => {
  const slug = D.slugActual();
  const lic = P.licencia(slug);
  if (P.usoMes(slug) >= lic.max_reconocimientos) err(402, `Alcanzaste el límite de ${lic.max_reconocimientos} reconocimientos por imagen de este mes. Busca por nombre o amplía el plan.`);
  const catalogo = D.all(`SELECT p.id, p.nombre, p.marca, p.presentacion FROM productos p WHERE p.activo=1 AND p.precio_usd>0
    ORDER BY (SELECT COUNT(*) FROM venta_detalles d WHERE d.producto_id=p.id) DESC, p.nombre LIMIT 600`);
  let r;
  try { r = await Rec.reconocer(body.imagen, catalogo); }
  catch (e) { if (e instanceof Rec.ErrorReconocer) err(e.status, e.message); throw e; }
  P.sumarUso(slug);
  L.audit(user.usuario, 'reconocimiento_imagen', 'producto', null, { candidatos: r.candidatos.map((c) => c.id), uso: r.uso });
  const productos = r.candidatos.map((c) => {
    const p = D.get(`${SQL_PRODUCTO} WHERE p.id=?`, c.id);
    return { ...conStock(p), confianza: c.confianza };
  });
  return { descripcion: r.descripcion, mensaje: r.mensaje || null, productos };
});
staff('GET', '/api/respaldo', 'parametros.editar', ({ user }) => {
  const archivo = require('node:path').join(require('node:os').tmpdir(), `abasto-${D.slugActual()}-${Date.now()}.db`);
  D.run(`VACUUM INTO '${archivo.replace(/'/g, "''")}'`);
  const buf = require('node:fs').readFileSync(archivo);
  require('node:fs').unlinkSync(archivo);
  L.audit(user.usuario, 'respaldo_descargado', 'sistema', null, { bytes: buf.length });
  return { __archivo: buf, tipo: 'application/octet-stream', nombre: `respaldo-${D.slugActual()}-${D.hoy()}.db` };
});

// =====================================================================
// ANÁLISIS FINANCIERO Y GASTOS
// =====================================================================
staff('GET', '/api/finanzas/resumen', 'finanzas.ver', ({ query }) => F.resumen(query));
staff('GET', '/api/gastos', 'finanzas.ver', ({ query }) => F.listarGastos(query));
staff('POST', '/api/gastos', 'gastos.registrar', ({ body, user }) => D.tx(() => {
  const turno = L.turnoAbiertoDe(user.id);
  return F.registrarGasto({ ...body, usuario: user.usuario, turno_id: turno ? turno.id : null });
}));
staff('POST', '/api/gastos/:id/anular', 'gastos.registrar', ({ params, body, user }) => D.tx(() => { F.anularGasto(Number(params.id), body.motivo, user.usuario); return { ok: true }; }));

// =====================================================================
// REPORTES
// =====================================================================
staff('GET', '/api/reportes/dashboard', null, () => {
  const hoy = D.hoy();
  const v = D.get("SELECT COUNT(*) AS n, COALESCE(SUM(total_usd),0) AS total FROM ventas WHERE substr(fecha,1,10)=? AND estado='completada'", hoy);
  const util = D.get(`SELECT COALESCE(SUM((d.precio_usd*d.cantidad - d.descuento_usd) - d.costo_usd*d.cantidad),0) AS u FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id WHERE substr(v.fecha,1,10)=? AND v.estado='completada'`, hoy).u;
  const medios = D.all("SELECT medio, SUM(monto_usd) AS usd, COUNT(*) AS n FROM pagos WHERE substr(fecha,1,10)=? AND anulado=0 AND tipo='venta' GROUP BY medio", hoy);
  const bajo = L.sugerenciasCompra().length;
  const cxc = D.get(`SELECT COALESCE(SUM(saldo_usd),0) AS t, COALESCE(SUM(CASE WHEN vence<? THEN saldo_usd ELSE 0 END),0) AS v FROM cxc WHERE estado IN ('pendiente','abonada')`, hoy);
  const cxp = D.get(`SELECT COALESCE(SUM(saldo_usd),0) AS t, COALESCE(SUM(CASE WHEN vence<? THEN saldo_usd ELSE 0 END),0) AS v FROM cxp WHERE estado IN ('pendiente','abonada')`, hoy);
  const cuentas = D.all('SELECT id,nombre,tipo,moneda FROM cuentas WHERE activo=1').map((c) => ({ ...c, saldo: L.saldoCuenta(c.id) }));
  const dias = D.all(`SELECT substr(fecha,1,10) AS dia, SUM(total_usd) AS total, COUNT(*) AS n FROM ventas WHERE estado='completada' AND substr(fecha,1,10)>=? GROUP BY dia ORDER BY dia`, D.sumarDias(-6));
  const top = D.all(`SELECT p.nombre, SUM(d.cantidad) AS cant, SUM(d.precio_usd*d.cantidad - d.descuento_usd) AS monto FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id JOIN productos p ON p.id=d.producto_id
      WHERE v.estado='completada' AND substr(v.fecha,1,10)>=? GROUP BY p.id ORDER BY monto DESC LIMIT 8`, D.sumarDias(-6));
  const inv = D.get('SELECT COALESCE(SUM(MAX(0,s)*c),0) AS v FROM (SELECT (SELECT COALESCE(SUM(cantidad),0) FROM inventario_movimientos m WHERE m.producto_id=p.id) AS s, p.costo_usd AS c FROM productos p WHERE p.activo=1)').v;
  const pedidos = D.get("SELECT COUNT(*) AS n FROM pedidos WHERE estado='pago_reportado'").n;
  const ordenes = D.get("SELECT COUNT(*) AS n FROM ordenes_entrega WHERE estado NOT IN ('entregada','cancelada')").n;
  return { jornada: L.jornadaAbierta(), ventas_hoy: { n: v.n, total: r2(v.total), utilidad: r2(util) }, medios, bajo_minimo: bajo, cxc, cxp, cuentas, ultimos_dias: dias, top_productos: top, inventario_usd: r2(inv), pagos_app_pendientes: pedidos, ordenes_abiertas: ordenes };
});
staff('GET', '/api/reportes/ventas', 'reportes.ver', ({ query }) => {
  const [desde, hasta] = rango(query);
  const base = "estado='completada' AND substr(fecha,1,10) BETWEEN ? AND ?";
  return {
    desde, hasta,
    totales: D.get(`SELECT COUNT(*) AS n, COALESCE(SUM(total_usd),0) AS total, COALESCE(SUM(descuento_usd),0) AS descuentos FROM ventas WHERE ${base}`, desde, hasta),
    por_dia: D.all(`SELECT substr(fecha,1,10) AS dia, COUNT(*) AS n, SUM(total_usd) AS total FROM ventas WHERE ${base} GROUP BY dia ORDER BY dia`, desde, hasta),
    por_cajero: D.all(`SELECT usuario, COUNT(*) AS n, SUM(total_usd) AS total FROM ventas WHERE ${base} GROUP BY usuario ORDER BY total DESC`, desde, hasta),
    por_medio: D.all(`SELECT medio, moneda, COUNT(*) AS n, SUM(monto) AS monto, SUM(monto_usd) AS usd FROM pagos WHERE tipo='venta' AND anulado=0 AND substr(fecha,1,10) BETWEEN ? AND ? GROUP BY medio, moneda ORDER BY usd DESC`, desde, hasta),
    por_origen: D.all(`SELECT origen, COUNT(*) AS n, SUM(total_usd) AS total FROM ventas WHERE ${base} GROUP BY origen`, desde, hasta)
  };
});
staff('GET', '/api/reportes/utilidad', 'reportes.ver', ({ query }) => {
  const [desde, hasta] = rango(query);
  const rows = D.all(`SELECT p.codigo, p.nombre, c.nombre AS categoria, SUM(d.cantidad) AS cantidad,
      SUM(d.precio_usd*d.cantidad - d.descuento_usd) AS venta, SUM(d.costo_usd*d.cantidad) AS costo
      FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id JOIN productos p ON p.id=d.producto_id LEFT JOIN categorias c ON c.id=p.categoria_id
      WHERE v.estado='completada' AND substr(v.fecha,1,10) BETWEEN ? AND ? GROUP BY p.id ORDER BY venta DESC`, desde, hasta);
  return { desde, hasta, filas: rows.map((r) => ({ ...r, venta: r2(r.venta), costo: r2(r.costo), utilidad: r2(r.venta - r.costo), margen_pct: r.venta > 0 ? r2((r.venta - r.costo) / r.venta * 100) : 0 })) };
});
staff('GET', '/api/reportes/cumplimiento-conteos', 'reportes.ver', () => {
  const c = L.clasificarABC();
  const desde = D.sumarDias(-365);
  const contados = D.all(`SELECT i.producto_id, COUNT(*) AS veces, SUM(CASE WHEN ABS(COALESCE(i.diferencia,0))>0.0001 THEN 1 ELSE 0 END) AS difs
      FROM conteo_items i JOIN conteos k ON k.id=i.conteo_id WHERE i.contado IS NOT NULL AND substr(k.fecha,1,10)>=? GROUP BY i.producto_id`, desde);
  const mapa = new Map(contados.map((r) => [r.producto_id, r]));
  const out = { A: { productos: 0, contados: 0, vueltas_plan: c.cfg.vueltasA, conteos: 0 }, B: { productos: 0, contados: 0, vueltas_plan: c.cfg.vueltasB, conteos: 0 }, C: { productos: 0, contados: 0, vueltas_plan: c.cfg.vueltasC, conteos: 0 } };
  const pendientes = [];
  for (const p of c.productos) {
    const o = out[p.clase]; o.productos++;
    const m = mapa.get(p.id);
    if (m) { o.contados++; o.conteos += m.veces; } else pendientes.push({ codigo: p.codigo, nombre: p.nombre, clase: p.clase });
  }
  const dif = D.all(`SELECT p.codigo, p.nombre, COUNT(*) AS veces, SUM(i.diferencia*p.costo_usd) AS valor_usd FROM conteo_items i JOIN productos p ON p.id=i.producto_id
      WHERE i.diferencia IS NOT NULL AND ABS(i.diferencia)>0.0001 GROUP BY p.id ORDER BY ABS(valor_usd) DESC LIMIT 30`);
  return { por_clase: out, pendientes: pendientes.slice(0, 100), total_pendientes: pendientes.length, diferencias: dif.map((d) => ({ ...d, valor_usd: r2(d.valor_usd) })) };
});
staff('GET', '/api/auditoria', 'reportes.ver', ({ query }) => {
  const w = [], a = [];
  if (query.accion) { w.push('accion LIKE ?'); a.push(like(query.accion)); }
  if (query.usuario) { w.push('usuario=?'); a.push(query.usuario); }
  return D.all(`SELECT * FROM auditoria ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, ...a);
});

// =====================================================================
// APP DE CLIENTES (PWA /tienda)
// =====================================================================
function sanitizarCliente(c) { return { id: c.id, nombre: c.nombre, telefono: c.telefono, documento: c.documento, direccion: c.direccion }; }
pub('POST', '/api/app/registro', ({ body, ip }) => {
  limitarIntentos('reg|' + ip);
  const telefono = D.normalizarTelefono(req(body.telefono, 'Indica tu teléfono'));
  if (telefono.length < 7) err(400, 'Teléfono inválido');
  const pin = String(body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) err(400, 'El PIN debe tener entre 4 y 8 dígitos');
  let c = D.get('SELECT * FROM clientes WHERE telefono=?', telefono);
  if (c) {
    if (c.pin_hash) err(409, 'Ese teléfono ya tiene cuenta. Inicia sesión.');
    if (c.credito_habilitado) err(409, 'Tu cuenta ya existe en el abasto. Pide al encargado que te active el acceso a la app.');
    D.run('UPDATE clientes SET pin_hash=? WHERE id=?', D.hashClave(pin), c.id);
  } else {
    const id = D.insert('INSERT INTO clientes(nombre,documento,telefono,direccion,pin_hash,creado) VALUES(?,?,?,?,?,?)', req(body.nombre, 'Indica tu nombre'), s(body.documento), telefono, s(body.direccion), D.hashClave(pin), D.ahora());
    c = D.get('SELECT * FROM clientes WHERE id=?', id);
  }
  return { token: nuevaSesion('cli', c.id, 24 * 30), cliente: sanitizarCliente(c) };
});
pub('POST', '/api/app/login', ({ body, ip }) => {
  const telefono = D.normalizarTelefono(body.telefono) || '';
  limitarIntentos('cli|' + ip + '|' + telefono);
  const c = D.get('SELECT * FROM clientes WHERE telefono=?', telefono);
  if (!c || !D.verificarClave(String(body.pin || ''), c.pin_hash)) err(401, 'Teléfono o PIN incorrectos. Si es tu primera vez, toca "Crear cuenta".');
  limpiarIntentos('cli|' + ip + '|' + telefono);
  return { token: nuevaSesion('cli', c.id, 24 * 30), cliente: sanitizarCliente(c) };
});
pub('GET', '/api/app/config', () => {
  const j = L.jornadaAbierta() || L.ultimaTasa();
  const e = D.param('empresa');
  const lic = P.licencia(D.slugActual());
  return { empresa: { nombre: e.nombre, telefono: e.telefono, direccion: e.direccion, logo: e.logo || '' }, tasa_usd_ves: j ? j.tasa_usd_ves : null, tasa_eur_usd: j ? j.tasa_eur_usd : null, abierto: !!L.jornadaAbierta(),
    reserva_minutos: D.param('operacion').reserva_minutos, cerrado: !['activa', 'gracia'].includes(lic.estado) };
});
pub('GET', '/api/app/catalogo', ({ query }) => {
  L.barrerReservas();
  const w = ['p.activo=1', 'p.precio_usd>0'], a = [];
  if (query.q) { w.push('(p.nombre LIKE ? OR p.marca LIKE ? OR EXISTS(SELECT 1 FROM codigos_barra b WHERE b.producto_id=p.id AND b.codigo=?))'); a.push(like(query.q), like(query.q), String(query.q).trim()); }
  if (query.categoria_id) { w.push('p.categoria_id=?'); a.push(Number(query.categoria_id)); }
  const rows = D.all(`SELECT p.id,p.nombre,p.marca,p.presentacion,p.unidad_venta,p.precio_usd,p.imagen,p.categoria_id,c.nombre AS categoria,
      COALESCE((SELECT SUM(cantidad) FROM inventario_movimientos m WHERE m.producto_id=p.id),0) AS stock FROM productos p LEFT JOIN categorias c ON c.id=p.categoria_id
      WHERE ${w.join(' AND ')} ORDER BY p.nombre LIMIT 400`, ...a);
  return { categorias: D.all("SELECT id,nombre FROM categorias WHERE activo=1 ORDER BY nombre"),
    productos: rows.map((p) => { const disp = Math.max(0, r2(p.stock - L.reservadoDe(p.id))); const { stock, ...x } = p; return { ...x, disponible: disp }; }).filter((p) => p.disponible > 0 || query.todos) };
});
pub('GET', '/api/app/medios-pago', () => D.all("SELECT id,medio,banco,tipo_doc,documento,telefono,titular,num_cuenta,tipo_cuenta,moneda,observacion FROM medios_pago_app WHERE estado='publicado' ORDER BY medio, banco"));
cli('GET', '/api/app/perfil', ({ cliente }) => sanitizarCliente(cliente));
cli('POST', '/api/app/pedidos', ({ body, cliente }) => D.tx(() => {
  if (cliente.estado !== 'activo') err(403, 'Tu cuenta está suspendida');
  return crearPedido({ ...body, cliente_id: cliente.id, origen: 'app' });
}));
cli('GET', '/api/app/pedidos', ({ cliente }) => {
  L.barrerReservas();
  return D.all('SELECT p.*, o.estado AS orden_estado FROM pedidos p LEFT JOIN ordenes_entrega o ON o.pedido_id=p.id WHERE p.cliente_id=? ORDER BY p.id DESC LIMIT 50', cliente.id)
    .map((p) => ({ id: p.id, numero: p.numero, estado: p.estado, total_usd: p.total_usd, creado: p.creado, expira: p.expira, entrega: p.entrega, semaforo: L.semaforo(p, p.orden_estado ? { estado: p.orden_estado } : null) }));
});
cli('GET', '/api/app/pedidos/:id', ({ params, cliente }) => {
  L.barrerReservas();
  const p = detallePedido(Number(params.id), true);
  if (!p || p.cliente_id !== cliente.id) err(404, 'Pedido no encontrado');
  const { vendedor, venta_id, ...pub_ } = p;
  pub_.orden = p.orden ? { estado: p.orden.estado, repartidor: p.orden.repartidor, repartidor_tel: p.orden.repartidor_tel, retirado_en: p.orden.retirado_en, salida_en: p.orden.salida_en, entregado_en: p.orden.entregado_en, receptor: p.orden.receptor } : null;
  return pub_;
});
cli('POST', '/api/app/pedidos/:id/pago', ({ params, body, cliente }) => D.tx(() => {
  L.barrerReservas();
  const p = D.get('SELECT * FROM pedidos WHERE id=? AND cliente_id=?', params.id, cliente.id);
  if (!p) err(404, 'Pedido no encontrado');
  if (!['pendiente', 'pago_reportado'].includes(p.estado)) err(409, 'Este pedido ya no admite reporte de pago');
  const m = D.get("SELECT * FROM medios_pago_app WHERE id=? AND estado='publicado'", body.medio_app_id);
  if (!m) err(400, 'Selecciona una de las formas de pago publicadas');
  const monto = num(body.monto, 'Indica el monto pagado', 0.01);
  let pagaCon = null;
  if (m.medio === 'efectivo' && (body.paga_con == null || body.paga_con === '')) err(400, 'Indica con qué denominación vas a pagar en efectivo para que preparemos tu vuelto');
  if (m.medio === 'efectivo') { pagaCon = num(body.paga_con, 'Indica con qué denominación vas a pagar', 0.01); if (pagaCon < monto - 0.005) err(400, 'Con lo que vas a pagar no alcanza para el total del pedido'); }
  const alRecibir = ['efectivo', 'punto'].includes(m.medio); // se paga al retirar o al entregar: sin referencia ni banco emisor
  if (!alRecibir) { req(body.referencia, 'Indica el número de referencia'); req(body.banco_emisor, 'Indica el banco desde el que pagaste'); }
  let comp = body.comprobante ? String(body.comprobante) : null;
  if (comp && (!comp.startsWith('data:image/') || comp.length > 1700000)) err(400, 'El comprobante debe ser una imagen de menos de 1,2 MB');
  if (!alRecibir && D.get("SELECT id FROM pagos_reportados WHERE medio_app_id=? AND referencia=? AND estado<>'rechazado'", m.id, String(body.referencia).trim()))
    err(409, 'Esa referencia ya fue reportada');
  const id = D.insert('INSERT INTO pagos_reportados(pedido_id,medio_app_id,monto,moneda,banco_emisor,referencia,comprobante,creado,paga_con) VALUES(?,?,?,?,?,?,?,?,?)', p.id, m.id, monto, m.moneda, alRecibir ? 'Pagará al recibir' : s(body.banco_emisor), alRecibir ? 'AL RECIBIR' : String(body.referencia).trim(), alRecibir ? null : comp, D.ahora(), pagaCon);
  const ext = D.sumarMinutos(D.param('operacion').reserva_extension_minutos);
  D.run("UPDATE reservas SET expira=? WHERE pedido_id=? AND estado='activa'", ext, p.id);
  D.run("UPDATE pedidos SET estado='pago_reportado', expira=? WHERE id=?", ext, p.id);
  return { id };
}));
cli('POST', '/api/app/pedidos/:id/cancelar', ({ params, cliente }) => D.tx(() => {
  const p = D.get('SELECT * FROM pedidos WHERE id=? AND cliente_id=?', params.id, cliente.id);
  if (!p) err(404, 'Pedido no encontrado');
  if (p.estado !== 'pendiente') err(409, 'Solo puedes cancelar pedidos que aún no reportaron pago');
  L.liberarReservas(p.id);
  D.run("UPDATE pedidos SET estado='cancelado', motivo='Cancelado por el cliente', expira=NULL WHERE id=?", p.id);
  return { ok: true };
}));

module.exports = { rutas, permisosDe, sesionDe, ROLES, PERMS, R };
