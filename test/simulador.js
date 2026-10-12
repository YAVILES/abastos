'use strict';
// Simulador + auditor de Abasto Cloud.
// 1) Simula jornadas completas de un abasto usando solo la API (como lo harían cajeros y clientes).
// 2) Audita la base resultante con controles independientes (cuadre de inventario, caja, bancos, crédito...).
// Uso: node --no-warnings test/simulador.js [--url=http://localhost:3300] [--jornadas=5] [--semilla=7] [--empresa=auditoria] [--data=ruta]
// Crea/usa una empresa aparte ("auditoria") para no mezclar datos con los reales.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BASE = args.url || 'http://localhost:3300';
const DATA = args.data || path.resolve(__dirname, '..', 'data');
const JORNADAS = Number(args.jornadas) || 5;
const EJEMPLO = !!args.ejemplo; // datos de ejemplo para evaluar la app: catálogo realista y el último día queda abierto
const SLUG = args.empresa || (EJEMPLO ? 'demo' : 'auditoria');
let semilla = Number(args.semilla) || 7;
const rand = () => { semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entre = (a, b) => a + Math.floor(rand() * (b - a + 1));
const elegir = (l) => l[Math.floor(rand() * l.length)];
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

// ---------- HTTP con medición ----------
const lat = {};
const hallazgos = [];
const hallazgo = (sev, area, titulo, detalle) => hallazgos.push({ sev, area, titulo, detalle: detalle || '' });
async function http(metodo, ruta, cuerpo, tk, extra = {}) {
  const t0 = performance.now();
  const r = await fetch(BASE + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}), ...extra }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => ({}));
  const g = metodo + ' ' + ruta.replace(/\/\d+/g, '/:id').replace(/\?.*$/, '');
  (lat[g] ||= []).push(performance.now() - t0);
  return { status: r.status, data: j };
}
// Operación que debe salir bien: si falla se registra como hallazgo y se devuelve null.
async function op(desc, metodo, ruta, cuerpo, tk, extra) {
  const r = await http(metodo, ruta, cuerpo, tk, extra);
  if (r.status !== 200) { hallazgo('ALTA', 'Operación', `Falló una operación válida: ${desc}`, `${metodo} ${ruta} → ${r.status} ${r.data.error || ''}`); return null; }
  return r.data;
}
// Prueba de rechazo: la operación NO debe permitirse.
const sondas = [];
async function sonda(desc, esperado, metodo, ruta, cuerpo, tk, extra) {
  const r = await http(metodo, ruta, cuerpo, tk, extra);
  const ok = Array.isArray(esperado) ? esperado.includes(r.status) : r.status === esperado;
  sondas.push({ desc, esperado: [].concat(esperado).join('/'), real: r.status, ok, mensaje: r.data.error || '' });
  if (!ok) hallazgo('ALTA', 'Control', `Control débil: ${desc}`, `Esperado ${esperado}, respondió ${r.status}`);
  return r;
}

let tkP, tkA, tkC;
const clavesTexto = {};
const sesion = (tk) => tk;
let tasa = 40;
let jornadasHechas = 0;
const stats = { ventas: 0, ventasCredito: 0, ventasAnuladas: 0, pedidos: 0, pedidosValidados: 0, pedidosRechazados: 0, pedidosCancelados: 0, compras: 0, cobros: 0, pagosProv: 0, conteos: 0, mermas: 0, turnos: 0, difCaja: 0 };

async function preparar() {
  const f = path.join(DATA, 'PLATAFORMA_ACCESO.txt');
  if (!fs.existsSync(f)) throw new Error('No encuentro ' + f + ' (indica --data=carpeta-de-datos)');
  const clave = fs.readFileSync(f, 'utf8').match(/Clave: (.+)/)[1].trim();
  const l = await http('POST', '/api/plataforma/login', { usuario: 'plataforma', clave });
  if (l.status !== 200) throw new Error('No pude entrar al panel de plataforma: ' + (l.data.error || l.status));
  tkP = l.data.token;
  clavesTexto.admin = 'aud-' + Math.floor(rand() * 1e9).toString(36) + 'Zq';
  clavesTexto.cajero = 'caj-' + Math.floor(rand() * 1e9).toString(36) + 'Zq';
  const c = await http('POST', '/api/plataforma/empresas', { slug: SLUG, nombre: EJEMPLO ? 'Abasto Demo' : 'Abasto Auditoría (simulado)', dias_prueba: 60, max_usuarios: 10, max_productos: 5000, max_reconocimientos: 0, admin_clave: clavesTexto.admin }, tkP);
  if (c.status === 409) {
    const emp = (await http('GET', '/api/plataforma/empresas', null, tkP)).data.find((e) => e.slug === SLUG);
    await op('restablecer clave admin', 'POST', `/api/plataforma/empresas/${emp.id}/clave-admin`, { clave: clavesTexto.admin }, tkP);
  } else if (c.status !== 200) throw new Error('No pude crear la empresa: ' + (c.data.error || c.status));
  const a = await http('POST', '/api/login', { empresa: SLUG, usuario: 'admin', clave: clavesTexto.admin });
  if (a.status !== 200) throw new Error('Login admin falló: ' + a.data.error);
  tkA = a.data.token;
  const us = (await http('GET', '/api/usuarios', null, tkA)).data;
  const ex = us.find((u) => u.usuario === 'cajero1');
  if (ex) await op('clave cajero', 'PUT', '/api/usuarios/' + ex.id, { clave: clavesTexto.cajero }, tkA);
  else await op('crear cajero', 'POST', '/api/usuarios', { nombre: 'Cajero Uno', usuario: 'cajero1', clave: clavesTexto.cajero, rol: 'cajero' }, tkA);
  const lc = await http('POST', '/api/login', { empresa: SLUG, usuario: 'cajero1', clave: clavesTexto.cajero });
  tkC = lc.data.token;
  if (EJEMPLO) {
    fs.writeFileSync(path.join(DATA, 'DEMO_ACCESO.txt'), `Empresa: ${SLUG}
Sistema: ${BASE}/?e=${SLUG}
App de clientes: ${BASE}/tienda/${SLUG}/
Admin: admin / ${clavesTexto.admin}
Cajero: cajero1 / ${clavesTexto.cajero}
Clientes de la app (PIN 4321): ver Clientes > los llamados Compradora App
`);
    require('node:child_process').execFileSync(process.execPath, ['--no-warnings', path.resolve(__dirname, '..', 'seed-demo.js'), SLUG], { env: { ...process.env, DATA_DIR: DATA }, stdio: 'inherit' });
  }
  // Si una corrida anterior se interrumpió, se cierra el turno que quedó abierto
  const huerfano = (await http('GET', '/api/turno', null, tkC)).data;
  if (huerfano && huerfano.id) await op('cerrar turno huérfano', 'POST', '/api/turnos/cerrar', { contado: huerfano.resumen.esperado, comentario: '' }, tkC);
}

let cuentas, proveedores = [], productos = [], clientes = [], medios = [];
const NOMBRES = ['Harina de maíz', 'Arroz', 'Pasta larga', 'Caraotas', 'Azúcar', 'Sal', 'Aceite', 'Atún', 'Sardinas', 'Margarina', 'Leche en polvo', 'Queso', 'Jamón', 'Refresco', 'Agua mineral', 'Jugo', 'Cerveza', 'Malta', 'Papel higiénico', 'Jabón', 'Crema dental', 'Detergente', 'Cloro', 'Lavaplatos', 'Galletas', 'Papas fritas', 'Chocolate', 'Café', 'Mayonesa', 'Salsa de tomate'];

