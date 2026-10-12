'use strict';
// API del panel de la plataforma (/plataforma/): alta de abastos, licencias, pagos y uso.
const D = require('./db');
const P = require('./plataforma');
const { HttpError } = require('./lib');
const { R } = require('./routes');

const err = (s, m) => { throw new HttpError(s, m); };
const global_ = (m, r, fn) => R(m, r, 'global', null, fn);
const plat = (m, r, fn) => R(m, r, 'plat', null, fn);

const intentos = new Map();
function limitar(clave) {
  const ahora = Date.now();
  const l = (intentos.get(clave) || []).filter((t) => ahora - t < 60000);
  if (l.length >= 6) err(429, 'Demasiados intentos. Espera un minuto.');
  l.push(ahora); intentos.set(clave, l);
}

global_('GET', '/api/plataforma/info', () => {
  const unica = P.unica();
  return { unica, multi: P.listaSlugs().length > 1 };
});
global_('POST', '/api/plataforma/login', ({ body, ip }) => {
  limitar('plat|' + ip);
  const r = P.login(body.usuario, body.clave);
  if (!r) err(401, 'Usuario o clave incorrectos');
  P.bitacora(r.usuario, 'login', null, null);
  return r;
});
plat('POST', '/api/plataforma/logout', ({ token }) => { P.r('DELETE FROM sesiones WHERE token=?', token); return { ok: true }; });
plat('GET', '/api/plataforma/resumen', () => {
  const lista = P.listarEmpresas();
  const activas = lista.filter((e) => ['activa', 'gracia'].includes(e.licencia.estado));
  const hoy = D.hoy();
  const mes = hoy.slice(0, 7);
  const cobrado = P.g("SELECT COALESCE(SUM(monto_usd),0) AS t FROM pagos_licencia WHERE substr(fecha,1,7)=?", mes).t;
  return {
    empresas: lista.length, activas: activas.length, por_vencer: lista.filter((e) => e.licencia.estado === 'activa' && e.licencia.dias_restantes <= 7).length,
    vencidas: lista.filter((e) => ['gracia', 'vencida', 'suspendida'].includes(e.licencia.estado)).length,
    mrr_usd: Math.round(activas.reduce((a, e) => a + e.precio_usd, 0) * 100) / 100, cobrado_mes_usd: Math.round(cobrado * 100) / 100
  };
});
plat('GET', '/api/plataforma/empresas', () => P.listarEmpresas());
plat('POST', '/api/plataforma/empresas', ({ body, operador }) => P.crearEmpresa(body, operador.usuario));
plat('PUT', '/api/plataforma/empresas/:id', ({ params, body, operador }) => {
  const e = P.g('SELECT * FROM empresas WHERE id=?', params.id);
  if (!e) err(404, 'Empresa no encontrada');
  const n = (v, def) => (v == null || v === '' ? def : Number(v));
  if (body.estado && !['activa', 'suspendida'].includes(body.estado)) err(400, 'Estado no válido');
  P.r(`UPDATE empresas SET nombre=?, estado=?, plan=?, precio_usd=?, max_usuarios=?, max_productos=?, max_reconocimientos=?, contacto=?, telefono=?, notas=? WHERE id=?`,
    String(body.nombre || e.nombre).trim(), body.estado || e.estado, body.plan || e.plan, n(body.precio_usd, e.precio_usd), n(body.max_usuarios, e.max_usuarios), n(body.max_productos, e.max_productos),
    n(body.max_reconocimientos, e.max_reconocimientos), body.contacto !== undefined ? body.contacto : e.contacto, body.telefono !== undefined ? body.telefono : e.telefono, body.notas !== undefined ? body.notas : e.notas, e.id);
  P.invalidar(e.slug);
  P.bitacora(operador.usuario, 'empresa_editada', e.slug, { estado: body.estado, plan: body.plan });
  return { ok: true };
});
plat('POST', '/api/plataforma/empresas/:id/pago', ({ params, body, operador }) => P.registrarPago(Number(params.id), body, operador.usuario));
plat('GET', '/api/plataforma/empresas/:id/pagos', ({ params }) => P.q('SELECT * FROM pagos_licencia WHERE empresa_id=? ORDER BY id DESC', params.id));
plat('POST', '/api/plataforma/empresas/:id/clave-admin', ({ params, body, operador }) => {
  const e = P.g('SELECT * FROM empresas WHERE id=?', params.id);
  if (!e) err(404, 'Empresa no encontrada');
  const clave = String(body.clave || '');
  if (clave.length < 6) err(400, 'La clave debe tener al menos 6 caracteres');
  D.conEmpresa(e.slug, () => {
    D.run("UPDATE usuarios SET clave_hash=?, activo=1 WHERE usuario='admin'", D.hashClave(clave));
    D.run("DELETE FROM sesiones WHERE tipo='staff'");
  });
  P.bitacora(operador.usuario, 'clave_admin_restablecida', e.slug, null);
  return { ok: true };
});
plat('GET', '/api/plataforma/bitacora', () => P.q('SELECT * FROM bitacora ORDER BY id DESC LIMIT 200'));
