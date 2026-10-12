'use strict';
// Base de la plataforma: empresas (abastos), licencias, pagos de licencia, uso y operadores de la plataforma.
// Cada empresa tiene su propia base SQLite (ver db.js); aquí solo vive lo que las une.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const D = require('./db');
const { HttpError } = require('./lib');

const pdb = new DatabaseSync(path.join(D.DATA_DIR, 'plataforma.db'));
pdb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
pdb.exec(`
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'activa',
  plan TEXT NOT NULL DEFAULT 'basico', precio_usd REAL NOT NULL DEFAULT 20, licencia_vence TEXT NOT NULL,
  max_usuarios INTEGER NOT NULL DEFAULT 5, max_productos INTEGER NOT NULL DEFAULT 1000, max_reconocimientos INTEGER NOT NULL DEFAULT 200,
  contacto TEXT, telefono TEXT, notas TEXT, creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pagos_licencia (
  id INTEGER PRIMARY KEY, empresa_id INTEGER NOT NULL, fecha TEXT NOT NULL, monto_usd REAL NOT NULL, meses INTEGER NOT NULL,
  metodo TEXT, referencia TEXT, nota TEXT, vence_anterior TEXT, vence_nuevo TEXT, usuario TEXT
);
CREATE TABLE IF NOT EXISTS operadores (id INTEGER PRIMARY KEY, usuario TEXT NOT NULL UNIQUE, clave_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones (token TEXT PRIMARY KEY, operador_id INTEGER NOT NULL, expira TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uso (slug TEXT NOT NULL, mes TEXT NOT NULL, reconocimientos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (slug, mes));
CREATE TABLE IF NOT EXISTS bitacora (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, operador TEXT, accion TEXT NOT NULL, empresa TEXT, detalle TEXT);
`);

const GRACIA_DIAS = 5;
const g = (sql, ...a) => pdb.prepare(sql).get(...a);
const q = (sql, ...a) => pdb.prepare(sql).all(...a);
const r = (sql, ...a) => pdb.prepare(sql).run(...a);
const ins = (sql, ...a) => Number(pdb.prepare(sql).run(...a).lastInsertRowid);

const diffDias = (hasta, desde) => Math.round((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 86400000);
function sumarMeses(fecha, n) {
  const d = new Date(fecha + 'T12:00:00');
  const dia = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ult));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function bitacora(operador, accion, empresa, detalle) {
  r('INSERT INTO bitacora(fecha,operador,accion,empresa,detalle) VALUES(?,?,?,?,?)', D.ahora(), operador || null, accion, empresa || null, detalle == null ? null : JSON.stringify(detalle));
}

// ---------- licencias ----------
function calcularLicencia(e) {
  if (!e) return { estado: 'inexistente' };
  const dias = diffDias(e.licencia_vence, D.hoy());
  let estado = dias >= 0 ? 'activa' : dias >= -GRACIA_DIAS ? 'gracia' : 'vencida';
  if (e.estado === 'suspendida') estado = 'suspendida';
  return { estado, vence: e.licencia_vence, dias_restantes: dias, gracia_dias: GRACIA_DIAS, plan: e.plan, nombre: e.nombre,
    max_usuarios: e.max_usuarios, max_productos: e.max_productos, max_reconocimientos: e.max_reconocimientos };
}
const cache = new Map();
function licencia(slug) {
  const c = cache.get(slug);
  if (c && Date.now() - c.t < 15000) return c.v;
  const v = calcularLicencia(g('SELECT * FROM empresas WHERE slug=?', slug));
  cache.set(slug, { t: Date.now(), v });
  return v;
}
const invalidar = (slug) => cache.delete(slug);
const empresaPorSlug = (slug) => g('SELECT * FROM empresas WHERE slug=?', slug);
const listaSlugs = () => q('SELECT slug FROM empresas ORDER BY id').map((x) => x.slug);
// Si solo existe una empresa activa, el login y la tienda no necesitan el código.
function unica() { const l = q("SELECT slug FROM empresas WHERE estado='activa'"); return l.length === 1 ? l[0].slug : null; }