async function maestros() {
  cuentas = (await op('cuentas', 'GET', '/api/cuentas', null, tkA)) || [];
  const banco = cuentas.find((c) => c.tipo === 'banco' && c.moneda === 'VES');
  await http('PUT', '/api/cuentas/' + banco.id, { saldo_inicial: 800000 }, tkA); // 409 si ya hay movimientos: es normal
  const cajaUSD = cuentas.find((c) => c.tipo === 'caja' && c.moneda === 'USD');
  await http('PUT', '/api/cuentas/' + cajaUSD.id, { saldo_inicial: 300 }, tkA);
  medios = (await http('GET', '/api/medios-app', null, tkA)).data;
  if (!medios.length) {
    await op('medio pago móvil', 'POST', '/api/medios-app', { medio: 'pago_movil', banco: 'Banesco', cuenta_id: banco.id, tipo_doc: 'J', documento: '123456789', telefono: '04141112233', moneda: 'VES', estado: 'publicado' }, tkA);
    await op('medio transferencia', 'POST', '/api/medios-app', { medio: 'transferencia', banco: 'Mercantil', cuenta_id: banco.id, titular: 'Abasto Simulado C.A.', documento: 'J-1', num_cuenta: '01050000000000000000', tipo_cuenta: 'corriente', moneda: 'VES', estado: 'publicado' }, tkA);
    medios = (await http('GET', '/api/medios-app', null, tkA)).data;
  }
  proveedores = (await http('GET', '/api/proveedores', null, tkA)).data;
  if (!EJEMPLO) for (const [n, d] of [['Distribuidora Norte', 15], ['Alimentos del Valle', 7], ['Bebidas Oriente', 0], ['Aseo Express', 7]]) {
    if (!proveedores.find((p) => p.nombre === n)) await op('proveedor', 'POST', '/api/proveedores', { nombre: n, dias_credito: d }, tkA);
  }
  proveedores = (await http('GET', '/api/proveedores', null, tkA)).data;
  productos = (await http('GET', '/api/productos', null, tkA)).data;
  if (productos.length < (EJEMPLO ? 20 : 60)) {
    const cats = (await http('GET', '/api/categorias', null, tkA)).data;
    for (let i = productos.length; i < 60; i++) {
      const costo = r2(0.3 + rand() * 7), precio = r2(costo * (1.25 + rand() * 0.35));
      const min = entre(5, 20);
      await op('crear producto', 'POST', '/api/productos', { nombre: `${NOMBRES[i % NOMBRES.length]} sim ${i + 1}`, categoria_id: elegir(cats).id, codigos: ['7592' + String(100000 + i)], costo_usd: costo, precio_usd: precio, stock_min: min, stock_max: min * 4,
        proveedor_id: proveedores[i % proveedores.length].id, factor: elegir([1, 12, 24]), unidad_compra: 'caja' }, tkA);
    }
    productos = (await http('GET', '/api/productos', null, tkA)).data;
  }
  clientes = (await http('GET', '/api/clientes', null, tkA)).data;
  if (clientes.length < 15) {
    for (let i = clientes.length; i < 15; i++) {
      const cred = i % 3 === 0;
      await op('crear cliente', 'POST', '/api/clientes', { nombre: EJEMPLO ? ['Marta Pérez', 'José Rodríguez', 'Luisa Fernández', 'Carlos Mendoza', 'Rosa Giménez', 'Pedro Colmenares', 'Ana Salazar', 'Miguel Ávila', 'Carmen Ruiz', 'Jesús Parra', 'Elena Torres', 'Rafael Silva', 'Yenny Morales', 'Héctor Briceño', 'Norma Castillo'][i % 15] : `Cliente Sim ${i + 1}`, telefono: '0416' + String(1000000 + i), documento: 'V-' + (9000000 + i), credito_habilitado: cred, limite_usd: cred ? entre(40, 150) : 0, dias_credito: 7 }, tkA);
    }
    clientes = (await http('GET', '/api/clientes', null, tkA)).data;
  }
}

async function abrirDia() {
  const jr = (await http('GET', '/api/jornada', null, tkA)).data;
  if (jr.jornada) { tasa = jr.jornada.tasa_usd_ves; return; }
  tasa = r2(tasa * (1 + (0.005 + rand() * 0.02)));
  await op('abrir día', 'POST', '/api/jornada/abrir', { tasa_usd_ves: tasa, tasa_eur_usd: r2(1.05 + rand() * 0.05), fuente: 'Simulador' }, tkA);
}
async function stockMapa() {
  const inv = (await op('inventario', 'GET', '/api/inventario', null, tkA)) || [];
  return new Map(inv.map((p) => [p.id, { ...p }]));
}

function totalLocal(items, pct) {
  let sub = 0, desc = 0;
  for (const it of items) { const b = r4(it.cantidad * it.precio); sub += b; desc += r4(b * pct / 100); }
  return r2(r2(sub) - r2(desc));
}
const RUN = String(Date.now()).slice(-4); // distingue las corridas entre sí
const refAleatoria = () => RUN + String(entre(10000, 99999));
function pagosPara(total, cliente, forzarCredito) {
  const q = forzarCredito ? 0.95 : rand();
  const ves = (usd) => Math.ceil(usd * tasa * 100) / 100;
  if (!forzarCredito && cliente && cliente.credito_habilitado && q > 0.5) return pagosPara(total, cliente, true);
  if (q < 0.45) return [{ medio: 'efectivo', moneda: 'USD', monto: Math.ceil(total) }];
  if (q < 0.7) return [{ medio: 'pago_movil', moneda: 'VES', monto: ves(total), referencia: refAleatoria(), cuenta_id: cuentas.find((c) => c.tipo === 'banco').id }];
  if (q < 0.8) return [{ medio: 'transferencia', moneda: 'VES', monto: ves(total), referencia: refAleatoria(), cuenta_id: cuentas.find((c) => c.tipo === 'banco').id }];
  if (q < 0.9) {
    const usd = Math.floor(total / 2);
    const resto = r2(total - usd);
    return [...(usd > 0 ? [{ medio: 'efectivo', moneda: 'USD', monto: usd }] : []), { medio: 'pago_movil', moneda: 'VES', monto: ves(resto), referencia: refAleatoria(), cuenta_id: cuentas.find((c) => c.tipo === 'banco').id }];
  }
  if (cliente && cliente.credito_habilitado && rand() < 0.5) { const usd = Math.floor(total * 0.3); return [...(usd > 0 ? [{ medio: 'efectivo', moneda: 'USD', monto: usd }] : []), { medio: 'credito' }]; }
  return [{ medio: 'efectivo', moneda: 'USD', monto: Math.ceil(total) }];
}

