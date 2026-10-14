'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db');
const L = require('./lib');
const P = require('./plataforma');
const { rutas, permisosDe, sesionDe } = require('./routes');
require('./plataforma_rutas');
const { respaldarTodo } = require('./respaldo');

const PORT = Number(process.env.PORT) || 3300;
const PUBLIC = path.join(__dirname, 'public');
const CONFIAR_PROXY = process.env.TRUST_PROXY === '1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SEG = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 4_000_000) { reject(new L.HttpError(413, 'Cuerpo demasiado grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { reject(new L.HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function responder(res, status, obj) {
  if (obj && obj.__archivo) {
    res.writeHead(status, { ...SEG, 'Content-Type': obj.tipo, 'Content-Disposition': `attachment; filename="${obj.nombre}"`, 'Cache-Control': 'no-store' });
    return res.end(obj.__archivo);
  }
  res.writeHead(status, { ...SEG, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj === undefined ? null : obj));
}
const ipDe = (req) => (CONFIAR_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress || '');

// Reglas de licencia: suspendida = cerrada; vencida (pasada la gracia) = solo lectura.
function aplicarLicencia(lic, metodo, ruta) {
  if (lic.estado === 'inexistente') throw new L.HttpError(404, 'Empresa no encontrada');
  const libres = ['/api/health', '/api/app/config'];
  if (lic.estado === 'suspendida' && !libres.includes(ruta)) throw new L.HttpError(402, 'Esta cuenta está suspendida. Comunícate con el proveedor del sistema.');
  if (lic.estado === 'vencida' && metodo !== 'GET' && !['/api/logout', '/api/login'].includes(ruta))
    throw new L.HttpError(402, 'La licencia venció: el sistema está en modo solo lectura. Renueva tu plan para seguir operando.');
}

async function api(req, res, url) {
  const metodo = req.method;
  const ruta = rutas.find((r) => r.metodo === metodo && r.re.test(url.pathname));
  if (!ruta) {
    if (rutas.some((r) => r.re.test(url.pathname))) throw new L.HttpError(405, 'Método no permitido');
    throw new L.HttpError(404, 'Ruta no encontrada');
  }
  const m = url.pathname.match(ruta.re);
  const params = {};
  ruta.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  const ctx = { params, query: Object.fromEntries(url.searchParams), ip: ipDe(req), token, body: {} };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) ctx.body = await leerCuerpo(req);

  if (ruta.scope === 'global') return responder(res, 200, await ruta.fn(ctx));
  if (ruta.scope === 'plat') {
    const op = P.operadorDeToken(token);
    if (!op) throw new L.HttpError(401, 'Sesión de plataforma vencida');
    ctx.operador = op;
    return responder(res, 200, await ruta.fn(ctx));
  }

  // --- rutas de una empresa: se resuelve cuál ---
  let slug;
  if (ruta.scope === 'pub') slug = String(req.headers['x-empresa'] || ctx.body.empresa || ctx.query.e || '').toLowerCase() || P.predeterminada();
  else slug = token && token.includes('.') ? token.slice(0, token.lastIndexOf('.')) : null;
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug))
    throw new L.HttpError(ruta.scope === 'pub' ? 400 : 401, ruta.scope === 'pub' ? 'Indica el código de la empresa' : 'Inicia sesión para continuar');
  const lic = P.licencia(slug);
  if (lic.estado === 'inexistente') throw new L.HttpError(ruta.scope === 'pub' ? 404 : 401, ruta.scope === 'pub' ? 'No existe una empresa con ese código' : 'Inicia sesión para continuar');
  aplicarLicencia(lic, metodo, url.pathname);

  const resultado = await D.conEmpresa(slug, async () => {
    if (ruta.scope === 'staff') {
      const ses = sesionDe(token, 'staff');
      const u = ses && D.get('SELECT id,nombre,usuario,rol FROM usuarios WHERE id=? AND activo=1', ses.ref_id);
      if (!u) throw new L.HttpError(401, 'Sesión vencida: inicia sesión de nuevo');
      ctx.user = u; ctx.perms = permisosDe(u.rol);
      // un repartidor no ve ventas, clientes ni inventario: solo su API de reparto
      if (u.rol === 'repartidor' && !url.pathname.startsWith('/api/reparto/') && !['/api/me', '/api/logout', '/api/me/clave'].includes(url.pathname)) throw new L.HttpError(403, 'No tienes permiso para esta acción');
      if (ruta.perm && !ctx.perms.has(ruta.perm)) throw new L.HttpError(403, 'No tienes permiso para esta acción');
    } else if (ruta.scope === 'cli') {
      const ses = sesionDe(token, 'cli');
      const c = ses && D.get('SELECT * FROM clientes WHERE id=?', ses.ref_id);
      if (!c) throw new L.HttpError(401, 'Inicia sesión para continuar');
      ctx.cliente = c;
    }
    return ruta.fn(ctx);
  });
  // conexión que se queda abierta (aviso inmediato a los repartidores)
  if (resultado && resultado.__flujo) {
    res.writeHead(200, { ...SEG, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    return resultado.__flujo(res, req);
  }
  responder(res, 200, resultado);
}

function servirArchivo(res, archivo, cache = 'no-cache') {
  fs.readFile(archivo, (e, data) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { ...SEG, 'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}
function estatico(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  for (const base of ['/tienda', '/plataforma', '/reparto']) if (p === base) { res.writeHead(301, { Location: base + '/' }); return res.end(); }
  // Manifiesto de la app de clientes, personalizado por empresa
  if (p === '/tienda/manifest.webmanifest') {
    const slug = String(url.searchParams.get('e') || '').toLowerCase();
    let nombre = 'Pedidos al abasto';
    if (slug && D.existeEmpresa(slug)) { try { nombre = D.conEmpresa(slug, () => D.param('empresa').nombre) || nombre; } catch {} }
    res.writeHead(200, { ...SEG, 'Content-Type': MIME['.webmanifest'] });
    return res.end(JSON.stringify({ name: nombre, short_name: nombre.slice(0, 12), start_url: slug ? `/tienda/${slug}/` : '/tienda/', scope: '/tienda/', display: 'standalone', background_color: '#f4f5f7', theme_color: '#0f7b5f',
      icons: [{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230f7b5f'/%3E%3Cpath d='M8 12h16l-2 11H10z' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E", sizes: 'any', type: 'image/svg+xml' }] }));
  }
  if (p === '/reparto/manifest.webmanifest') {
    const slug = String(url.searchParams.get('e') || '').toLowerCase();
    let nombre = 'Reparto';
    if (slug && D.existeEmpresa(slug)) { try { nombre = 'Reparto ' + (D.conEmpresa(slug, () => D.param('empresa').nombre) || ''); } catch {} }
    res.writeHead(200, { ...SEG, 'Content-Type': MIME['.webmanifest'] });
    return res.end(JSON.stringify({ name: nombre.trim(), short_name: 'Reparto', start_url: slug ? `/reparto/${slug}/` : '/reparto/', scope: '/reparto/', display: 'standalone', background_color: '#f4f5f7', theme_color: '#0f7b5f',
      icons: [{ src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230f7b5f'/%3E%3Ccircle cx='10' cy='22' r='3' fill='none' stroke='white' stroke-width='2'/%3E%3Ccircle cx='23' cy='22' r='3' fill='none' stroke='white' stroke-width='2'/%3E%3Cpath d='M10 22l4-9h5l4 9' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E", sizes: 'any', type: 'image/svg+xml' }] }));
  }
  if (p.startsWith('/reparto/')) {
    const primero = p.slice(9).split('/')[0];
    if (primero && !primero.includes('.')) p = '/reparto/index.html';
  }
  // /tienda/<codigo>/ muestra la misma app, que lee el código de la ruta
  if (p.startsWith('/tienda/')) {
    const primero = p.slice(8).split('/')[0];
    if (primero && !primero.includes('.')) p = '/tienda/index.html';
  }
  if (p.endsWith('/')) p += 'index.html';
  const archivo = path.normalize(path.join(PUBLIC, p));
  if (!archivo.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  servirArchivo(res, archivo);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else estatico(req, res, url);
  } catch (e) {
    if (e instanceof L.HttpError) return responder(res, e.status, { error: e.message });
    console.error(e);
    const unico = /UNIQUE/.test(String(e.message));
    responder(res, unico ? 409 : 500, { error: unico ? 'Ya existe un registro con esos datos' : 'Error interno del servidor' });
  }
});

// Tareas periódicas por empresa: liberar reservas vencidas y limpiar sesiones.
function tareasMinuto() {
  for (const slug of P.listaSlugs()) {
    if (['inexistente', 'suspendida'].includes(P.licencia(slug).estado)) continue;
    try { D.conEmpresa(slug, () => { L.barrerReservas(); D.run('DELETE FROM sesiones WHERE expira<?', D.ahora()); }); } catch (e) { console.error('Tarea', slug, e.message); }
  }
  try { P.r('DELETE FROM sesiones WHERE expira<?', new Date().toISOString()); } catch {}
}

if (require.main === module) {
  const avisos = P.iniciar();
  setInterval(tareasMinuto, 60000);
  const respaldar = () => { try { const n = respaldarTodo(); if (n) console.log(`Respaldo diario: ${n} copia(s) nuevas`); } catch (e) { console.error('Respaldo', e.message); } };
  setTimeout(respaldar, 20000); setInterval(respaldar, 6 * 3600000);
  servidor.listen(PORT, '0.0.0.0', () => {
    console.log(`Abasto Cloud en http://localhost:${PORT}   (clientes: /tienda/   plataforma: /plataforma/)`);
    avisos.forEach((a) => console.log(' ·', a));
  });
}
module.exports = { servidor, iniciar: P.iniciar, tareasMinuto };