// Empresa a la que van los enlaces sin código (/tienda/, login sin código): la única activa o, si hay varias, la que tiene plan 'propio' (la del dueño de la instalación).
function predeterminada() {
  const u = unica();
  if (u) return u;
  const p = q("SELECT slug FROM empresas WHERE plan='propio' AND estado='activa'");
  return p.length === 1 ? p[0].slug : null;
}

// ---------- uso (reconocimiento por imagen) ----------
const mesActual = () => D.hoy().slice(0, 7);
const usoMes = (slug) => (g('SELECT reconocimientos AS n FROM uso WHERE slug=? AND mes=?', slug, mesActual()) || { n: 0 }).n;
function sumarUso(slug) {
  r('INSERT INTO uso(slug,mes,reconocimientos) VALUES(?,?,1) ON CONFLICT(slug,mes) DO UPDATE SET reconocimientos=reconocimientos+1', slug, mesActual());
}

// ---------- empresas ----------
function crearEmpresa(o, operador) {
  const slug = String(o.slug || '').trim().toLowerCase();
  if (!D.validarSlug(slug)) throw new HttpError(400, 'Código inválido: usa 2 a 31 letras minúsculas, números o guiones (no puede ser una palabra reservada)');
  if (empresaPorSlug(slug)) throw new HttpError(409, 'Ya existe una empresa con ese código');
  const nombre = String(o.nombre || '').trim();
  if (!nombre) throw new HttpError(400, 'Indica el nombre de la empresa');
  const dias = Number.isFinite(Number(o.dias_prueba)) ? Number(o.dias_prueba) : 30;
  const vence = D.sumarDias(dias);
  let adminClave = null;
  D.conEmpresa(slug, () => { adminClave = D.inicializar({ adminClave: o.admin_clave || undefined, nombre }); });
  const id = ins(`INSERT INTO empresas(slug,nombre,plan,precio_usd,licencia_vence,max_usuarios,max_productos,max_reconocimientos,contacto,telefono,notas,creado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, nombre, o.plan || 'basico', o.precio_usd != null ? Number(o.precio_usd) : 20, vence, Number(o.max_usuarios) || 5, Number(o.max_productos) || 1000,
    o.max_reconocimientos != null ? Number(o.max_reconocimientos) : 200, o.contacto || null, o.telefono || null, o.notas || null, D.ahora());
  bitacora(operador, 'empresa_creada', slug, { nombre, vence });
  return { id, slug, admin_clave: adminClave, licencia_vence: vence };
}
function registrarPago(id, o, operador) {
  const e = g('SELECT * FROM empresas WHERE id=?', id);
  if (!e) throw new HttpError(404, 'Empresa no encontrada');
  const meses = Math.round(Number(o.meses));
  const monto = Number(o.monto_usd);
  if (!(meses >= 1 && meses <= 36)) throw new HttpError(400, 'Indica de 1 a 36 meses');
  if (!(monto >= 0)) throw new HttpError(400, 'Monto inválido');
  const base = e.licencia_vence > D.hoy() ? e.licencia_vence : D.hoy();
  const nuevo = sumarMeses(base, meses);
  ins('INSERT INTO pagos_licencia(empresa_id,fecha,monto_usd,meses,metodo,referencia,nota,vence_anterior,vence_nuevo,usuario) VALUES(?,?,?,?,?,?,?,?,?,?)',
    e.id, D.ahora(), monto, meses, o.metodo || null, o.referencia || null, o.nota || null, e.licencia_vence, nuevo, operador);
  r("UPDATE empresas SET licencia_vence=?, estado='activa' WHERE id=?", nuevo, e.id);
  invalidar(e.slug);
  bitacora(operador, 'pago_licencia', e.slug, { monto, meses, nuevo });
  return { licencia_vence: nuevo };
}
function listarEmpresas() {
  return q('SELECT * FROM empresas ORDER BY id').map((e) => {
    const lic = calcularLicencia(e);
    let usuarios = null, productos = null;
    try { D.conEmpresa(e.slug, () => { usuarios = D.get('SELECT COUNT(*) AS n FROM usuarios WHERE activo=1').n; productos = D.get('SELECT COUNT(*) AS n FROM productos WHERE activo=1').n; }); } catch {}
    return { ...e, licencia: lic, usuarios, productos, reconocimientos_mes: usoMes(e.slug) };
  });
}

// ---------- operadores de la plataforma ----------
function nuevaSesion(operadorId) {
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + 8 * 3600000);
  r('INSERT INTO sesiones(token,operador_id,expira) VALUES(?,?,?)', token, operadorId, exp.toISOString());
  return token;
}
function operadorDeToken(token) {
  if (!token) return null;
  const s = g('SELECT * FROM sesiones WHERE token=?', token);
  if (!s) return null;
  if (s.expira < new Date().toISOString()) { r('DELETE FROM sesiones WHERE token=?', token); return null; }
  return g('SELECT id, usuario FROM operadores WHERE id=?', s.operador_id) || null;
}
function login(usuario, clave) {
  const o = g('SELECT * FROM operadores WHERE usuario=?', String(usuario || '').toLowerCase());
  if (!o || !D.verificarClave(String(clave || ''), o.clave_hash)) return null;
  return { token: nuevaSesion(o.id), usuario: o.usuario };
}

// ---------- arranque ----------
function iniciar() {
  const avisos = [];
  if (!g('SELECT id FROM operadores LIMIT 1')) {
    const clave = process.env.PLATAFORMA_CLAVE || crypto.randomBytes(6).toString('hex');
    ins('INSERT INTO operadores(usuario,clave_hash) VALUES(?,?)', 'plataforma', D.hashClave(clave));
    fs.writeFileSync(path.join(D.DATA_DIR, 'PLATAFORMA_ACCESO.txt'), `Panel de la plataforma: /plataforma/\nUsuario: plataforma\nClave: ${clave}\n`);
    avisos.push('Operador de plataforma creado: clave en data/PLATAFORMA_ACCESO.txt');
  }
  if (!g('SELECT id FROM empresas LIMIT 1')) {
    // Instalación de un solo abasto: se crea la empresa "principal" con licencia larga.
    const legado = path.join(D.DATA_DIR, 'abasto.db');
    if (fs.existsSync(legado) && !fs.existsSync(path.join(D.EMP_DIR, 'principal.db'))) fs.copyFileSync(legado, path.join(D.EMP_DIR, 'principal.db'));
    const e = crearEmpresa({ slug: 'principal', nombre: process.env.EMPRESA_NOMBRE || 'Mi Abasto', plan: 'propio', precio_usd: 0, dias_prueba: 3650, admin_clave: process.env.ADMIN_PASSWORD || undefined, max_usuarios: 50, max_productos: 100000, max_reconocimientos: 100000 }, 'sistema');
    if (e.admin_clave) {
      fs.writeFileSync(path.join(D.DATA_DIR, 'PRIMER_ACCESO.txt'), `Usuario: admin\nClave: ${e.admin_clave}\nEmpresa: principal\nCámbiala desde Parámetros > Usuarios.\n`);
      avisos.push('Empresa "principal" creada: clave del admin en data/PRIMER_ACCESO.txt');
    }
  }
  return avisos;
}

module.exports = { pdb, GRACIA_DIAS, licencia, invalidar, empresaPorSlug, listaSlugs, unica, predeterminada, usoMes, sumarUso, crearEmpresa, registrarPago, listarEmpresas, login, operadorDeToken, iniciar, bitacora, g, q, r, calcularLicencia };