async function jornada(n, esUltima, dejarAbierto) {
  await abrirDia();
  const cajas = (await http('GET', '/api/cajas', null, tkA)).data;
  const caja = cajas.find((c) => !c.turno) || cajas[0];
  const ab = await op('abrir caja', 'POST', '/api/turnos/abrir', { caja_id: caja.id, fondo: { USD: 20, VES: 2000, EUR: 0 } }, tkC);
  if (!ab) return;
  stats.turnos++;
  let inv = await stockMapa();
  const idsVentas = [];
  clientes = (await http('GET', '/api/clientes', null, tkA)).data;

  // ---- ventas del POS ----
  const nVentas = entre(22, 36);
  for (let v = 0; v < nVentas; v++) {
    const disp = [...inv.values()].filter((p) => p.disponible >= 1 && p.precio_usd > 0 && p.activo);
    if (!disp.length) break;
    const items = [];
    for (let k = 0; k < entre(1, 5); k++) {
      const p = elegir(disp);
      if (items.find((i) => i.producto_id === p.id)) continue;
      const cant = Math.min(entre(1, 4), Math.floor(p.disponible));
      if (cant >= 1) items.push({ producto_id: p.id, cantidad: cant, precio: p.precio_usd });
    }
    if (!items.length) continue;
    const cliente = rand() < 0.35 ? elegir(clientes.filter((c) => c.estado === 'activo')) : null;
    const pct = rand() < 0.1 ? 5 : 0;
    const total = totalLocal(items, pct);
    let pagos = pagosPara(total, cliente);
    if (pagos.some((p) => p.medio === 'credito')) {
      const deuda = cliente.deuda_usd || 0;
      if (deuda + total > cliente.limite_usd) pagos = [{ medio: 'efectivo', moneda: 'USD', monto: Math.ceil(total) }];
    }
    // el cajero entrega el vuelto en bolívares (efectivo o pago móvil) en parte de las ventas pagadas con dólares
    let vuelto;
    const pagUSD = pagos.length === 1 && pagos[0].medio === 'efectivo' && pagos[0].moneda === 'USD' ? pagos[0].monto : 0;
    const exc = r2(pagUSD - total);
    if (exc > 0.05 && rand() < 0.5) {
      const bs = Math.round(exc * tasa * 100) / 100;
      vuelto = rand() < 0.5 ? [{ medio: 'efectivo', moneda: 'VES', monto: bs }]
        : [{ medio: 'pago_movil', moneda: 'VES', monto: bs, referencia: refAleatoria(), cuenta_id: cuentas.find((c) => c.tipo === 'banco').id }];
      stats.vueltosBs = (stats.vueltosBs || 0) + 1;
    }
    const r = await http('POST', '/api/ventas', { cliente_id: cliente ? cliente.id : null, descuento_pct: pct, items: items.map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })), pagos, vuelto }, tkC);
    if (r.status !== 200) { hallazgo('ALTA', 'Venta', 'Una venta válida fue rechazada', `${r.status} ${r.data.error} total=${total} pagos=${JSON.stringify(pagos)}`); continue; }
    stats.ventas++; if (r.data.credito_usd > 0) { stats.ventasCredito++; if (cliente) cliente.deuda_usd = (cliente.deuda_usd || 0) + r.data.credito_usd; }
    if (Math.abs(r.data.total_usd - total) > 0.011) hallazgo('MEDIA', 'Venta', 'El total del servidor difiere del cálculo independiente', `servidor=${r.data.total_usd} local=${total}`);
    idsVentas_push(idsVentas, r.data, pagos);
    for (const it of items) { const p = inv.get(it.producto_id); p.disponible -= it.cantidad; p.stock -= it.cantidad; }
  }

  // ---- pedidos de la app ----
  inv = await stockMapa();
  for (let k = 0; k < 4; k++) {
    const tel = '0412' + String(Number(String(Date.now()).slice(-5)) * 100 + n * 10 + k).padStart(7, '0');
    const alta = await op('crear cliente app', 'POST', '/api/clientes', { nombre: `Compradora App ${n}-${k}`, telefono: tel }, tkA);
    if (!alta) continue;
    await op('PIN de la app', 'POST', `/api/clientes/${alta.id}/pin`, { pin: '4321' }, tkA);
    const reg = await http('POST', '/api/app/login', { telefono: tel, pin: '4321' }, null, { 'x-empresa': SLUG });
    if (reg.status !== 200) { hallazgo('MEDIA', 'App', 'Login de cliente de la app falló', reg.data.error); continue; }
    const tk = reg.data.token;
    const disp = [...inv.values()].filter((p) => p.disponible >= 2 && p.precio_usd > 0);
    const items = [];
    for (let m = 0; m < entre(1, 3); m++) { const p = elegir(disp); if (!items.find((i) => i.producto_id === p.id)) items.push({ producto_id: p.id, cantidad: entre(1, 2) }); }
    const envio = rand() < 0.4;
    const ped = await http('POST', '/api/app/pedidos', { items, entrega: envio ? 'envio' : 'retiro', ...(envio ? { contacto: 'Ana', telefono: tel, zona: 'Centro', direccion: 'Calle 5', referencia_entrega: 'Casa verde' } : {}) }, tk);
    if (ped.status !== 200) { hallazgo('ALTA', 'App', 'Pedido válido rechazado', ped.data.error); continue; }
    stats.pedidos++;
    for (const it of items) { const p = inv.get(it.producto_id); p.disponible -= it.cantidad; }
    const suerte = rand();
    if (suerte < 0.1) { await op('cancelar pedido app', 'POST', `/api/app/pedidos/${ped.data.id}/cancelar`, {}, tk); stats.pedidosCancelados++; for (const it of items) inv.get(it.producto_id).disponible += it.cantidad; continue; }
    const m = medios.find((x) => x.medio === 'pago_movil') || medios[0];
    const montoVES = Math.ceil(ped.data.total_usd * tasa * 100) / 100;
    const dejarPendiente = dejarAbierto && k < 3; // en el último día quedan pagos por validar para probar la pantalla
    const rep = await http('POST', `/api/app/pedidos/${ped.data.id}/pago`, { medio_app_id: m.id, monto: montoVES, banco_emisor: 'Provincial', referencia: refAleatoria() }, tk);
    if (rep.status !== 200) { hallazgo('ALTA', 'App', 'Reporte de pago válido rechazado', rep.data.error); continue; }
    if (dejarPendiente) continue;
    const det = (await http('GET', '/api/pedidos/' + ped.data.id, null, tkC)).data;
    const pago = det.pagos[0];
    if (suerte < 0.2) { await op('rechazar pago', 'POST', `/api/pedidos/${ped.data.id}/rechazar-pago`, { motivo: 'Referencia no aparece en el banco' }, tkC); stats.pedidosRechazados++; for (const it of items) inv.get(it.producto_id).disponible += it.cantidad; continue; }
    const val = await http('POST', `/api/pedidos/${ped.data.id}/validar-pago`, { pago_id: pago.id, monto_confirmado: montoVES }, tkC);
    if (val.status !== 200) { hallazgo('ALTA', 'App', 'Validación de pago válido falló', val.data.error); continue; }
    stats.pedidosValidados++; stats.ventas++;
    // preparación con verificación: se escanea cada unidad del pedido antes de poder terminarla
    const ordenId = val.data.orden_id;
    const prep = await op('empezar a preparar', 'POST', `/api/ordenes/${ordenId}/preparar/iniciar`, {}, tkC);
    if (!prep) continue;
    const mitad = dejarAbierto; // en el último día queda una preparación a medias para probar la pantalla
    let completo = true;
    for (const l of prep.lineas) {
      const veces = mitad ? Math.floor(l.requerido / 2) : l.requerido;
      if (mitad && veces < l.requerido) completo = false;
      for (let q = 0; q < veces; q++) {
        const rr = await http('POST', `/api/ordenes/${ordenId}/preparar/escanear`, { codigo: l.barra || l.codigo }, tkC);
        if (rr.status !== 200) { hallazgo('ALTA', 'Preparación', 'Un escaneo válido fue rechazado', rr.data.error); completo = false; break; }
      }
    }
    if (!completo || dejarAbierto) continue;
    for (const e of envio ? ['preparada', 'lista_envio', 'enviada', 'entregada'] : ['preparada', 'lista_retiro', 'entregada']) await op('avanzar orden', 'POST', `/api/ordenes/${ordenId}/estado`, { estado: e }, tkC);
  }

  // ---- anulaciones (supervisor) ----
  for (const v of idsVentas.filter((x) => !x.credito).sort(() => rand() - 0.5).slice(0, 2)) {
    if (await op('anular venta', 'POST', `/api/ventas/${v.id}/anular`, { motivo: 'Error del cajero (simulado)' }, tkA)) stats.ventasAnuladas++;
  }

  // ---- cobros de crédito ----
  const cxc = (await http('GET', '/api/cxc?estado=abiertas', null, tkC)).data;
  for (const c of cxc.filter(() => rand() < 0.5)) {
    const monto = rand() < 0.5 ? c.saldo_usd : r2(c.saldo_usd / 2);
    if (monto < 0.01) continue;
    if (await op('cobrar crédito', 'POST', `/api/cxc/${c.id}/cobrar`, { pagos: [{ medio: 'efectivo', moneda: 'USD', monto }] }, tkC)) stats.cobros++;
  }

  // ---- compras de reposición y pago a proveedores ----
  const sug = (await op('sugerencias', 'GET', '/api/compras/sugerencias', null, tkA)) || [];
  const elegidas = sug.filter((s) => s.proveedor_id).slice(0, 10);
  if (elegidas.length) {
    const gen = await op('compras desde sugerencias', 'POST', '/api/compras/desde-sugerencias', { items: elegidas.map((s) => ({ producto_id: s.id, cantidad_compra: Math.max(1, Math.ceil(s.sugerido_compra)) })) }, tkA);
    for (const id of (gen && gen.ids) || []) {
      const credito = rand() < (EJEMPLO ? 0.85 : 0.4);
      const enVES = rand() < 0.5;
      const body = credito ? { condicion: 'credito', dias_credito: 7 } : enVES ? { condicion: 'contado', medio: 'transferencia', referencia: refAleatoria(), cuenta_id: cuentas.find((c) => c.tipo === 'banco').id } : { condicion: 'contado', medio: 'efectivo' };
      // la compra se creó en USD: se recibe tal cual (la conversión a Bs se prueba en la compra inicial)
      if (enVES && !credito) { body.medio = 'efectivo'; delete body.referencia; delete body.cuenta_id; }
      if (await op('recibir compra', 'POST', `/api/compras/${id}/recibir`, body, tkA)) stats.compras++;
    }
  }
  const cxp = (await http('GET', '/api/cxp?estado=abiertas', null, tkA)).data;
  for (const c of cxp.filter(() => rand() < 0.5)) {
    const usd = r2(c.saldo_usd * (rand() < 0.5 ? 1 : 0.6));
    if (usd < 0.01) continue;
    const banco = cuentas.find((x) => x.tipo === 'banco');
    if (await op('pagar proveedor', 'POST', `/api/cxp/${c.id}/pagar`, { moneda: 'VES', monto: Math.ceil(usd * tasa * 100) / 100 > c.saldo_usd * tasa ? r2(c.saldo_usd * tasa) : Math.ceil(usd * tasa * 100) / 100, cuenta_id: banco.id, referencia: refAleatoria() }, tkA)) stats.pagosProv++;
  }

  // ---- merma y conteo cíclico ----
  inv = await stockMapa();
  const conStock = [...inv.values()].filter((p) => p.stock >= 3);
  if (conStock.length && await op('merma', 'POST', '/api/inventario/ajuste', { producto_id: elegir(conStock).id, cantidad: -entre(1, 2), tipo: 'merma', motivo: 'Producto dañado (simulado)' }, tkA)) stats.mermas++;
  const cnt = await http('POST', '/api/conteos/generar', { cantidad: 6, responsable: 'Almacén', regenerar: n > 1 }, tkA);
  if (cnt.status === 200) {
    const doc = (await http('GET', '/api/conteos/' + cnt.data.id, null, tkA)).data;
    const items = doc.items.map((i) => ({ id: i.id, contado: Math.max(0, i.stock_sistema + (rand() < 0.25 ? elegir([-2, -1, 1]) : 0)), observacion: '' }));
    await op('cargar conteo', 'POST', `/api/conteos/${doc.id}/cargar`, { items }, tkA);
    await op('autorizar ajustes', 'POST', `/api/conteos/${doc.id}/autorizar`, {}, tkA);
    stats.conteos++;
  } else hallazgo('MEDIA', 'Conteo', 'No se pudo generar el conteo del día', cnt.data.error);

  if (n === 1 && !EJEMPLO) await sondasMidJornada(inv);
  if (dejarAbierto) { // una compra queda en borrador y la caja y el día siguen abiertos
    await op('compra en borrador', 'POST', '/api/compras', { proveedor_id: proveedores[0].id, moneda: 'USD', condicion: 'credito', items: [{ producto_id: productos[0].id, cantidad: 3, costo_unit: 10 }] }, tkA);
    return;
  }

  // ---- cierre de caja ----
  const t = (await http('GET', '/api/turno', null, tkC)).data;
  const esp = t.resumen.esperado;
  const dif = rand() < 0.3;
  const contado = { USD: r2(esp.USD + (dif ? elegir([-1, -0.5, 2]) : 0)), VES: esp.VES, EUR: esp.EUR };
  if (dif) stats.difCaja++;
  const cierre = await http('POST', '/api/turnos/cerrar', { contado, comentario: dif ? 'Diferencia en billetes (simulado)' : '' }, tkC);
  if (cierre.status !== 200) hallazgo('ALTA', 'Caja', 'Cierre de caja válido rechazado', cierre.data.error);
  const cd = await http('POST', '/api/jornada/cerrar', { forzar: true }, tkA);
  if (cd.status !== 200) hallazgo('ALTA', 'Jornada', 'Cierre de día válido rechazado', cd.data.error);
  jornadasHechas++;
  if (esUltima && !EJEMPLO) await sondasFinales();
}
function idsVentas_push(lista, data, pagos) { lista.push({ id: data.id, credito: pagos.some((p) => p.medio === 'credito') }); }

// ---------- compra inicial (carga el stock, con conversión Bs) ----------
async function stockInicial() {
  await abrirDia();
  const banco = cuentas.find((c) => c.tipo === 'banco' && c.moneda === 'VES');
  productos = (await http('GET', '/api/productos', null, tkA)).data;
  for (const [i, prov] of proveedores.entries()) {
    const suyos = productos.filter((p) => p.proveedor_id === prov.id && p.stock === 0).slice(0, 30);
    if (!suyos.length) continue;
    const enVES = i % 2 === 0;
    const items = suyos.map((p) => ({ producto_id: p.id, cantidad: entre(2, 5), costo_unit: enVES ? r2(p.costo_usd * p.factor * tasa) : r2(p.costo_usd * p.factor) }));
    const body = { proveedor_id: prov.id, moneda: enVES ? 'VES' : 'USD', condicion: i === 3 ? 'credito' : 'contado', dias_credito: 15, recibir: true, items,
      ...(i === 3 ? {} : enVES ? { medio: 'transferencia', referencia: refAleatoria(), cuenta_id: banco.id } : { medio: 'efectivo' }) };
    if (await op('compra inicial', 'POST', '/api/compras', body, tkA)) stats.compras++;
  }
}

// ---------- sondas de control ----------
async function sondasMidJornada(inv) {
  const p = [...inv.values()].find((x) => x.stock >= 1 && x.activo);
  const cli = clientes.find((c) => c.credito_habilitado);
  const efUSD = (m) => [{ medio: 'efectivo', moneda: 'USD', monto: m }];
  await sonda('Vender más unidades de las que hay', 409, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: p.stock + 1000 }], pagos: efUSD(99999) }, tkC);
  await sonda('Cajero cambia el precio en la venta', 403, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: 1, precio_usd: 0.01 }], pagos: efUSD(1) }, tkC);
  await sonda('Cajero aplica descuento mayor al permitido', 403, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: 1 }], descuento_pct: 40, pagos: efUSD(100) }, tkC);
  await sonda('Pago incompleto', 400, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: 1 }], pagos: efUSD(0.01) }, tkC);
  await sonda('Pago móvil sin referencia', 400, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: 1 }], pagos: [{ medio: 'pago_movil', moneda: 'VES', monto: 99999 }] }, tkC);
  await sonda('Crédito sin cliente identificado', 400, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: 1 }], pagos: [{ medio: 'credito' }] }, tkC);
  const necesario = cli.limite_usd + 60;
  const grande = [...inv.values()].find((x) => x.activo && x.precio_usd > 0 && x.disponible * x.precio_usd >= necesario);
  if (grande) await sonda('Crédito por encima del límite (cajero)', 409, 'POST', '/api/ventas', { cliente_id: cli.id, items: [{ producto_id: grande.id, cantidad: Math.ceil(necesario / grande.precio_usd) }], pagos: [{ medio: 'credito' }] }, tkC);
  await sonda('Cajero ve la lista de usuarios', 403, 'GET', '/api/usuarios', null, tkC);
  await sonda('Cajero ajusta inventario', 403, 'POST', '/api/inventario/ajuste', { producto_id: p.id, cantidad: 5, tipo: 'ajuste', motivo: 'x' }, tkC);
  await sonda('Cajero importa productos', 403, 'POST', '/api/productos/importar', { csv: 'nombre\nX' }, tkC);
  await sonda('Cajero cambia parámetros', 403, 'PUT', '/api/parametros/operacion', { descuento_max_pct: 90 }, tkC);
  await sonda('Cajero descarga el respaldo', 403, 'GET', '/api/respaldo', null, tkC);
  await sonda('Sin sesión', 401, 'GET', '/api/productos', null, '');
  await sonda('Token de otra empresa con prefijo cambiado', 401, 'GET', '/api/productos', null, 'principal.' + tkA.slice(tkA.indexOf('.') + 1));
  await sonda('Cerrar el día con una caja abierta', 409, 'POST', '/api/jornada/cerrar', {}, tkA);
  await sonda('Abrir una segunda jornada', 409, 'POST', '/api/jornada/abrir', { tasa_usd_ves: 40, tasa_eur_usd: 1.1 }, tkA);
  await sonda('Segunda caja abierta por el mismo usuario', 409, 'POST', '/api/turnos/abrir', { caja_id: 1, fondo: {} }, tkC);
  // Anular una compra cuya mercancía ya se vendió
  const nuevo = await op('producto de sonda', 'POST', '/api/productos', { nombre: 'Producto sonda ' + Date.now(), precio_usd: 2, costo_usd: 1, codigos: ['7599' + entre(100000, 999999)], proveedor_id: proveedores[0].id }, tkA);
  if (nuevo) {
    const cmp = await op('compra sonda', 'POST', '/api/compras', { proveedor_id: proveedores[0].id, moneda: 'USD', condicion: 'contado', medio: 'efectivo', recibir: true, items: [{ producto_id: nuevo.id, cantidad: 1, costo_unit: 1 }] }, tkA);
    await op('venta sonda', 'POST', '/api/ventas', { items: [{ producto_id: nuevo.id, cantidad: 1 }], pagos: efUSD(2) }, tkC);
    if (cmp) await sonda('Anular una compra cuya mercancía ya se vendió', 409, 'POST', `/api/compras/${cmp.id}/anular`, { motivo: 'prueba' }, tkA);
    await op('desactivar producto sonda', 'PUT', '/api/productos/' + nuevo.id, { nombre: 'Producto sonda inactivo', activo: false }, tkA);
    await sonda('Vender un producto inactivo', 400, 'POST', '/api/ventas', { items: [{ producto_id: nuevo.id, cantidad: 1 }], pagos: efUSD(2) }, tkC);
  }
}
async function sondasFinales() {
  const p = productos[0];
  await sonda('Vender con el día cerrado', 409, 'POST', '/api/ventas', { items: [{ producto_id: p.id, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 99 }] }, tkC);
  await sonda('Comprar con el día cerrado', 409, 'POST', '/api/compras', { proveedor_id: proveedores[0].id, moneda: 'USD', condicion: 'contado', medio: 'efectivo', recibir: true, items: [{ producto_id: p.id, cantidad: 1, costo_unit: 1 }] }, tkA);
}

// =====================================================================
// AUDITOR: controles independientes sobre la base (solo lectura)
// =====================================================================
const controles = [];
function auditar() {
  const archivo = path.join(DATA, 'empresas', SLUG + '.db');
  const db = new DatabaseSync(archivo, { readOnly: true });
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const g = (sql, ...a) => db.prepare(sql).get(...a);
  const TOL = 0.03;
  const ctl = (area, nombre, fallas, sev = 'ALTA', detalle = (f) => JSON.stringify(f).slice(0, 220)) => {
    controles.push({ area, nombre, ok: fallas.length === 0, fallas: fallas.length });
    if (fallas.length) hallazgo(sev, area, `${nombre} (${fallas.length} caso/s)`, fallas.slice(0, 3).map(detalle).join(' | '));
  };

  ctl('Integridad', 'Integridad física de la base (integrity_check)', g('PRAGMA integrity_check').integrity_check === 'ok' ? [] : [{ x: 'corrupta' }]);
  ctl('Integridad', 'Llaves foráneas sin huérfanos', q('PRAGMA foreign_key_check'));

  // Inventario: libro mayor vs documentos
  const prods = q('SELECT id, nombre, activo FROM productos');
  const f1 = [];
  for (const p of prods) {
    const ledger = g('SELECT COALESCE(SUM(cantidad),0) AS s FROM inventario_movimientos WHERE producto_id=?', p.id).s;
    const comp = g("SELECT COALESCE(SUM(d.unidades),0) AS s FROM compra_detalles d JOIN compras c ON c.id=d.compra_id WHERE d.producto_id=? AND c.estado='recibida'", p.id).s;
    const ven = g("SELECT COALESCE(SUM(d.cantidad),0) AS s FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id WHERE d.producto_id=? AND v.estado='completada'", p.id).s;
    const aj = g("SELECT COALESCE(SUM(cantidad),0) AS s FROM inventario_movimientos WHERE producto_id=? AND tipo IN ('ajuste','merma','consumo_interno','ajuste_conteo','inventario_inicial')", p.id).s;
    const esperado = comp - ven + aj;
    if (Math.abs(ledger - esperado) > 0.001) f1.push({ producto: p.nombre, kardex: ledger, documentos: esperado });
  }
  ctl('Inventario', 'Existencia del kardex = compras − ventas ± ajustes', f1);
  ctl('Inventario', 'Sin existencias negativas', q('SELECT p.nombre, SUM(m.cantidad) AS s FROM productos p JOIN inventario_movimientos m ON m.producto_id=p.id GROUP BY p.id HAVING s < -0.0001'));
  ctl('Inventario', 'Ventas anuladas devuelven todo al inventario', q(`SELECT v.numero, COALESCE(SUM(m.cantidad),0) AS neto FROM ventas v JOIN inventario_movimientos m ON m.ref_tipo='venta' AND m.ref_id=v.id
      WHERE v.estado='anulada' GROUP BY v.id HAVING ABS(neto) > 0.0001`));
  ctl('Inventario', 'Cada ajuste por conteo coincide con la diferencia contada', q(`SELECT i.id, i.diferencia, (SELECT COALESCE(SUM(m.cantidad),0) FROM inventario_movimientos m WHERE m.tipo='ajuste_conteo' AND m.ref_id=i.conteo_id AND m.producto_id=i.producto_id) AS mov
      FROM conteo_items i WHERE i.ajustado=1 AND ABS(i.diferencia) > 0.0001 AND ABS(mov - i.diferencia) > 0.0001`));
  ctl('Inventario', 'Reservas activas solo en pedidos abiertos', q("SELECT r.id, p.estado FROM reservas r JOIN pedidos p ON p.id=r.pedido_id WHERE r.estado='activa' AND p.estado NOT IN ('pendiente','pago_reportado')"));

  // Ventas y pagos
  const f2 = [], f3 = [], f5v = [];
  for (const v of q("SELECT * FROM ventas WHERE estado='completada'")) {
    const det = g('SELECT COALESCE(SUM(precio_usd*cantidad - descuento_usd),0) AS t FROM venta_detalles WHERE venta_id=?', v.id).t;
    if (Math.abs(det - v.total_usd) > TOL) f2.push({ venta: v.numero, detalle: r2(det), total: v.total_usd });
    const pag = g("SELECT COALESCE(SUM(monto_usd),0) AS t FROM pagos WHERE venta_id=? AND tipo='venta' AND anulado=0", v.id).t;
    if (Math.abs(pag - v.vuelto_usd - v.total_usd) > TOL) f3.push({ venta: v.numero, pagos: r2(pag), vuelto: v.vuelto_usd, total: v.total_usd });
    const vReg = g("SELECT COALESCE(SUM(monto_usd),0) AS t FROM pagos WHERE venta_id=? AND tipo='vuelto' AND anulado=0", v.id).t;
    if (Math.abs(vReg - v.vuelto_usd) > TOL) f5v.push({ venta: v.numero, vuelto_registrado: r2(vReg), vuelto_venta: v.vuelto_usd });
  }
  ctl('Ventas', 'Total de la venta = suma de sus líneas', f2);
  ctl('Ventas', 'Pagos (incluido crédito) − vuelto = total de la venta', f3);
  ctl('Ventas', 'El vuelto entregado (por moneda y medio) suma el vuelto de la venta', f5v);
  ctl('Ventas', 'Todo pago en moneda extranjera guarda tasa', q("SELECT id FROM pagos WHERE moneda<>'USD' AND (tasa IS NULL OR tasa<=1 AND moneda='VES')"));
  ctl('Ventas', 'Ventas anuladas tienen motivo y responsable', q("SELECT numero FROM ventas WHERE estado='anulada' AND (motivo_anulacion IS NULL OR anulada_por IS NULL)"));
  ctl('Ventas', 'Cada venta tiene su registro de auditoría', q("SELECT v.numero FROM ventas v WHERE NOT EXISTS (SELECT 1 FROM auditoria a WHERE a.accion='venta_creada' AND a.entidad='venta' AND a.ref=CAST(v.id AS TEXT))"), 'MEDIA');

  // Bancos y cajas: saldos vs documentos
  const f4 = [];
  for (const c of q('SELECT * FROM cuentas')) {
    const mov = g("SELECT COALESCE(SUM(monto),0) AS s FROM cuenta_movimientos WHERE cuenta_id=? AND tipo IN ('venta','vuelto','reverso_venta')", c.id).s;
    const pagos = g("SELECT COALESCE(SUM(p.monto),0) AS s FROM pagos p WHERE p.cuenta_id=? AND p.tipo='venta' AND p.anulado=0", c.id).s;
    const vuelto = g("SELECT COALESCE(SUM(monto),0) AS s FROM pagos WHERE cuenta_id=? AND tipo='vuelto' AND anulado=0", c.id).s;
    if (Math.abs(mov - (pagos - vuelto)) > TOL) f4.push({ cuenta: c.nombre, movimientos: r2(mov), documentos: r2(pagos - vuelto) });
    const cob = g("SELECT COALESCE(SUM(monto),0) AS s FROM cuenta_movimientos WHERE cuenta_id=? AND tipo='cobro_cxc'", c.id).s;
    const cobDoc = g("SELECT COALESCE(SUM(monto),0) AS s FROM pagos WHERE cuenta_id=? AND tipo='cobro' AND anulado=0", c.id).s;
    if (Math.abs(cob - cobDoc) > TOL) f4.push({ cuenta: c.nombre, cobros_mov: r2(cob), cobros_doc: r2(cobDoc) });
    const comp = g("SELECT COALESCE(SUM(monto),0) AS s FROM cuenta_movimientos WHERE cuenta_id=? AND tipo IN ('compra','reverso_compra')", c.id).s;
    const compDoc = g("SELECT COALESCE(SUM(total_moneda),0) AS s FROM compras WHERE cuenta_id=? AND condicion='contado' AND estado='recibida'", c.id).s;
    if (Math.abs(comp + compDoc) > TOL) f4.push({ cuenta: c.nombre, compras_mov: r2(comp), compras_doc: r2(-compDoc) });
    const pp = g("SELECT COALESCE(SUM(monto),0) AS s FROM cuenta_movimientos WHERE cuenta_id=? AND tipo='pago_proveedor'", c.id).s;
    const ppDoc = g('SELECT COALESCE(SUM(monto),0) AS s FROM cxp_pagos WHERE cuenta_id=?', c.id).s;
    if (Math.abs(pp + ppDoc) > TOL) f4.push({ cuenta: c.nombre, pagos_prov_mov: r2(pp), pagos_prov_doc: r2(-ppDoc) });
  }
  ctl('Bancos y cajas', 'Movimientos de cada cuenta cuadran con ventas, cobros, compras y pagos a proveedores', f4);
  ctl('Bancos y cajas', 'Toda cuenta de efectivo mantiene saldo no negativo', q("SELECT c.nombre, c.saldo_inicial + COALESCE((SELECT SUM(monto) FROM cuenta_movimientos m WHERE m.cuenta_id=c.id),0) AS saldo FROM cuentas c WHERE c.tipo='caja' AND saldo < -0.01"), 'MEDIA');

  // Caja: esperado recalculado
  const f5 = [];
  for (const t of q("SELECT * FROM caja_turnos WHERE estado='cerrada'")) {
    const fondo = JSON.parse(t.fondo), esp = JSON.parse(t.esperado);
    for (const m of ['USD', 'VES', 'EUR']) {
      const mov = g("SELECT COALESCE(SUM(mv.monto),0) AS s FROM cuenta_movimientos mv JOIN cuentas c ON c.id=mv.cuenta_id WHERE mv.turno_id=? AND c.tipo='caja' AND c.moneda=?", t.id, m).s;
      if (Math.abs((fondo[m] || 0) + mov - esp[m]) > TOL) f5.push({ turno: t.id, moneda: m, recalculado: r2((fondo[m] || 0) + mov), guardado: esp[m] });
    }
  }
  ctl('Caja', 'Efectivo esperado de cada cierre = fondo + movimientos del turno', f5);
  ctl('Caja', 'Diferencias de caja tienen comentario', q("SELECT id FROM caja_turnos WHERE estado='cerrada' AND ABS(COALESCE(diferencia_usd,0))>0.005 AND (comentario IS NULL OR comentario='')"));
  ctl('Caja', 'No quedan turnos abiertos tras cerrar las jornadas', q("SELECT id FROM caja_turnos WHERE estado='abierta'"), 'MEDIA');

  // Crédito y cuentas por cobrar/pagar
  const f6 = [];
  for (const x of q("SELECT * FROM cxc WHERE estado<>'anulada'")) {
    const cob = g("SELECT COALESCE(SUM(monto_usd),0) AS s FROM pagos WHERE cxc_id=? AND tipo='cobro' AND anulado=0", x.id).s;
    if (Math.abs(x.total_usd - cob - x.saldo_usd) > TOL) f6.push({ cxc: x.id, total: x.total_usd, cobrado: r2(cob), saldo: x.saldo_usd });
    if ((x.saldo_usd <= 0.005) !== (x.estado === 'pagada')) f6.push({ cxc: x.id, saldo: x.saldo_usd, estado: x.estado });
  }
  ctl('Crédito', 'Saldo de cada cuenta por cobrar = total − cobros, y estado coherente', f6);
  ctl('Crédito', 'Cada venta a crédito tiene su cuenta por cobrar por el monto correcto', q(`SELECT v.numero FROM ventas v JOIN pagos p ON p.venta_id=v.id AND p.medio='credito' LEFT JOIN cxc x ON x.venta_id=v.id
      WHERE v.estado='completada' AND (x.id IS NULL OR ABS(x.total_usd - p.monto_usd) > 0.02)`));
  ctl('Crédito', 'Ningún cliente supera su límite de crédito', q(`SELECT c.nombre, c.limite_usd, SUM(x.saldo_usd) AS deuda FROM clientes c JOIN cxc x ON x.cliente_id=c.id AND x.estado IN ('pendiente','abonada')
      GROUP BY c.id HAVING deuda > c.limite_usd + 0.02`));
  const f7 = [];
  for (const x of q("SELECT * FROM cxp WHERE estado<>'anulada'")) {
    const pg = g('SELECT COALESCE(SUM(monto_usd),0) AS s FROM cxp_pagos WHERE cxp_id=?', x.id).s;
    if (Math.abs(x.total_usd - pg - x.saldo_usd) > TOL) f7.push({ cxp: x.id, total: x.total_usd, pagado: r2(pg), saldo: x.saldo_usd });
  }
  ctl('Compras', 'Saldo de cada cuenta por pagar = total − pagos', f7);
  ctl('Compras', 'Toda compra a crédito recibida genera cuenta por pagar', q("SELECT c.numero FROM compras c WHERE c.condicion='credito' AND c.estado='recibida' AND NOT EXISTS (SELECT 1 FROM cxp x WHERE x.compra_id=c.id)"));
  ctl('Compras', 'Compras en moneda extranjera guardan la tasa del día', q("SELECT numero FROM compras WHERE estado='recibida' AND moneda='VES' AND tasa<=1"));
  ctl('Compras', 'Costo del producto nunca queda en cero tras comprar', q("SELECT p.nombre FROM productos p WHERE p.costo_usd<=0 AND EXISTS (SELECT 1 FROM compra_detalles d JOIN compras c ON c.id=d.compra_id WHERE d.producto_id=p.id AND c.estado='recibida' AND d.costo_usd_unidad>0)"), 'MEDIA');

  // App de pedidos
  ctl('Pedidos app', 'Pedido pagado/entregado tiene venta y orden de entrega', q("SELECT p.numero FROM pedidos p WHERE p.estado IN ('pagado','entregado') AND (p.venta_id IS NULL OR NOT EXISTS (SELECT 1 FROM ordenes_entrega o WHERE o.pedido_id=p.id))"));
  ctl('Pedidos app', 'Pedido rechazado/cancelado/vencido no genera venta ni orden', q("SELECT p.numero FROM pedidos p WHERE p.estado IN ('rechazado','cancelado','vencido') AND (p.venta_id IS NOT NULL OR EXISTS (SELECT 1 FROM ordenes_entrega o WHERE o.pedido_id=p.id AND o.estado<>'cancelada'))"));
  ctl('Pedidos app', 'El pago validado coincide con el total del pedido', q(`SELECT p.numero, p.total_usd, v.total_usd AS venta FROM pedidos p JOIN ventas v ON v.id=p.venta_id WHERE v.estado='completada' AND ABS(v.total_usd - p.total_usd) > 0.02`), 'MEDIA');

  // Auditoría y trazabilidad
  const sens = [['venta_anulada', "SELECT COUNT(*) AS n FROM ventas WHERE estado='anulada'"], ['compra_recibida', "SELECT COUNT(*) AS n FROM compras WHERE estado='recibida'"], ['caja_cerrada', "SELECT COUNT(*) AS n FROM caja_turnos WHERE estado='cerrada'"], ['jornada_cerrada', "SELECT COUNT(*) AS n FROM jornadas WHERE estado='cerrada'"]];
  ctl('Auditoría', 'Cada operación sensible deja registro en la bitácora', sens.filter(([acc, sql]) => g(sql).n !== g('SELECT COUNT(*) AS n FROM auditoria WHERE accion=?', acc).n).map(([acc, sql]) => ({ accion: acc, documentos: g(sql).n, bitacora: g('SELECT COUNT(*) AS n FROM auditoria WHERE accion=?', acc).n })), 'MEDIA');

  const res = {
    ventas: g("SELECT COUNT(*) AS n, COALESCE(SUM(total_usd),0) AS t FROM ventas WHERE estado='completada'"),
    inv: g("SELECT COALESCE(SUM(MAX(0,s)*c),0) AS v FROM (SELECT (SELECT COALESCE(SUM(cantidad),0) FROM inventario_movimientos m WHERE m.producto_id=p.id) AS s, p.costo_usd AS c FROM productos p)").v,
    utilidad: g("SELECT COALESCE(SUM(d.precio_usd*d.cantidad - d.descuento_usd - d.costo_usd*d.cantidad),0) AS u FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id WHERE v.estado='completada'").u,
    cxc: g("SELECT COALESCE(SUM(saldo_usd),0) AS s FROM cxc WHERE estado IN ('pendiente','abonada')").s,
    cxp: g("SELECT COALESCE(SUM(saldo_usd),0) AS s FROM cxp WHERE estado IN ('pendiente','abonada')").s,
    movs: g('SELECT COUNT(*) AS n FROM inventario_movimientos').n, aud: g('SELECT COUNT(*) AS n FROM auditoria').n
  };
  // observaciones informativas (no son fallas)
  const sinMargen = q('SELECT nombre, costo_usd, precio_usd FROM productos WHERE activo=1 AND precio_usd>0 AND precio_usd < costo_usd');
  if (sinMargen.length) hallazgo('MEDIA', 'Precios', `${sinMargen.length} producto(s) se venden por debajo de su costo`, sinMargen.slice(0, 3).map((p) => `${p.nombre}: costo ${p.costo_usd} precio ${p.precio_usd}`).join(' | '));
  const dupRef = q("SELECT referencia, COUNT(*) AS n FROM pagos WHERE referencia IS NOT NULL AND tipo='venta' AND anulado=0 AND medio<>'efectivo' GROUP BY referencia, medio HAVING n>1");
  if (dupRef.length) hallazgo('BAJA', 'Pagos', `${dupRef.length} referencia(s) bancarias repetidas en ventas del POS`, 'El POS no impide repetir una referencia (la app sí).');
  db.close();
  return res;
}

// =====================================================================
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
function informe(res, seg) {
  const sev = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  const hs = [...hallazgos].sort((a, b) => sev[a.sev] - sev[b.sev]);
  const okC = controles.filter((c) => c.ok).length, okS = sondas.filter((s) => s.ok).length;
  const peores = Object.entries(lat).map(([k, v]) => ({ k, n: v.length, p50: pct(v, 0.5), p95: pct(v, 0.95), max: Math.max(...v) })).sort((a, b) => b.p95 - a.p95).slice(0, 8);
  const total = Object.values(lat).reduce((a, v) => a + v.length, 0);
  const L = [];
  L.push(`# Informe del probador y auditor — Abasto Cloud`, '', `Empresa simulada: \`${SLUG}\` · ${JORNADAS} jornadas · semilla ${args.semilla || 7} · duración ${seg.toFixed(1)} s · ${total} llamadas a la API`, '');
  L.push('## Resultado', '', `- Controles contables y de integridad: **${okC} de ${controles.length}** sin diferencias`, `- Pruebas de rechazo (operaciones que NO deben permitirse): **${okS} de ${sondas.length}** correctas`,
    `- Hallazgos: **${hs.filter((h) => h.sev === 'ALTA').length} altos**, ${hs.filter((h) => h.sev === 'MEDIA').length} medios, ${hs.filter((h) => h.sev === 'BAJA').length} bajos`, '');
  L.push('## Lo que se simuló', '', `| Concepto | Cantidad |`, '|---|---:|', ...Object.entries({ 'Jornadas cerradas': jornadasHechas, 'Turnos de caja': stats.turnos, 'Ventas registradas (POS + app)': stats.ventas, 'Ventas a crédito': stats.ventasCredito, 'Ventas anuladas': stats.ventasAnuladas,
    'Pedidos de la app creados': stats.pedidos, 'Pagos de app validados': stats.pedidosValidados, 'Pagos de app rechazados': stats.pedidosRechazados, 'Pedidos cancelados por el cliente': stats.pedidosCancelados, 'Compras recibidas': stats.compras,
    'Cobros de crédito': stats.cobros, 'Pagos a proveedores': stats.pagosProv, 'Conteos cíclicos': stats.conteos, 'Mermas': stats.mermas, 'Cierres de caja con diferencia': stats.difCaja }).map(([k, v]) => `| ${k} | ${v} |`), '');
  L.push('## Cifras resultantes (de la base)', '', `- Ventas completadas: ${res.ventas.n} por USD ${r2(res.ventas.t)} · utilidad bruta USD ${r2(res.utilidad)}`, `- Inventario valorizado: USD ${r2(res.inv)} · cuentas por cobrar USD ${r2(res.cxc)} · por pagar USD ${r2(res.cxp)}`, `- Movimientos de inventario: ${res.movs} · registros de auditoría: ${res.aud}`, '');
  L.push('## Hallazgos', '');
  if (!hs.length) L.push('Ninguno. Todos los controles cuadraron y todas las pruebas de rechazo se comportaron como se esperaba.', '');
  else hs.forEach((h, i) => L.push(`${i + 1}. **[${h.sev}] ${h.area} — ${h.titulo}**${h.detalle ? `\n   ${h.detalle}` : ''}`));
  L.push('', '## Controles del auditor', '', '| Área | Control | Resultado |', '|---|---|---|', ...controles.map((c) => `| ${c.area} | ${c.nombre} | ${c.ok ? 'OK' : `**${c.fallas} diferencia(s)**`} |`), '');
  L.push('## Pruebas de rechazo', '', '| Prueba | Esperado | Real | |', '|---|---:|---:|---|', ...sondas.map((s) => `| ${s.desc} | ${s.esperado} | ${s.real} | ${s.ok ? 'OK' : '**FALLA**'} |`), '');
  L.push('## Rendimiento (ms)', '', '| Llamada | n | p50 | p95 | máx |', '|---|---:|---:|---:|---:|', ...peores.map((p) => `| ${p.k} | ${p.n} | ${p.p50.toFixed(0)} | ${p.p95.toFixed(0)} | ${p.max.toFixed(0)} |`), '');
  L.push('## Límites de esta prueba', '', '- Las "jornadas" se simulan en secuencia dentro de la misma fecha real; no se probaron cambios de fecha ni reportes por días distintos.',
    '- No se prueba la interfaz gráfica ni el reconocimiento por foto (necesita la API real de Claude).', '- Los datos son sintéticos; los controles verifican consistencia interna, no si el negocio real está bien parametrizado.', '');
  return L.join('\n');
}

(async () => {
  const t0 = Date.now();
  console.log(`Simulador: ${BASE} · empresa ${SLUG} · ${JORNADAS} jornadas`);
  await preparar(); console.log(' · empresa y usuarios listos');
  await maestros(); console.log(' · maestros listos');
  if (!EJEMPLO) { await stockInicial(); console.log(' · inventario inicial cargado'); }
  for (let n = 1; n <= JORNADAS; n++) { const abierta = EJEMPLO && n === JORNADAS; await jornada(n, n === JORNADAS, abierta); console.log(` · jornada ${n}/${JORNADAS} ${abierta ? 'dejada abierta' : 'cerrada'} (${stats.ventas} ventas acumuladas)`); }
  console.log(' · auditando la base…');
  const res = auditar();
  const md = informe(res, (Date.now() - t0) / 1000);
  const salida = path.resolve(__dirname, '..', '..', EJEMPLO ? 'informe-auditoria-demo.md' : 'informe-auditoria.md');
  fs.writeFileSync(salida, md);
  const altos = hallazgos.filter((h) => h.sev === 'ALTA').length;
  console.log(`\nControles: ${controles.filter((c) => c.ok).length}/${controles.length} OK · Rechazos: ${sondas.filter((s) => s.ok).length}/${sondas.length} OK · Hallazgos: ${hallazgos.length} (${altos} altos)`);
  console.log('Informe: ' + salida);
  process.exit(altos ? 2 : 0);
})().catch((e) => { console.error('El simulador se detuvo:', e.message); process.exit(1); });
