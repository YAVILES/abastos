'use strict';
// Prueba de humo de punta a punta contra una base temporal.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abasto-'));
process.env.DATA_DIR = dir;
process.env.RESPALDOS_DIR = path.join(dir, 'respaldos');
process.env.ADMIN_PASSWORD = 'clave-prueba-1';
process.env.PLATAFORMA_CLAVE = 'plataforma-prueba-1';
delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
const assert = require('node:assert/strict');
const http = require('node:http');
const D = require('../db');
const P = require('../plataforma');
P.iniciar();
const { servidor } = require('../server');

let base, token = '';
async function api(metodo, ruta, body, tk = token, extra = {}) {
  const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: 'Bearer ' + tk } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j, data: j };
}
const ok = async (p) => { const r = await p; assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const falla = async (p, status, texto) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.data)); if (texto) assert.match(r.data.error, texto); return r.data; };
let n = 0; const paso = (t) => console.log(`  ${String(++n).padStart(2, '0')}. ${t}`);

(async () => {
  await new Promise((r) => servidor.listen(0, r));
  base = 'http://127.0.0.1:' + servidor.address().port;

  paso('login y permisos');
  await falla(api('POST', '/api/login', { usuario: 'admin', clave: 'mala' }), 401);
  token = (await ok(api('POST', '/api/login', { usuario: 'admin', clave: 'clave-prueba-1' }))).token;
  await falla(api('GET', '/api/productos', null, ''), 401);
  const cajeroU = await ok(api('POST', '/api/usuarios', { nombre: 'Cajera', usuario: 'cajera', clave: 'cajera123', rol: 'cajero' }));
  const tokCajero = (await ok(api('POST', '/api/login', { usuario: 'cajera', clave: 'cajera123' }))).token;
  // las pruebas de abajo venden sin cliente; la exigencia de identificarlo (activa por defecto) se prueba en su propio bloque
  await ok(api('PUT', '/api/parametros/operacion', { venta_requiere_cliente: false }));
  await falla(api('POST', '/api/usuarios', { nombre: 'x', usuario: 'x', clave: '123456', rol: 'admin' }, tokCajero), 403);

  paso('sin día abierto no se opera');
  await falla(api('POST', '/api/compras', { proveedor_id: 1, moneda: 'USD', items: [] }), 400);
  await falla(api('POST', '/api/jornada/abrir', { tasa_usd_ves: 0, tasa_eur_usd: 1.1 }), 400);
  await ok(api('POST', '/api/jornada/abrir', { tasa_usd_ves: 40, tasa_eur_usd: 1.1, fuente: 'BCV' }));
  await falla(api('POST', '/api/jornada/abrir', { tasa_usd_ves: 40, tasa_eur_usd: 1.1 }), 409);
  await falla(api('POST', '/api/jornada/tasas', { tasa_usd_ves: 879, tasa_eur_usd: 960, motivo: 'x' }), 400, /no es coherente/); // Bs por euro escritos donde van USD por euro
  await ok(api('POST', '/api/jornada/tasas', { tasa_usd_ves: 40, tasa_eur_ves: 44, motivo: 'euro en bolívares' }));
  assert.equal(Math.round((await ok(api('GET', '/api/jornada'))).jornada.tasa_eur_usd * 1000) / 1000, 1.1, 'EUR/USD derivado de Bs por euro');
  { // cada tasa pertenece a una fecha
    const p2 = (n) => String(n).padStart(2, '0'), fmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    const hoy = fmt(new Date()), mañana = fmt(new Date(Date.now() + 864e5)), lejos = fmt(new Date(Date.now() + 20 * 864e5)), ayer = fmt(new Date(Date.now() - 864e5));
    const reg = await ok(api('GET', '/api/tasas'));
    assert.equal(reg.tasa_hoy.fecha, hoy, 'abrir el día registra la tasa de hoy');
    assert.equal(reg.desactualizada, false);
    await falla(api('POST', '/api/tasas', { tasa_usd_ves: 41, tasa_eur_ves: 45 }), 400, /fecha/);
    await falla(api('POST', '/api/tasas', { fecha: 'mañana', tasa_usd_ves: 41, tasa_eur_ves: 45 }), 400, /fecha/);
    await falla(api('POST', '/api/tasas', { fecha: lejos, tasa_usd_ves: 41, tasa_eur_ves: 45 }), 400, /7 días/);
    await falla(api('POST', '/api/tasas', { fecha: hoy, tasa_usd_ves: 41, tasa_eur_ves: 45 }), 400, /motivo/); // ya tiene tasa
    await falla(api('POST', '/api/tasas', { fecha: ayer, tasa_usd_ves: 39, tasa_eur_ves: 43 }), 400, /motivo/); // fecha pasada
    await falla(api('POST', '/api/tasas', { fecha: hoy, tasa_usd_ves: 41, tasa_eur_ves: 45, motivo: 'x' }, tokCajero), 403);
    // la de mañana solo se guarda en el historial: no cambia la tasa con la que se vende hoy
    const m = await ok(api('POST', '/api/tasas', { fecha: mañana, tasa_usd_ves: 41, tasa_eur_ves: 45 }));
    assert.equal(m.actualiza_el_dia_abierto, false);
    assert.equal((await ok(api('GET', '/api/jornada'))).jornada.tasa_usd_ves, 40);
    assert.equal((await ok(api('GET', '/api/tasas'))).lista.find((x) => x.fecha === mañana).tasa_usd_ves, 41);
    // la de hoy sí cambia la tasa del día abierto, con su motivo, y vuelve a la original
    const h = await ok(api('POST', '/api/tasas', { fecha: hoy, tasa_usd_ves: 40.5, tasa_eur_ves: 44.55, motivo: 'ajuste de mediodía' }));
    assert.equal(h.actualiza_el_dia_abierto, true);
    assert.equal((await ok(api('GET', '/api/jornada'))).jornada.tasa_usd_ves, 40.5);
    await ok(api('POST', '/api/tasas', { fecha: hoy, tasa_usd_ves: 40, tasa_eur_ves: 44, motivo: 'vuelve a la tasa de apertura' }));
    assert.equal((await ok(api('GET', '/api/jornada'))).jornada.tasa_usd_ves, 40);
    assert.equal((await ok(api('GET', '/api/tasas'))).tasa_hoy.tasa_usd_ves, 40);
  }

  paso('maestros: proveedor, productos con barras');
  const prov = (await ok(api('POST', '/api/proveedores', { nombre: 'Distribuidora Sur', dias_credito: 15 }))).id;
  const cats = await ok(api('GET', '/api/categorias'));
  const p1 = (await ok(api('POST', '/api/productos', { nombre: 'Harina de maíz 1kg', categoria_id: cats[0].id, codigos: ['7590000000011'], costo_usd: 0.95, precio_usd: 1.3, stock_min: 12, stock_max: 60, proveedor_id: prov, factor: 20, unidad_compra: 'caja' }))).id;
  const p2 = (await ok(api('POST', '/api/productos', { nombre: 'Arroz 1kg', categoria_id: cats[1].id, codigos: ['7590000000028'], costo_usd: 0.9, precio_fijo: 0, margen: 28.5714, stock_min: 5, stock_max: 30, proveedor_id: prov }))).id;
  await falla(api('POST', '/api/productos', { nombre: 'Dup', codigos: ['7590000000011'] }), 409, /ya pertenece/);
  assert.equal((await ok(api('GET', '/api/productos/' + p2))).precio_usd, 1.26, 'precio por margen');
  // el margen es sobre el precio de venta: costo 5,90 con 30 % = 8,43; un margen de 100 % o más no existe
  const pmg = await ok(api('POST', '/api/productos', { nombre: 'Prueba margen', costo_usd: 5.9, precio_fijo: 0, margen: 30 }));
  assert.equal((await ok(api('GET', '/api/productos/' + pmg.id))).precio_usd, 8.43);
  await falla(api('POST', '/api/productos', { nombre: 'Margen imposible', costo_usd: 5.9, precio_fijo: 0, margen: 100 }), 400, /menor a 100/);
  await ok(api('PUT', '/api/productos/' + pmg.id, { activo: 0 }));

  paso('compra a contado en Bs: stock, costo promedio y salida de banco');
  const banco = (await ok(api('GET', '/api/cuentas'))).find((c) => c.tipo === 'banco');
  await ok(api('PUT', '/api/cuentas/' + banco.id, { saldo_inicial: 100000 }));
  const compra = (await ok(api('POST', '/api/compras', { proveedor_id: prov, moneda: 'VES', condicion: 'contado', medio: 'transferencia', referencia: 'TR123', cuenta_id: banco.id, recibir: true,
    items: [{ producto_id: p1, cantidad: 2, costo_unit: 760 }, { producto_id: p2, cantidad: 40, costo_unit: 36 }] }))).id; // caja de 20: 760/20/40 = 0.95 USD c/u
  assert.equal((await ok(api('GET', '/api/productos/' + p1))).stock, 40);
  assert.equal((await ok(api('GET', '/api/productos/' + p1))).costo_usd, 0.95);
  assert.equal((await ok(api('GET', '/api/cuentas'))).find((c) => c.id === banco.id).saldo, 100000 - (1520 + 1440));
  await falla(api('PUT', '/api/cuentas/' + banco.id, { saldo_inicial: 5 }), 409, /saldo inicial/);

  paso('compra a crédito genera CxP y se paga');
  const c2 = (await ok(api('POST', '/api/compras', { proveedor_id: prov, moneda: 'USD', condicion: 'credito', recibir: true, items: [{ producto_id: p2, cantidad: 10, costo_unit: 1 }] }))).id;
  const cxp = (await ok(api('GET', '/api/cxp?estado=abiertas')))[0];
  assert.equal(cxp.saldo_usd, 10);
  await ok(api('POST', `/api/cxp/${cxp.id}/pagar`, { moneda: 'USD', monto: 4, referencia: '' }));
  assert.equal((await ok(api('GET', '/api/cxp?estado=abiertas')))[0].saldo_usd, 6);
  const ec = await ok(api('GET', `/api/proveedores/${prov}/estado-cuenta`));
  assert.equal(ec.resumen.deuda_usd, 6); assert.equal(ec.resumen.pagado_usd, 4); assert.equal(ec.resumen.compras_credito_usd, 10); assert.equal(ec.resumen.facturas_abiertas, 1);
  assert.equal(ec.resumen.antiguedad.vigente, 6); assert.equal(ec.resumen.vencida_usd, 0);
  const movs = ec.movimientos.filter((m) => m.tipo !== 'contado');
  assert.deepEqual(movs.map((m) => m.tipo), ['cargo', 'pago']); assert.deepEqual(movs.map((m) => m.saldo), [10, 6], 'el saldo acumulado baja con cada pago');
  assert.ok(ec.movimientos.some((m) => m.tipo === 'contado'), 'las compras de contado figuran como información, sin deuda');
  assert.equal(ec.facturas[0].pagos.length, 1); assert.equal(ec.facturas[0].pagado_usd, 4); assert.equal(ec.facturas[0].saldo_usd, 6);
  const rs = await ok(api('GET', '/api/cxp/resumen'));
  assert.equal(rs.length, 1); assert.equal(rs[0].deuda, 6); assert.ok(rs[0].ultimo_pago);
  await falla(api('GET', '/api/proveedores/9999/estado-cuenta'), 404);

  paso('caja: abrir, no se vende sin caja');
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 2 }] }), 409, /caja/);
  const cajas = await ok(api('GET', '/api/cajas'));
  await ok(api('POST', '/api/turnos/abrir', { caja_id: cajas[0].id, fondo: { USD: 20, VES: 1000 } }));

  paso('venta con pago mixto (USD efectivo + Bs pago móvil) y vuelto');
  const barra = await ok(api('GET', '/api/productos/barra/7590000000011'));
  assert.equal(barra.id, p1);
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 2 }], pagos: [{ medio: 'pago_movil', moneda: 'VES', monto: 40 }] }), 400, /referencia/);
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 2 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 1 }] }), 400, /incompleto/);
  const v1 = await ok(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 2 }, { producto_id: p2, cantidad: 1 }],
    pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 2 }, { medio: 'pago_movil', moneda: 'VES', monto: 80, referencia: '998877', cuenta_id: banco.id }] })); // total 3.86 ; pagado 2 + 2 = 4 => vuelto .14
  assert.equal(v1.total_usd, 3.89); // arroz sube a 1.29 por costo promedio
  assert.equal(v1.vuelto_usd, 0.11);
  assert.equal((await ok(api('GET', '/api/productos/' + p1))).stock, 38);
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 999 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5000 }] }), 409, /Stock insuficiente/);
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 1, precio_usd: 0.5 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5 }] }, ''), 401);
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 1 }], descuento_pct: 20, pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5 }] }, tokCajero), 409); // cajero sin caja

  paso('crédito de cliente: límite y cobro');
  const cli1 = (await ok(api('POST', '/api/clientes', { nombre: 'Doña Marta', telefono: '04141234567', credito_habilitado: 1, limite_usd: 10, dias_credito: 7 }))).id;
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 1 }], pagos: [{ medio: 'credito' }] }), 400, /cliente identificado/);
  await falla(api('POST', '/api/ventas', { cliente_id: cli1, items: [{ producto_id: p1, cantidad: 10 }], pagos: [{ medio: 'credito' }] }), 409, /límite/);
  const v2 = await ok(api('POST', '/api/ventas', { cliente_id: cli1, items: [{ producto_id: p1, cantidad: 4 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 1 }, { medio: 'credito' }] })); // 5.20: 1 contado + 4.20 crédito
  assert.equal(v2.credito_usd, 4.2);
  const cxc = (await ok(api('GET', '/api/cxc?cliente_id=' + cli1)))[0];
  await ok(api('POST', `/api/cxc/${cxc.id}/cobrar`, { pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 2.2 }] }));
  assert.equal((await ok(api('GET', '/api/cxc?cliente_id=' + cli1)))[0].estado, 'abonada');
  await falla(api('POST', `/api/cxc/${cxc.id}/cobrar`, { pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 99 }] }), 400, /excede/);
  await ok(api('POST', `/api/cxc/${cxc.id}/cobrar`, { pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 2 }] }));
  assert.equal((await ok(api('GET', '/api/cxc?cliente_id=' + cli1)))[0].estado, 'pagada');
  await falla(api('PUT', '/api/clientes/' + cli1, { nombre: 'x', limite_usd: 999 }, tokCajero), 403);

  paso('vuelto en otra moneda y medio: caja y banco cuadran');
  {
    const venta = (vuelto) => api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5 }], vuelto });
    const tur = () => ok(api('GET', '/api/turno'));
    const t0 = await tur();
    // sin indicar nada: todo el vuelto sale en efectivo USD
    const d = await ok(venta(undefined));
    assert.deepEqual(d.vuelto.map((x) => x.moneda + x.medio), ['USDefectivo']);
    const exc = d.vuelto_usd;
    await ok(api('POST', `/api/ventas/${d.id}/anular`, { motivo: 'prueba de vuelto' }));
    // un vuelto que no coincide con el excedente se rechaza
    await falla(venta([{ medio: 'efectivo', moneda: 'VES', monto: 10 }]), 400, /no coincide/);
    await falla(venta([{ medio: 'pago_movil', moneda: 'VES', monto: Math.round(exc * 40 * 100) / 100 }]), 400, /referencia/);
    await falla(venta([{ medio: 'punto', moneda: 'VES', monto: Math.round(exc * 40 * 100) / 100 }]), 400, /solo puede darse/);
    // mitad en dólares, mitad en bolívares por pago móvil
    const mitadUSD = Math.floor(exc);
    const restoBs = Math.round((exc - mitadUSD) * 40 * 100) / 100;
    const v = await ok(venta([{ medio: 'efectivo', moneda: 'USD', monto: mitadUSD }, { medio: 'pago_movil', moneda: 'VES', monto: restoBs, referencia: 'VUELTO-1', cuenta_id: banco.id }]));
    assert.equal(v.vuelto.length, 2); assert.equal(v.vuelto_usd, exc);
    const det = await ok(api('GET', `/api/ventas/${v.id}`));
    assert.equal(det.pagos.filter((p) => p.tipo === 'vuelto').length, 2);
    const t1 = await tur();
    assert.equal(Math.round((t1.resumen.esperado.USD - t0.resumen.esperado.USD - (5 - mitadUSD)) * 100) / 100, 0); // entra el billete y sale el vuelto en USD
    assert.equal(t1.resumen.vueltos.length >= 2, true);
    assert.equal(t1.resumen.por_medio.some((m) => m.medio === 'pago_movil' && m.monto === restoBs), false); // el vuelto no se cuenta como cobro
    await ok(api('POST', `/api/ventas/${v.id}/anular`, { motivo: 'prueba de vuelto' }));
    const t2 = await tur();
    assert.equal(t2.resumen.esperado.USD, t0.resumen.esperado.USD);
    assert.equal(t2.resumen.esperado.VES, t0.resumen.esperado.VES);
  }

  paso('anular una venta revierte stock y dinero');
  const antes = (await ok(api('GET', '/api/productos/' + p2))).stock;
  const v3 = await ok(api('POST', '/api/ventas', { items: [{ producto_id: p2, cantidad: 3 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 4 }] }));
  await falla(api('POST', `/api/ventas/${v3.id}/anular`, { motivo: '' }), 400);
  await ok(api('POST', `/api/ventas/${v3.id}/anular`, { motivo: 'Error de digitación' }));
  assert.equal((await ok(api('GET', '/api/productos/' + p2))).stock, antes);
  await falla(api('POST', `/api/ventas/${v3.id}/anular`, { motivo: 'otra vez' }), 409);

  paso('pedido por app: reserva, pago reportado, validación, orden y semáforo');
  const medio = await ok(api('POST', '/api/medios-app', { medio: 'pago_movil', banco: 'Banesco', cuenta_id: banco.id, tipo_doc: 'J', documento: '123456789', telefono: '04141112233', moneda: 'VES', estado: 'publicado' }));
  await ok(api('POST', '/api/medios-app', { medio: 'transferencia', banco: 'Mercantil', cuenta_id: banco.id, titular: 'Mi Abasto C.A.', documento: 'J-1', num_cuenta: '0105000000000000000', tipo_cuenta: 'corriente', moneda: 'VES', estado: 'oculto' }));
  const publicados = await ok(api('GET', '/api/app/medios-pago'));
  assert.equal(publicados.length, 1, 'solo los publicados');
  const reg = await ok(api('POST', '/api/app/registro', { nombre: 'Pedro Cliente', telefono: '04245556677', pin: '1234' }, ''));
  const ct = reg.token;
  await falla(api('POST', '/api/app/registro', { nombre: 'Otro', telefono: '04245556677', pin: '1234' }, ''), 409);
  await falla(api('POST', '/api/app/login', { telefono: '04245556677', pin: '0000' }, ''), 401);
  await ok(api('POST', '/api/app/login', { telefono: '+58 424-555.6677', pin: '1234' }, '')); // mismo número escrito con +58
  await ok(api('POST', '/api/app/login', { telefono: '4245556677', pin: '1234' }, ''));
  await falla(api('POST', '/api/clientes', { nombre: 'Duplicado', telefono: '584245556677' }), 409, /teléfono/);
  const cat = await ok(api('GET', '/api/app/catalogo', null, ''));
  assert.ok(cat.productos.length === 2 && cat.productos.every((x) => x.stock === undefined));
  await falla(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 500 }] }, ct), 409, /Stock insuficiente/);
  const stockAntes = (await ok(api('GET', '/api/productos/' + p1))).disponible;
  const ped = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 5 }], entrega: 'envio', contacto: 'Pedro', telefono: '04245556677', zona: 'Centro', direccion: 'Calle 1', referencia_entrega: 'Casa azul' }, ct));
  assert.equal((await ok(api('GET', '/api/productos/' + p1))).disponible, stockAntes - 5, 'reserva descuenta disponible');
  assert.equal((await ok(api('GET', '/api/productos/' + p1))).stock, 34, 'pero no el stock real');
  await falla(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 1 }], entrega: 'envio' }, ct), 400);
  let det = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(det.semaforo.color, 'amarillo');
  const montoVES = 6.5 * 40;
  await ok(api('POST', `/api/app/pedidos/${ped.id}/pago`, { medio_app_id: medio.id, monto: montoVES, banco_emisor: 'Provincial', referencia: 'REF001' }, ct));
  await falla(api('POST', `/api/app/pedidos/${ped.id}/pago`, { medio_app_id: medio.id, monto: montoVES, banco_emisor: 'Provincial', referencia: 'REF001' }, ct), 409);
  det = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(det.estado, 'pago_reportado');
  const stBefore = (await ok(api('GET', '/api/productos/' + p1))).stock;
  const pago = det.pagos[0];
  const val = await ok(api('POST', `/api/pedidos/${ped.id}/validar-pago`, { pago_id: pago.id }));
  assert.ok(val.venta.numero && val.orden_id);
  assert.equal((await ok(api('GET', '/api/productos/' + p1))).stock, stBefore - 5, 'ahora sí baja el stock real');
  det = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(det.semaforo.color, 'verde');
  // preparación con verificación por escaneo: no se puede saltar etapas ni terminar con productos sin verificar
  const oid = val.orden_id, barraP1 = '7590000000011';
  await falla(api('POST', `/api/ordenes/${oid}/estado`, { estado: 'preparada' }), 400, /paso a paso/);
  await falla(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }), 409, /empieza la preparación/);
  const prep = await ok(api('POST', `/api/ordenes/${oid}/preparar/iniciar`, {}));
  assert.equal(prep.lineas.length, 1); assert.equal(prep.requerido, 5); assert.equal(prep.completo, false); assert.equal(prep.orden.estado, 'en_preparacion');
  await falla(api('POST', `/api/ordenes/${oid}/estado`, { estado: 'preparada' }), 409, /Faltan productos/);
  await falla(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: '7590000000028' }), 409, /NO pertenece/); // arroz: no va en este pedido
  await falla(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: '0000000000' }), 404, /no registrado/);
  for (let k = 0; k < 3; k++) await ok(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }));
  await falla(api('POST', `/api/ordenes/${oid}/preparar/manual`, { producto_id: p1, cantidad: 1 }), 400, /por qué/);
  assert.equal((await ok(api('POST', `/api/ordenes/${oid}/preparar/manual`, { producto_id: p1, cantidad: 1, motivo: 'código ilegible' }))).lineas[0].escaneado, 4);
  assert.equal((await ok(api('POST', `/api/ordenes/${oid}/preparar/deshacer`, { producto_id: p1 }))).lineas[0].escaneado, 3);
  assert.equal((await ok(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }))).faltan, 1);
  const ult = await ok(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }));
  assert.equal(ult.completo, true);
  await falla(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }), 409, /sobra/);
  await falla(api('POST', `/api/ordenes/${oid}/estado`, { estado: 'lista_envio' }), 400, /paso a paso/);
  for (const e of ['preparada', 'lista_envio']) await ok(api('POST', `/api/ordenes/${oid}/estado`, { estado: e }));

  // ---- app del repartidor: aviso, tomar, en camino, entregado ----
  await ok(api('POST', '/api/usuarios', { nombre: 'Juan Repartidor', usuario: 'juan', clave: 'reparto123', rol: 'repartidor', telefono: '0414 555 1212' }));
  await ok(api('POST', '/api/usuarios', { nombre: 'Pedro Repartidor', usuario: 'pedro', clave: 'reparto123', rol: 'repartidor' }));
  const tokJuan = (await ok(api('POST', '/api/login', { usuario: 'juan', clave: 'reparto123' }, ''))).token;
  const tokPedro = (await ok(api('POST', '/api/login', { usuario: 'pedro', clave: 'reparto123' }, ''))).token;
  await falla(api('GET', '/api/productos', null, tokJuan), 403); // el repartidor no ve inventario, clientes ni ventas
  await falla(api('GET', '/api/clientes', null, tokJuan), 403);
  await falla(api('POST', '/api/ventas', { items: [] }, tokJuan), 403);
  await falla(api('GET', '/api/reparto/mis', null, tokCajero), 403);
  let misJuan = await ok(api('GET', '/api/reparto/mis', null, tokJuan));
  assert.equal(misJuan.disponibles.length, 1, 'el pedido listo para envío aparece como disponible para repartir');
  assert.equal(misJuan.disponibles[0].zona, 'Centro'); assert.ok(misJuan.disponibles[0].unidades >= 5);
  { // aviso inmediato: la asignación llega a la app del repartidor por la conexión abierta, sin esperar la consulta periódica
    const escuchar = async (tk) => {
      const ctl = new AbortController(), eventos = [];
      const r = await fetch(base + '/api/reparto/eventos', { headers: { Authorization: 'Bearer ' + tk }, signal: ctl.signal });
      assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/event-stream/);
      (async () => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = ''; try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const m = b.match(/^data: (.*)$/m); if (m) eventos.push(JSON.parse(m[1])); } } } catch { /* cerrado */ } })();
      return { eventos, cerrar: () => ctl.abort() };
    };
    assert.equal((await fetch(base + '/api/reparto/eventos', { headers: { Authorization: 'Bearer ' + tokCajero } })).status, 403);
    assert.equal((await fetch(base + '/api/reparto/eventos')).status, 401);
    const cJuan = await escuchar(tokJuan), cPedro = await escuchar(tokPedro);
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    const repJuan = (await ok(api('GET', '/api/repartidores'))).find((x) => x.usuario === 'juan');
    await ok(api('POST', `/api/ordenes/${oid}/asignar`, { repartidor_id: repJuan.id }));
    await espera(400);
    assert.ok(cJuan.eventos.some((x) => x.tipo === 'asignado' && x.orden), 'Juan se entera al instante de que le asignaron el pedido');
    assert.ok(!cPedro.eventos.some((x) => x.tipo === 'asignado'), 'Pedro no recibe el aviso de una asignación ajena');
    assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokJuan))).asignados.length, 1, 'y el pedido ya aparece en su lista');
    await ok(api('POST', `/api/ordenes/${oid}/asignar`, { repartidor_id: null })); // se devuelve a la bolsa común
    await espera(400);
    assert.ok(cPedro.eventos.some((x) => x.tipo === 'cambio'), 'todos se enteran de que el pedido volvió a estar disponible');
    cJuan.cerrar(); cPedro.cerrar();
  }
  await falla(api('POST', `/api/reparto/ordenes/${oid}/entregar`, {}, tokJuan), 409, /Primero toma/); // sin dueño no se puede entregar
  await ok(api('POST', `/api/reparto/ordenes/${oid}/tomar`, {}, tokJuan));
  await falla(api('POST', `/api/reparto/ordenes/${oid}/tomar`, {}, tokPedro), 409, /Otro repartidor/);
  assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokPedro))).disponibles.length, 0, 'ya no aparece para los demás');
  assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokJuan))).asignados.length, 1);
  { // los tres estados del repartidor: retirado de la tienda → en camino → entregado
    await falla(api('POST', `/api/reparto/ordenes/${oid}/retirar`, {}, tokPedro), 409, /otro repartidor/);
    await falla(api('POST', `/api/reparto/ordenes/${oid}/retirar`, {}, tokCajero), 403);
    await ok(api('POST', `/api/reparto/ordenes/${oid}/retirar`, {}, tokJuan));
    const mis = await ok(api('GET', '/api/reparto/mis', null, tokJuan));
    assert.equal(mis.retirados.length, 1); assert.equal(mis.asignados.length, 0); assert.equal(mis.en_camino.length, 0); assert.ok(mis.retirados[0].retirado_en);
    const cli = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
    assert.equal(cli.orden.estado, 'retirada'); assert.match(cli.semaforo.mensaje, /retiró/); assert.ok(cli.orden.retirado_en);
    assert.ok(cli.semaforo.pasos.includes('Retirado de la tienda'));
    await falla(api('POST', `/api/reparto/ordenes/${oid}/retirar`, {}, tokJuan), 409, /ya fue retirado/);
    await falla(api('POST', `/api/ordenes/${oid}/asignar`, { repartidor_id: null }), 409, /ya fue retirado/);
  }
  await falla(api('POST', `/api/reparto/ordenes/${oid}/salir`, {}, tokPedro), 409, /otro repartidor/);
  await ok(api('POST', `/api/reparto/ordenes/${oid}/salir`, {}, tokJuan));
  const enCamino = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(enCamino.orden.estado, 'enviada'); assert.equal(enCamino.orden.repartidor, 'Juan Repartidor'); assert.equal(enCamino.orden.repartidor_tel, '04145551212');
  assert.match(enCamino.semaforo.mensaje, /camino/); assert.equal(enCamino.orden.nota_entrega, undefined, 'el cliente no recibe datos internos de la orden');
  assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokJuan))).en_camino.length, 1);
  await falla(api('POST', `/api/reparto/ordenes/${oid}/entregar`, {}, tokPedro), 409, /otro repartidor/);
  await ok(api('POST', `/api/reparto/ordenes/${oid}/entregar`, { receptor: 'Ana', nota: 'Se dejó con el vigilante' }, tokJuan));
  await falla(api('POST', `/api/reparto/ordenes/${oid}/entregar`, {}, tokJuan), 409, /ya fue entregado/);
  const entregado = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(entregado.estado, 'entregado'); assert.equal(entregado.orden.receptor, 'Ana');
  assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokJuan))).entregados.length, 1);
  assert.equal((await ok(api('GET', '/api/pedidos'))).find((x) => x.id === ped.id).repartidor, 'Juan Repartidor', 'el sistema ve quién entregó');
  { // calificación del servicio: estrellas y observación, una sola vez y solo con el pedido entregado
    await falla(api('POST', `/api/app/pedidos/${ped.id}/calificar`, { estrellas: 0 }, ct), 400, /1 a 5/);
    await falla(api('POST', `/api/app/pedidos/${ped.id}/calificar`, { estrellas: 6 }, ct), 400, /1 a 5/);
    await falla(api('POST', `/api/app/pedidos/${ped.id}/calificar`, { estrellas: 3.5 }, ct), 400, /1 a 5/);
    await ok(api('POST', `/api/app/pedidos/${ped.id}/calificar`, { estrellas: 4, nota: '  Llegó rápido y bien empacado  ' }, ct));
    const cal = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
    assert.equal(cal.calificacion, 4); assert.equal(cal.calificacion_nota, 'Llegó rápido y bien empacado'); assert.ok(cal.calificado_en);
    await falla(api('POST', `/api/app/pedidos/${ped.id}/calificar`, { estrellas: 5 }, ct), 409, /Ya calificaste/);
    assert.equal((await ok(api('GET', '/api/app/pedidos', null, ct))).find((x) => x.id === ped.id).calificacion, 4, 'la lista del cliente trae su calificación');
    assert.equal((await ok(api('GET', '/api/pedidos'))).find((x) => x.id === ped.id).calificacion, 4, 'el sistema ve la calificación');
  }
  await falla(api('POST', `/api/ordenes/${oid}/asignar`, { repartidor_id: 1 }), 409, /ya salió/);
  assert.equal((await ok(api('GET', '/api/repartidores'))).length, 2);
  await falla(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }), 409, /ya terminó/);
  { // el cliente rechaza el pedido en la puerta
    const ped2 = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 1 }], entrega: 'envio', contacto: 'Rosa', telefono: '04245556677', zona: 'Norte', direccion: 'Calle 9' }, ct));
    await ok(api('POST', `/api/app/pedidos/${ped2.id}/pago`, { medio_app_id: medio.id, monto: 52, banco_emisor: 'Provincial', referencia: 'REF-RZ-1' }, ct));
    const d2 = await ok(api('GET', '/api/app/pedidos/' + ped2.id, null, ct));
    const o2 = (await ok(api('POST', `/api/pedidos/${ped2.id}/validar-pago`, { pago_id: d2.pagos[0].id }))).orden_id;
    await ok(api('POST', `/api/ordenes/${o2}/preparar/iniciar`, {}));
    await ok(api('POST', `/api/ordenes/${o2}/preparar/escanear`, { codigo: barraP1 }));
    await ok(api('POST', `/api/ordenes/${o2}/estado`, { estado: 'preparada' }));
    // un pedido preparado y asignado ya lo puede gestionar su repartidor, sin esperar a que el negocio lo marque "listo para envío"
    const pedroId = (await ok(api('GET', '/api/repartidores'))).find((x) => x.usuario === 'pedro').id;
    await falla(api('POST', `/api/reparto/ordenes/${o2}/retirar`, {}, tokPedro), 409, /todavía no está listo/); // sin asignar, no
    await ok(api('POST', `/api/ordenes/${o2}/asignar`, { repartidor_id: pedroId }));
    const misPre = await ok(api('GET', '/api/reparto/mis', null, tokPedro));
    assert.ok(misPre.asignados.some((x) => x.id === o2), 'aparece en Por buscar con sus botones'); assert.ok(!misPre.proximos.some((x) => x.id === o2));
    await falla(api('POST', `/api/reparto/ordenes/${o2}/retirar`, {}, tokJuan), 409, /otro repartidor/);
    await falla(api('POST', `/api/reparto/ordenes/${o2}/rechazar`, { motivo: 'x' }, tokPedro), 409, /ya retiraste/); // rechazar es después de retirar
    await ok(api('POST', `/api/reparto/ordenes/${o2}/retirar`, {}, tokPedro));
    await falla(api('POST', `/api/reparto/ordenes/${o2}/retirar`, {}, tokPedro), 409, /ya fue retirado/);
    await ok(api('POST', `/api/reparto/ordenes/${o2}/salir`, {}, tokPedro));
    await falla(api('POST', `/api/reparto/ordenes/${o2}/rechazar`, { motivo: 'No había nadie' }, tokJuan), 409, /otro repartidor/);
    await falla(api('POST', `/api/reparto/ordenes/${o2}/rechazar`, {}, tokPedro), 400, /Indica por qué/);
    await ok(api('POST', `/api/reparto/ordenes/${o2}/rechazar`, { motivo: 'No había nadie para recibirlo', nota: 'tocó tres veces' }, tokPedro));
    await falla(api('POST', `/api/reparto/ordenes/${o2}/rechazar`, { motivo: 'otra vez' }, tokPedro), 409, /ya fue marcado/);
    await falla(api('POST', `/api/reparto/ordenes/${o2}/entregar`, {}, tokPedro), 409, /rechazado/);
    const cli2 = await ok(api('GET', '/api/app/pedidos/' + ped2.id, null, ct));
    assert.equal(cli2.orden.estado, 'rechazada'); assert.equal(cli2.semaforo.color, 'rojo'); assert.match(cli2.semaforo.mensaje, /rechazado/);
    const misP = await ok(api('GET', '/api/reparto/mis', null, tokPedro));
    assert.equal(misP.en_camino.length, 0); assert.equal(misP.entregados.length, 1); assert.equal(misP.entregados[0].estado, 'rechazada'); assert.equal(misP.entregados[0].motivo_rechazo, 'No había nadie para recibirlo');
    await falla(api('POST', `/api/ordenes/${o2}/estado`, { estado: 'entregada' }), 409, /rechazada/);
    await falla(api('POST', `/api/ordenes/${o2}/asignar`, { repartidor_id: null }), 409, /reprograma/);
    // el negocio decide: reprogramar vuelve a ponerlo disponible para los repartidores
    await falla(api('POST', `/api/ordenes/${o2}/reprogramar`, {}, tokJuan), 403);
    await ok(api('POST', `/api/ordenes/${o2}/reprogramar`, {}));
    await falla(api('POST', `/api/ordenes/${o2}/reprogramar`, {}), 409, /fue rechazada/);
    assert.ok((await ok(api('GET', '/api/reparto/mis', null, tokJuan))).disponibles.some((x) => x.id === o2), 'vuelve a estar disponible');
    assert.equal((await ok(api('GET', '/api/app/pedidos/' + ped2.id, null, ct))).orden.estado, 'lista_envio');
    await ok(api('POST', `/api/pedidos/${ped2.id}/cancelar`, { motivo: 'prueba de rechazo' })); // o se cancela: se anula la venta y el stock vuelve
    // si al repartidor se le pasa marcar el retiro y la salida, puede ir directo a "entregado": los pasos intermedios quedan con la misma hora
    const ped3 = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 1 }], entrega: 'envio', contacto: 'Rosa', telefono: '04245556677', zona: 'Norte', direccion: 'Calle 10' }, ct));
    await ok(api('POST', `/api/app/pedidos/${ped3.id}/pago`, { medio_app_id: medio.id, monto: 52, banco_emisor: 'Provincial', referencia: 'REF-RZ-2' }, ct));
    const d3 = await ok(api('GET', '/api/app/pedidos/' + ped3.id, null, ct));
    const o3 = (await ok(api('POST', `/api/pedidos/${ped3.id}/validar-pago`, { pago_id: d3.pagos[0].id }))).orden_id;
    await ok(api('POST', `/api/ordenes/${o3}/preparar/iniciar`, {}));
    await ok(api('POST', `/api/ordenes/${o3}/preparar/escanear`, { codigo: barraP1 }));
    await ok(api('POST', `/api/ordenes/${o3}/estado`, { estado: 'preparada' }));
    const pedroId3 = (await ok(api('GET', '/api/repartidores'))).find((x) => x.usuario === 'pedro').id;
    await ok(api('POST', `/api/ordenes/${o3}/asignar`, { repartidor_id: pedroId3 }));
    await falla(api('POST', `/api/reparto/ordenes/${o3}/entregar`, {}, tokJuan), 409, /otro repartidor/);
    await ok(api('POST', `/api/reparto/ordenes/${o3}/entregar`, { receptor: 'Rosa' }, tokPedro));
    const fin3 = await ok(api('GET', '/api/ordenes/' + o3, null));
    assert.equal(fin3.orden.estado, 'entregada'); assert.ok(fin3.orden.retirado_en && fin3.orden.salida_en && fin3.orden.entregado_en); assert.equal(fin3.orden.retirado_en, fin3.orden.salida_en);
    assert.equal((await ok(api('GET', '/api/app/pedidos/' + ped3.id, null, ct))).estado, 'entregado');
  }
  det = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(det.estado, 'entregado');
  await falla(api('POST', `/api/ordenes/${val.orden_id}/estado`, { estado: 'enviada' }), 409);

  paso('pago rechazado libera la reserva');
  const ped2 = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 3 }], entrega: 'retiro' }, ct));
  await falla(api('POST', `/api/app/pedidos/${ped2.id}/calificar`, { estrellas: 5 }, ct), 409, /cuando recibas/); // aún no entregado
  await ok(api('POST', `/api/app/pedidos/${ped2.id}/pago`, { medio_app_id: medio.id, monto: 156, banco_emisor: 'BNC', referencia: 'REF002' }, ct));
  const d2 = await ok(api('GET', '/api/pedidos/' + ped2.id));
  await falla(api('POST', `/api/pedidos/${ped2.id}/rechazar-pago`, { pago_id: d2.pagos[0].id }), 400);
  await ok(api('POST', `/api/pedidos/${ped2.id}/rechazar-pago`, { motivo: 'Referencia no aparece en el banco' }));
  const d2b = await ok(api('GET', '/api/app/pedidos/' + ped2.id, null, ct));
  assert.equal(d2b.semaforo.color, 'rojo');
  assert.equal(d2b.expira, null, 'un pedido rechazado no conserva fecha de reserva');
  const lp = await ok(api('GET', '/api/pedidos'));
  assert.ok(lp.find((x) => x.id === ped.id).orden_numero, 'el pedido validado muestra su número de orden de entrega');
  assert.equal(lp.find((x) => x.id === ped2.id).orden_numero, null, 'el rechazado no tiene orden de entrega');
  assert.equal(d2b.orden, null);
  assert.equal(D.conEmpresa('principal', () => D.get("SELECT COUNT(*) AS n FROM reservas WHERE pedido_id=? AND estado='activa'", ped2.id).n), 0);

  paso('medios publicables en la app: efectivo y punto de venta se pagan al recibir');
  {
    const cuentas = await ok(api('GET', '/api/cuentas'));
    const cajaUSD = cuentas.find((c) => c.tipo === 'caja' && c.moneda === 'USD');
    const antes = (await ok(api('GET', '/api/app/medios-pago'))).length;
    await falla(api('POST', '/api/medios-app', { medio: 'efectivo', cuenta_id: banco.id, moneda: 'VES', estado: 'publicado' }), 400, /caja de efectivo/);
    const efe = await ok(api('POST', '/api/medios-app', { medio: 'efectivo', cuenta_id: cajaUSD.id, moneda: 'USD', observacion: 'Trae billetes pequeños', estado: 'publicado' }));
    const pun = await ok(api('POST', '/api/medios-app', { medio: 'punto', cuenta_id: banco.id, moneda: 'VES', estado: 'publicado' }));
    const oculto = await ok(api('POST', '/api/medios-app', { medio: 'efectivo', cuenta_id: cajaUSD.id, moneda: 'USD', estado: 'oculto' }));
    const pub = await ok(api('GET', '/api/app/medios-pago'));
    assert.equal(pub.length, antes + 2, 'solo aparecen los que se marcaron como publicados');
    assert.ok(pub.some((m) => m.medio === 'efectivo') && pub.some((m) => m.medio === 'punto') && !pub.some((m) => m.id === oculto.id));
    const ct2 = (await ok(api('POST', '/api/app/login', { telefono: '04245556677', pin: '1234' }, ''))).token;
    const pd = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 1 }], entrega: 'retiro' }, ct2));
    await falla(api('POST', `/api/app/pedidos/${pd.id}/pago`, { medio_app_id: oculto.id, monto: 1.3 }, ct2), 400, /publicadas/);
    await falla(api('POST', `/api/app/pedidos/${pd.id}/pago`, { medio_app_id: efe.id, monto: 1.3 }, ct2), 400, /denominación/); // en efectivo es obligatorio decir con cuánto paga
    await falla(api('POST', `/api/app/pedidos/${pd.id}/pago`, { medio_app_id: efe.id, monto: 1.3, paga_con: '' }, ct2), 400, /denominación/);
    await falla(api('POST', `/api/app/pedidos/${pd.id}/pago`, { medio_app_id: efe.id, monto: 1.3, paga_con: 1 }, ct2), 400, /no alcanza/);
    await ok(api('POST', `/api/app/pedidos/${pd.id}/pago`, { medio_app_id: efe.id, monto: 1.3, paga_con: 5 }, ct2)); // sin referencia ni banco; paga con un billete de $5
    const dp = await ok(api('GET', '/api/app/pedidos/' + pd.id, null, ct2));
    assert.equal(dp.estado, 'pago_reportado');
    assert.equal(dp.pagos[0].paga_con, 5);
    const vv = await ok(api('POST', `/api/pedidos/${pd.id}/validar-pago`, { pago_id: dp.pagos[0].id })); // por defecto toma lo que dijo que pagaría
    assert.ok(vv.venta.numero);
    assert.equal(vv.venta.vuelto_usd, 3.7);
    assert.deepEqual(vv.venta.vuelto.map((x) => x.moneda + x.medio), ['USDefectivo']);
    await ok(api('POST', `/api/pedidos/${pd.id}/cancelar`, { motivo: 'prueba de pago al recibir' }));
    const pd2 = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 1 }], entrega: 'retiro' }, ct2));
    await ok(api('POST', `/api/app/pedidos/${pd2.id}/pago`, { medio_app_id: pun.id, monto: 51.6 }, ct2));
    const dp2 = await ok(api('GET', '/api/app/pedidos/' + pd2.id, null, ct2));
    await ok(api('POST', `/api/pedidos/${pd2.id}/validar-pago`, { pago_id: dp2.pagos[0].id, monto_confirmado: 51.6 }));
    await ok(api('POST', `/api/pedidos/${pd2.id}/cancelar`, { motivo: 'prueba de punto de venta' }));
    await ok(api('PUT', `/api/medios-app/${efe.id}`, { medio: 'efectivo', cuenta_id: cajaUSD.id, moneda: 'USD', estado: 'inactivo' }));
    await ok(api('PUT', `/api/medios-app/${pun.id}`, { medio: 'punto', cuenta_id: banco.id, moneda: 'VES', estado: 'inactivo' }));
  }

  paso('reserva vencida se libera sola');
  const ped3 = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p2, cantidad: 2 }], entrega: 'retiro' }, ct));
  D.conEmpresa('principal', () => D.run("UPDATE reservas SET expira='2000-01-01 00:00:00' WHERE pedido_id=?", ped3.id));
  assert.equal((await ok(api('GET', '/api/app/pedidos/' + ped3.id, null, ct))).estado, 'vencido');

  paso('sugerencias de compra y pedido a proveedor');
  await ok(api('POST', '/api/inventario/ajuste', { producto_id: p2, cantidad: -45, tipo: 'merma', motivo: 'Gorgojo' }));
  const sug = await ok(api('GET', '/api/compras/sugerencias'));
  assert.ok(sug.find((s) => s.id === p2), 'arroz bajo mínimo');
  const gen = await ok(api('POST', '/api/compras/desde-sugerencias', { items: [{ producto_id: p2, cantidad_compra: 20 }] }));
  assert.equal(gen.ids.length, 1);

  paso('sugerencias de compra inteligentes: velocidad de venta, plazo, seguridad, pedidos en camino');
  await falla(api('PUT', '/api/parametros/operacion', { compra_ciclo_dias: 0 }), 400, /ciclo de compra/);
  const provLento = (await ok(api('POST', '/api/proveedores', { nombre: 'Proveedor de plazo largo', plazo_entrega: 5 }))).id;
  const nuevoProd = async (nombre, extra) => (await ok(api('POST', '/api/productos', { nombre, costo_usd: 2, precio_usd: 3, stock_min: 3, proveedor_id: provLento, factor: 6, unidad_compra: 'caja', ...extra }))).id;
  const pA = await nuevoProd('Demanda constante', {}), pB = await nuevoProd('Sobrestock', { stock_min: 0 }), pC = await nuevoProd('Sin movimiento', { stock_min: 0 });
  const mov = (pid, tipo, cant, dias) => D.conEmpresa('principal', () => D.run("INSERT INTO inventario_movimientos(producto_id,fecha,tipo,cantidad,costo_usd,motivo) VALUES(?,?,?,?,?,'prueba')", pid, D.sumarDias(-dias) + ' 12:00:00', tipo, cant, 2));
  mov(pA, 'inventario_inicial', 126, 61); for (let i = 0; i < 60; i++) mov(pA, 'venta', -2, i);   // vende 2 por día durante 60 días: quedan 6
  mov(pB, 'inventario_inicial', 530, 31); for (let i = 0; i < 30; i++) mov(pB, 'venta', -1, i);   // vende 1 por día y tiene 500
  mov(pC, 'inventario_inicial', 40, 120); mov(pC, 'venta', -1, 100);                              // una venta hace 100 días
  const an = await ok(api('GET', '/api/compras/analisis'));
  const fa = an.filas.find((x) => x.id === pA);
  assert.equal(fa.venta_dia, 2); assert.equal(fa.stock_seguridad, 0, 'ventas constantes: sin variación, sin stock de seguridad');
  assert.equal(fa.cobertura_dias, 3); assert.equal(fa.plazo, 5);
  assert.equal(fa.punto_pedido, 10, 'ventas/día × plazo = 2 × 5');
  assert.equal(fa.objetivo, 24, 'ventas/día × (plazo 5 + ciclo 7)');
  assert.equal(fa.nivel, 'critico', 'dura 3 días y el proveedor tarda 5: se agota antes de que llegue');
  assert.equal(fa.sugerido_unidades, 18); assert.equal(fa.sugerido_compra, 3, '18 unidades = 3 cajas de 6'); assert.equal(fa.costo_estimado, 36);
  assert.match(fa.motivo, /se agotaría antes de que llegue/);
  assert.equal(an.filas.find((x) => x.id === pB).nivel, 'sobrestock'); assert.equal(an.filas.find((x) => x.id === pB).sugerido_compra, 0);
  assert.equal(an.filas.find((x) => x.id === pC).nivel, 'sin_movimiento');
  assert.ok(an.resumen.en_riesgo >= 1 && an.resumen.inmovilizado_usd >= 1000 + 78,  'el capital inmovilizado suma el sobrestock y lo sin movimiento');
  assert.ok((await ok(api('GET', '/api/compras/sugerencias'))).some((x) => x.id === pA), 'la lista a reponer incluye el producto crítico');
  // un pedido en camino (borrador) descuenta lo que ya se pidió
  await ok(api('POST', '/api/compras', { proveedor_id: provLento, moneda: 'USD', condicion: 'contado', items: [{ producto_id: pA, cantidad: 3, costo_unit: 12 }] }));
  const fa2 = (await ok(api('GET', '/api/compras/analisis'))).filas.find((x) => x.id === pA);
  assert.equal(fa2.pendiente, 18); assert.equal(fa2.sugerido_unidades, 0, 'ya está pedido: no se sugiere de nuevo'); assert.equal(fa2.nivel, 'planificar');
  // poco historial no infla un día atípico
  const pD = await nuevoProd('Un solo día', { stock_min: 0 });
  mov(pD, 'inventario_inicial', 100, 0); mov(pD, 'venta', -70, 0);
  const fd = (await ok(api('GET', '/api/compras/analisis'))).filas.find((x) => x.id === pD);
  assert.ok(fd && fd.venta_dia <= 10.5, 'una venta de 70 en un día se promedia sobre 7 días, no sobre 1: ' + (fd && fd.venta_dia)); assert.equal(fd.fiable, false);

  paso('lector de código de barras: parámetros y validaciones');
  assert.equal((await ok(api('GET', '/api/me'))).lector.sufijo, 'Enter', 'el lector viene configurado por defecto como teclado + Enter');
  await falla(api('PUT', '/api/parametros/lector', { sufijo: 'Espacio' }), 400, /Enter, Tab/);
  await falla(api('PUT', '/api/parametros/lector', { ms_entre_teclas: 5 }), 400, /entre teclas/);
  await falla(api('PUT', '/api/parametros/lector', { tipo: 'bluetooth' }), 400, /no válido/);
  await falla(api('PUT', '/api/parametros/lector', { sufijo: 'Tab' }, tokCajero), 403);
  const lec = await ok(api('PUT', '/api/parametros/lector', { sufijo: 'Tab', prefijo: '*', largo_min: 8, ms_entre_teclas: 80, sonido: false }));
  assert.equal(lec.sufijo, 'Tab'); assert.equal((await ok(api('GET', '/api/me'))).lector.prefijo, '*');
  await ok(api('PUT', '/api/parametros/lector', { sufijo: 'Enter', prefijo: '', largo_min: 6, ms_entre_teclas: 60, sonido: true }));

  paso('inventario cíclico ABC: parámetros, generar, cargar, autorizar ajuste');
  await falla(api('PUT', '/api/parametros/abc', { pctA: 60, pctB: 30, pctC: 30 }), 400, /100/);
  await ok(api('PUT', '/api/parametros/abc', { pctA: 50, pctB: 30, pctC: 20, dias_operativos: 300 }));
  const abc = await ok(api('GET', '/api/abc'));
  assert.ok(abc.total >= 2);
  const cnt = await ok(api('POST', '/api/conteos/generar', { cantidad: 99, responsable: 'Almacén' })); // la cantidad que se mande se ignora
  assert.equal(cnt.items, Math.min(abc.total, abc.items_diarios), 'la cantidad sale del plan ABC, no del usuario');
  assert.equal(cnt.cuota.A + cnt.cuota.B + cnt.cuota.C, cnt.items);
  assert.match(cnt.numero, /^IC-\d{8}-001$/);
  await falla(api('POST', '/api/conteos/generar', {}), 409, /Ya existe/);
  const doc = await ok(api('GET', '/api/conteos/' + cnt.numero));
  assert.equal(doc.ciego, false); assert.ok(doc.items.every((i) => typeof i.stock_sistema === 'number'), 'el supervisor ve la cantidad del sistema');
  const docCiego = await ok(api('GET', '/api/conteos/' + cnt.id, null, tokCajero)); // quien cuenta: conteo a ciegas
  assert.equal(docCiego.ciego, true);
  assert.ok(docCiego.items.every((i) => i.stock_sistema === null && i.diferencia === null && i.motivo === null && i.clase === null && i.costo_usd === null), 'no se filtra nada del sistema a quien cuenta');
  assert.equal((await ok(api('GET', '/api/conteos', null, tokCajero)))[0].con_diferencia, null);
  assert.equal(JSON.stringify(docCiego).includes('arrastre'), false);
  await ok(api('POST', `/api/conteos/${doc.id}/cargar`, { items: doc.items.map((i) => ({ id: i.id, contado: i.stock_sistema - 1, observacion: 'falta 1' })) }));
  const stockPrev = (await ok(api('GET', '/api/productos/' + doc.items[0].producto_id))).stock;
  await falla(api('POST', `/api/conteos/${doc.id}/autorizar`, {}, tokCajero), 403);
  await ok(api('POST', `/api/conteos/${doc.id}/autorizar`, {}));
  assert.equal((await ok(api('GET', '/api/productos/' + doc.items[0].producto_id))).stock, stockPrev - 1);
  assert.equal((await ok(api('GET', '/api/conteos/' + doc.id))).estado, 'cerrado');

  paso('logo de la empresa: se guarda, se muestra a los clientes y se valida');
  {
    await falla(api('PUT', '/api/parametros/empresa', { logo: 'data:text/html;base64,PGI+' }), 400, /logo/);
    await falla(api('PUT', '/api/parametros/empresa', { logo: 'http://x.com/a.png' }), 400, /logo/);
    await falla(api('PUT', '/api/parametros/empresa', { logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }, tokCajero), 403);
    await ok(api('PUT', '/api/parametros/empresa', { logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }));
    assert.equal((await ok(api('GET', '/api/app/config', null, ''))).empresa.logo, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    assert.equal((await ok(api('GET', '/api/me'))).empresa.logo, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    await ok(api('PUT', '/api/parametros/empresa', { rif: 'J-12345678-0' })); // guardar otros datos no borra el logo
    assert.equal((await ok(api('GET', '/api/parametros'))).empresa.logo, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    await ok(api('PUT', '/api/parametros/empresa', { logo: '' }));
    assert.equal((await ok(api('GET', '/api/app/config', null, ''))).empresa.logo, '');
  }

  paso('orden de compra: se envía al proveedor y al recibir se ajustan cantidades y costos');
  {
    const catsOC = await ok(api('GET', '/api/categorias'));
    const nuevoProd = async (nombre, codigo) => (await ok(api('POST', '/api/productos', { nombre, categoria_id: catsOC[0].id, codigos: [codigo], costo_usd: 0, precio_usd: 9, factor: 1, proveedor_id: prov }))).id;
    const pA = await nuevoProd('Producto orden A', '7590000008881'), pB = await nuevoProd('Producto orden B', '7590000008882');
    const orden = async () => (await ok(api('POST', '/api/compras', { proveedor_id: prov, moneda: 'USD', condicion: 'contado', medio: 'efectivo', items: [{ producto_id: pA, cantidad: 10, costo_unit: 1 }, { producto_id: pB, cantidad: 5, costo_unit: 2 }] }))).id;
    const stock = async (id) => (await ok(api('GET', '/api/productos/' + id))).stock;
    const id = await orden();
    let c = await ok(api('GET', '/api/compras/' + id));
    assert.equal(c.estado, 'borrador'); assert.equal(c.total_moneda, 20); assert.equal(c.total_pedido, 20);
    // enviada al proveedor: queda el hecho registrado y el estado
    await falla(api('POST', `/api/compras/${id}/enviar`, { medio_envio: 'whatsapp' }, tokCajero), 403);
    await ok(api('POST', `/api/compras/${id}/enviar`, { medio_envio: 'whatsapp', nota: 'Se la mandé a Pedro por WhatsApp' }));
    c = await ok(api('GET', '/api/compras/' + id));
    assert.equal(c.estado, 'enviada'); assert.ok(c.enviada_en); assert.equal(c.enviada_por, 'admin'); assert.equal(c.envio_medio, 'whatsapp'); assert.match(c.envio_nota, /Pedro/);
    await falla(api('POST', `/api/compras/${id}/enviar`, {}), 409, /ya fue enviada/);
    assert.equal(await stock(pA), 0, 'una orden enviada todavía no mueve el inventario');
    // la recepción no tiene que coincidir con lo pedido
    const [dA, dB] = c.items;
    await falla(api('POST', `/api/compras/${id}/recibir`, { items: [{ detalle_id: dA.id, cantidad: 0 }, { detalle_id: dB.id, cantidad: 0 }] }), 400, /al menos un producto/);
    await falla(api('POST', `/api/compras/${id}/recibir`, { items: [{ detalle_id: dA.id, cantidad: -1 }] }), 400, /inválido/);
    await falla(api('POST', `/api/compras/${id}/recibir`, { items: [{ detalle_id: 999999, cantidad: 1 }] }), 400, /no pertenece/);
    await ok(api('POST', `/api/compras/${id}/recibir`, { items: [{ detalle_id: dA.id, cantidad: 8, costo_unit: 1.1 }, { detalle_id: dB.id, cantidad: 0 }], factura: 'F-00123', factura_fecha: '2026-10-14', recepcion_nota: 'Faltaron 2 de A y nada de B', condicion: 'contado', medio: 'efectivo' }));
    c = await ok(api('GET', '/api/compras/' + id));
    assert.equal(c.estado, 'recibida'); assert.equal(c.con_diferencias, 1); assert.equal(c.factura, 'F-00123'); assert.equal(c.recibida_por, 'admin');
    assert.equal(c.total_pedido, 20, 'se conserva el total pedido'); assert.equal(c.total_moneda, 8.8); assert.equal(c.total_usd, 8.8);
    assert.equal(c.enviada_por, 'admin', 'y se conserva el registro del envío');
    const a = c.items.find((x) => x.producto_id === pA), b = c.items.find((x) => x.producto_id === pB);
    assert.equal(a.cantidad_pedida, 10); assert.equal(a.cantidad, 8); assert.equal(a.costo_pedido, 1); assert.equal(a.costo_unit, 1.1);
    assert.equal(b.cantidad_pedida, 5); assert.equal(b.cantidad, 0);
    assert.equal(await stock(pA), 8, 'entra al inventario lo que llegó'); assert.equal(await stock(pB), 0);
    assert.equal(Math.round((await ok(api('GET', '/api/productos/' + pA))).costo_usd * 1e4) / 1e4, 1.1, 'el costo sale de la factura');
    // una orden recibida tal cual se pidió no queda marcada con diferencias
    const id2 = await orden(); await ok(api('POST', `/api/compras/${id2}/enviar`, {}));
    await ok(api('POST', `/api/compras/${id2}/recibir`, { condicion: 'contado', medio: 'efectivo' }));
    c = await ok(api('GET', '/api/compras/' + id2));
    assert.equal(c.con_diferencias, 0); assert.equal(c.total_moneda, 20);
    assert.equal(await stock(pA), 18);
    // anular una recepción parcial solo revierte lo que entró
    await ok(api('POST', `/api/compras/${id}/anular`, { motivo: 'prueba de recepción parcial' }));
    assert.equal(await stock(pA), 10); assert.equal(await stock(pB), 5);
    await ok(api('POST', `/api/compras/${id2}/anular`, { motivo: 'prueba de recepción' }));
    // una orden enviada también se puede anular (el proveedor no la surtió)
    const id3 = await orden(); await ok(api('POST', `/api/compras/${id3}/enviar`, {}));
    await ok(api('POST', `/api/compras/${id3}/anular`, { motivo: 'el proveedor no tenía existencia' }));
    assert.equal((await ok(api('GET', '/api/compras/' + id3))).estado, 'anulada');
    await falla(api('POST', `/api/compras/${id3}/recibir`, {}), 409, /pendientes/);
  }

  paso('kardex valorizado al costo promedio móvil');
  {
    const cats2 = await ok(api('GET', '/api/categorias'));
    const k = (await ok(api('POST', '/api/productos', { nombre: 'Producto de kardex', categoria_id: cats2[0].id, codigos: ['7590000009991'], costo_usd: 0, precio_usd: 5, factor: 1, proveedor_id: prov }))).id;
    const comprar = (cant, costo) => ok(api('POST', '/api/compras', { proveedor_id: prov, moneda: 'USD', condicion: 'contado', medio: 'efectivo', recibir: true, items: [{ producto_id: k, cantidad: cant, costo_unit: costo }] }));
    const kardex = async () => ok(api('GET', `/api/productos/${k}/kardex`));
    const aprox = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.00011, `${msg}: ${a} ≠ ${b}`);
    const c1 = await comprar(10, 1); aprox((await kardex()).costo_promedio, 1, 'primera compra');
    await comprar(10, 2);
    let r = await kardex();
    aprox(r.costo_promedio, 1.5, 'promedio de 10 a $1 y 10 a $2'); assert.equal(r.existencia, 20); aprox(r.valor_usd, 30, 'valor del inventario');
    // el consumo sale al promedio vigente y queda en el detalle de la venta
    const venta = await ok(api('POST', '/api/ventas', { items: [{ producto_id: k, cantidad: 4 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 20 }] }));
    r = await kardex();
    aprox(r.movimientos[0].costo_usd, 1.5, 'la venta se valora al promedio'); aprox(r.movimientos[0].valor_usd, -6, 'valor de la salida'); aprox(r.movimientos[0].saldo_valor, 24, 'saldo en valor');
    aprox(r.costo_promedio, 1.5, 'vender no cambia el promedio');
    aprox((await ok(api('GET', '/api/ventas/' + venta.id))).items.find((x) => x.producto_id === k).costo_usd, 1.5, 'costo guardado en la venta');
    // una compra nueva a otro precio mueve el promedio: (16 × 1,5 + 4 × 3) / 20 = 1,8
    const c3 = await comprar(4, 3);
    aprox((await kardex()).costo_promedio, 1.8, 'promedio tras la tercera compra');
    // mermas y ajustes entran o salen al promedio del momento y no lo cambian
    await ok(api('POST', '/api/inventario/ajuste', { producto_id: k, tipo: 'merma', cantidad: -2, motivo: 'vencido' }));
    await ok(api('POST', '/api/inventario/ajuste', { producto_id: k, tipo: 'ajuste', cantidad: 3, motivo: 'sobrante' }));
    r = await kardex();
    aprox(r.movimientos[1].costo_usd, 1.8, 'la merma sale al promedio'); aprox(r.movimientos[0].costo_usd, 1.8, 'el ajuste entra al promedio');
    aprox(r.costo_promedio, 1.8, 'ajustes y mermas no mueven el promedio'); assert.equal(r.existencia, 21); aprox(r.valor_usd, 37.8, 'valor tras ajustes');
    // cambiar el costo a mano queda como revalorización: el saldo pasa a valer al costo nuevo
    await ok(api('PUT', '/api/productos/' + k, { costo_usd: 2 }));
    r = await kardex();
    assert.equal(r.movimientos[0].tipo, 'revalorizacion'); aprox(r.costo_promedio, 2, 'costo nuevo'); aprox(r.valor_usd, 42, 'valor al costo nuevo');
    // anular la compra de $3 quita esas 4 unidades a su costo y recalcula: (42 − 12) / 17
    await ok(api('POST', `/api/compras/${c3.id}/anular`, { motivo: 'prueba de kardex' }));
    r = await kardex();
    aprox(r.movimientos[0].costo_usd, 3, 'el reverso de la compra sale a su costo'); aprox(r.costo_promedio, 30 / 17, 'promedio tras anular la compra'); assert.equal(r.existencia, 17);
    assert.equal((await ok(api('GET', '/api/productos/' + k))).costo_usd, Math.round(30 / 17 * 1e4) / 1e4, 'el costo del producto sigue al promedio');
    // anular la venta devuelve las 4 unidades al costo con el que salieron: (30 + 6) / 21
    await ok(api('POST', `/api/ventas/${venta.id}/anular`, { motivo: 'prueba de kardex' }));
    r = await kardex();
    aprox(r.movimientos[0].costo_usd, 1.5, 'la devolución entra al costo de la venta'); aprox(r.costo_promedio, 36 / 21, 'promedio tras la devolución'); assert.equal(r.existencia, 21);
    // la existencia del kardex siempre coincide con la suma de los movimientos
    aprox(r.existencia, r.movimientos.reduce((a, m) => a + m.cantidad, 0), 'existencia = suma de movimientos');
    assert.ok(c1.id);
  }

  paso('estado de cuenta del cliente: facturas a crédito, cobros e historial con saldo');
  {
    await falla(api('GET', '/api/clientes/999999/estado-cuenta'), 404);
    const cid = (await ok(api('POST', '/api/clientes', { nombre: 'Cliente con historial', documento: 'V-8123456', telefono: '04125550101', credito_habilitado: true, limite_usd: 100, dias_credito: 7 }))).id;
    const vacio = await ok(api('GET', `/api/clientes/${cid}/estado-cuenta`));
    assert.equal(vacio.resumen.deuda_usd, 0); assert.deepEqual(vacio.movimientos, []); assert.equal(vacio.cliente.credito_habilitado, 1);
    const v1 = await ok(api('POST', '/api/ventas', { cliente_id: cid, items: [{ producto_id: p1, cantidad: 5 }], pagos: [{ medio: 'credito' }] }));
    const v2 = await ok(api('POST', '/api/ventas', { cliente_id: cid, items: [{ producto_id: p1, cantidad: 3 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 1 }, { medio: 'credito' }] }));
    const cxcs = await ok(api('GET', '/api/cxc?cliente_id=' + cid));
    const x1 = cxcs.find((x) => x.venta === v1.numero);
    await ok(api('POST', `/api/cxc/${x1.id}/cobrar`, { pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 2 }] }));
    await ok(api('POST', '/api/ventas', { cliente_id: cid, items: [{ producto_id: p1, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5 }] })); // de contado
    await ok(api('POST', `/api/ventas/${v2.id}/anular`, { motivo: 'prueba de estado de cuenta' }));
    const ec = await ok(api('GET', `/api/clientes/${cid}/estado-cuenta`));
    const esperada = Math.round((v1.credito_usd - 2) * 100) / 100;
    assert.equal(ec.resumen.deuda_usd, esperada, 'la deuda es lo facturado a crédito menos lo cobrado, sin la venta anulada');
    assert.equal(ec.resumen.cobrado_usd, 2); assert.equal(ec.resumen.facturas_abiertas, 1);
    assert.equal(ec.resumen.credito_disponible_usd, Math.round((100 - esperada) * 100) / 100);
    assert.deepEqual(ec.facturas.map((x) => x.estado).sort(), ['abonada', 'anulada']);
    assert.equal(ec.facturas.find((x) => x.venta === v1.numero).cobros.length, 1);
    assert.deepEqual(ec.movimientos.map((m) => m.tipo).sort(), ['cargo', 'cargo', 'cobro', 'contado', 'reverso']);
    const ultimo = ec.movimientos.filter((m) => m.tipo !== 'contado').slice(-1)[0];
    assert.equal(ultimo.saldo, esperada, 'el saldo corriente del último movimiento es la deuda actual');
    const cargo2 = ec.movimientos.find((m) => m.tipo === 'cargo' && m.doc === v2.numero);
    assert.match(cargo2.detalle, /otra parte se pagó al momento/);
    assert.equal(ec.movimientos.find((m) => m.tipo === 'contado').monto_info > 0, true);
    assert.equal((await ok(api('GET', `/api/clientes/${cid}/estado-cuenta`, null, tokCajero))).resumen.deuda_usd, esperada, 'el cajero también puede consultarlo');
    // recordatorios de saldos vencidos: solo salen los clientes con facturas vencidas
    assert.equal(ec.mensaje_recordatorio, null); assert.deepEqual(ec.recordatorios, []);
    assert.ok(!(await ok(api('GET', '/api/cxc/vencidos'))).clientes.some((c) => c.id === cid));
    await falla(api('POST', `/api/clientes/${cid}/recordatorio`, { mensaje: 'Hola' }), 409, /no tiene saldos vencidos/);
    D.conEmpresa('principal', () => D.run('UPDATE cxc SET vence=? WHERE id=?', D.sumarDias(-12), x1.id)); // la factura abierta venció hace 12 días
    const venc = await ok(api('GET', '/api/cxc/vencidos'));
    const fila = venc.clientes.find((c) => c.id === cid);
    assert.equal(fila.vencido_usd, esperada); assert.equal(fila.dias_max, 12); assert.equal(fila.facturas, 1); assert.equal(fila.ultimo_recordatorio, null);
    assert.match(fila.mensaje, /Cliente con historial/); assert.match(fila.mensaje, new RegExp(v1.numero)); assert.match(fila.mensaje, /vencida/);
    assert.ok(venc.total_vencido_usd >= esperada);
    await ok(api('POST', '/api/usuarios', { nombre: 'Vendedor Prueba', usuario: 'vend1', clave: 'vendedor123', rol: 'vendedor' }));
    const tokVendedor = (await ok(api('POST', '/api/login', { usuario: 'vend1', clave: 'vendedor123' }, ''))).token;
    await falla(api('POST', `/api/clientes/${cid}/recordatorio`, { mensaje: fila.mensaje }, tokVendedor), 403);
    await falla(api('POST', `/api/clientes/${cid}/recordatorio`, { mensaje: '  ' }), 400, /vacío/);
    await ok(api('POST', `/api/clientes/${cid}/recordatorio`, { mensaje: fila.mensaje, medio: 'whatsapp' }, tokCajero));
    const ec2 = await ok(api('GET', `/api/clientes/${cid}/estado-cuenta`));
    assert.equal(ec2.recordatorios.length, 1); assert.equal(ec2.recordatorios[0].usuario, 'cajera'); assert.equal(ec2.recordatorios[0].monto_usd, esperada); assert.equal(ec2.facturas.find((x) => x.venta === v1.numero).dias_vencida, 12);
    assert.ok(ec2.mensaje_recordatorio);
    assert.ok((await ok(api('GET', '/api/cxc/vencidos'))).clientes.find((c) => c.id === cid).ultimo_recordatorio, 'queda registrado cuándo se le recordó');
  }

  paso('toda venta del POS exige identificar al cliente por cédula o RIF');
  {
    await ok(api('PUT', '/api/parametros/operacion', { venta_requiere_cliente: true }));
    const venta = (cid) => api('POST', '/api/ventas', { cliente_id: cid, items: [{ producto_id: p1, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5 }] });
    await falla(venta(null), 400, /Identifica al cliente/);
    // búsqueda por documento: con o sin letra, con o sin guiones o puntos
    const sin = await ok(api('GET', '/api/clientes/por-documento?doc=V-17.234.567', null, tokCajero));
    assert.equal(sin.cliente, null); assert.equal(sin.documento, 'V-17234567');
    await falla(api('GET', '/api/clientes/por-documento?doc=12', null, tokCajero), 400, /completo/);
    const nuevo = await ok(api('POST', '/api/clientes', { nombre: 'Ana Documento', documento: 'v 17.234.567', telefono: '04121234567' }, tokCajero));
    for (const d of ['V-17234567', 'v17234567', '17234567', 'V-17.234.567']) {
      const r = await ok(api('GET', '/api/clientes/por-documento?doc=' + encodeURIComponent(d), null, tokCajero));
      assert.equal(r.cliente && r.cliente.id, nuevo.id, 'encuentra ' + d);
    }
    assert.equal((await ok(api('GET', '/api/clientes/por-documento?doc=E-17234567', null, tokCajero))).cliente, null, 'otra letra es otra persona');
    await falla(api('POST', '/api/clientes', { nombre: 'Repetida', documento: 'V-17234567' }, tokCajero), 409, /documento/);
    const v = await ok(venta(nuevo.id));
    assert.ok(v.numero);
    await ok(api('POST', `/api/ventas/${v.id}/anular`, { motivo: 'prueba de identificación' }));
    // un cliente que no tiene cédula o RIF no sirve para vender: primero hay que completarla
    const sinDoc = await ok(api('POST', '/api/clientes', { nombre: 'Sin Cédula', telefono: '04129998877' }, tokCajero));
    await falla(venta(sinDoc.id), 400, /Falta la cédula/);
    await ok(api('PUT', '/api/clientes/' + sinDoc.id, { documento: 'J-301234567' }, tokCajero));
    await falla(api('PUT', '/api/clientes/' + sinDoc.id, { documento: 'V-17234567' }, tokCajero), 409, /documento/);
    const v2 = await ok(venta(sinDoc.id));
    await ok(api('POST', `/api/ventas/${v2.id}/anular`, { motivo: 'prueba de identificación' }));
    // el administrador puede desactivar la exigencia
    await ok(api('PUT', '/api/parametros/operacion', { venta_requiere_cliente: false }));
    const v3 = await ok(venta(null));
    await ok(api('POST', `/api/ventas/${v3.id}/anular`, { motivo: 'prueba de identificación' }));
  }

  paso('roles y permisos por módulo, editables por el administrador');
  {
    await falla(api('GET', '/api/roles', null, tokCajero), 403);
    const rr = await ok(api('GET', '/api/roles'));
    assert.ok(rr.catalogo.length >= 4 && rr.roles.some((r) => r.codigo === 'admin' && r.permisos.includes('mod.finanzas')));
    const cajeroRol = rr.roles.find((r) => r.codigo === 'cajero');
    assert.ok(cajeroRol.permisos.includes('mod.pos') && !cajeroRol.permisos.includes('mod.finanzas'));
    let yo = await ok(api('GET', '/api/me', null, tokCajero));
    assert.ok(yo.permisos.includes('mod.pos') && !yo.permisos.includes('mod.parametros'));
    await falla(api('GET', '/api/finanzas/resumen', null, tokCajero), 403);
    await falla(api('PUT', '/api/roles/admin', { permisos: [] }), 400, /todo/);
    await falla(api('PUT', '/api/roles/cajero', { permisos: ['no.existe'] }), 400);
    // el administrador le da al cajero acceso al análisis financiero y vuelve a quitárselo
    await ok(api('PUT', '/api/roles/cajero', { permisos: [...cajeroRol.permisos, 'finanzas.ver', 'mod.finanzas'] }));
    yo = await ok(api('GET', '/api/me', null, tokCajero));
    assert.ok(yo.permisos.includes('mod.finanzas'));
    await ok(api('GET', '/api/finanzas/resumen', null, tokCajero));
    await ok(api('PUT', '/api/roles/cajero', { permisos: cajeroRol.permisos }));
    await falla(api('GET', '/api/finanzas/resumen', null, tokCajero), 403);
    // rol propio
    const nuevo = await ok(api('POST', '/api/roles', { nombre: 'Auditor interno', copiar_de: 'compras' }));
    assert.equal(nuevo.codigo, 'auditor_interno');
    await falla(api('POST', '/api/roles', { nombre: 'Auditor interno' }), 409);
    const u = await ok(api('POST', '/api/usuarios', { nombre: 'Aud', usuario: 'auditor1', clave: 'auditor123', rol: 'auditor_interno' }));
    await falla(api('POST', '/api/usuarios', { nombre: 'X', usuario: 'x1', clave: 'xxxxxx1', rol: 'inventado' }), 400, /Rol/);
    await falla(api('DELETE', '/api/roles/auditor_interno'), 409, /usuarios/);
    await falla(api('DELETE', '/api/roles/cajero'), 400, /base/);
    await ok(api('PUT', '/api/usuarios/' + u.id, { rol: 'vendedor', activo: false }));
    await ok(api('DELETE', '/api/roles/auditor_interno'));
  }

  paso('análisis financiero: estados, balance, flujo y gastos');
  {
    const cuentas = await ok(api('GET', '/api/cuentas'));
    const cajaUSD = cuentas.find((c) => c.tipo === 'caja' && c.moneda === 'USD');
    const d30 = new Date(Date.now() - 30 * 864e5), p2 = (n) => String(n).padStart(2, '0');
    const q = `?desde=${d30.getFullYear()}-${p2(d30.getMonth() + 1)}-${p2(d30.getDate())}`; // hasta = hoy
    const base = await ok(api('GET', '/api/finanzas/resumen' + q));
    const R0 = base.resultados;
    assert.ok(R0.ventas_netas > 0 && R0.costo_ventas > 0);
    assert.ok(Math.abs(R0.utilidad_bruta - (R0.ventas_netas - R0.costo_ventas)) < 0.011);
    const B0 = base.balance;
    assert.ok(Math.abs(B0.activos_total - (B0.efectivo + B0.bancos + B0.cxc + B0.inventario)) < 0.02);
    assert.ok(Math.abs(B0.patrimonio - (B0.activos_total - B0.pasivos_total)) < 0.02);
    await falla(api('POST', '/api/gastos', { categoria: 'Alquiler', moneda: 'VES', monto: 100, cuenta_id: cajaUSD.id }), 400, /moneda/);
    await falla(api('POST', '/api/gastos', { categoria: '', moneda: 'USD', monto: 10, cuenta_id: cajaUSD.id }), 400);
    await falla(api('POST', '/api/gastos', { categoria: 'Alquiler', moneda: 'USD', monto: 10, cuenta_id: cajaUSD.id }, tokCajero), 403);
    const saldoAntes = (await ok(api('GET', '/api/cuentas'))).find((c) => c.id === cajaUSD.id).saldo;
    const g = await ok(api('POST', '/api/gastos', { categoria: 'Alquiler', descripcion: 'Local octubre', moneda: 'USD', monto: 10, cuenta_id: cajaUSD.id }));
    const R1 = (await ok(api('GET', '/api/finanzas/resumen' + q)));
    assert.equal(Math.round((R1.resultados.gastos_total - R0.gastos_total) * 100) / 100, 10);
    assert.equal(Math.round((R0.utilidad_neta - R1.resultados.utilidad_neta) * 100) / 100, 10);
    assert.ok(R1.resultados.gastos.some((x) => x.categoria === 'Alquiler'));
    assert.equal(Math.round((B0.efectivo - R1.balance.efectivo) * 100) / 100, 10, 'el gasto sale de la caja');
    assert.ok(R1.flujo.lineas.find((l) => /Gastos/.test(l.concepto)).usd <= -10 + 0.011);
    assert.equal(Math.round((saldoAntes - (await ok(api('GET', '/api/cuentas'))).find((c) => c.id === cajaUSD.id).saldo) * 100) / 100, 10);
    const lista = await ok(api('GET', '/api/gastos' + q));
    assert.ok(lista.gastos.some((x) => x.id === g.id) && lista.categorias.length >= 5);
    await falla(api('POST', `/api/gastos/${g.id}/anular`, { motivo: '' }), 400);
    await ok(api('POST', `/api/gastos/${g.id}/anular`, { motivo: 'prueba' }));
    await falla(api('POST', `/api/gastos/${g.id}/anular`, { motivo: 'otra vez' }), 409);
    const R2 = await ok(api('GET', '/api/finanzas/resumen' + q));
    assert.equal(R2.resultados.gastos_total, R0.gastos_total);
    assert.equal(R2.balance.efectivo, B0.efectivo);
    await falla(api('GET', '/api/finanzas/resumen?desde=2026-02-01&hasta=2026-01-01'), 400);
    assert.ok(Array.isArray(R2.serie) && R2.categorias.length && R2.productos_top.length);
  }

  paso('venta al detal y al mayor: dos unidades de venta, un solo inventario');
  {
    const base1 = { nombre: 'Aceite 1L (prueba mayor)', costo_usd: 0.8, precio_usd: 1.5, factor: 12, unidad_compra: 'caja', unidad_venta: 'botella', stock_inicial: 60 };
    await falla(api('POST', '/api/productos', { ...base1, nombre: 'Descuento total', descuento_mayor: 100 }), 400, /menor a 100/);
    await falla(api('POST', '/api/productos', { ...base1, nombre: 'Mayor sin caja', factor: 1, descuento_mayor: 5 }), 400, /más de 1/);
    // 12 botellas a 1,50 = 18,00 la caja; con 10 % de descuento al mayor = 16,20
    const pm = (await ok(api('POST', '/api/productos', { ...base1, descuento_mayor: 10 }))).id;
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).precio_mayor_usd, 16.2);
    assert.equal((await ok(api('GET', '/api/productos')) ).find((x) => x.id === pm).precio_mayor_usd, 16.2);
    // el descuento sigue al precio: si el precio de venta cambia, la caja cambia con él
    await ok(api('PUT', '/api/productos/' + pm, { precio_usd: 2 }));
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).precio_mayor_usd, 21.6);
    await ok(api('PUT', '/api/productos/' + pm, { precio_usd: 1.5 }));
    const pago = (monto) => [{ medio: 'efectivo', moneda: 'USD', monto }];
    // 2 cajas al mayor = 30 USD y salen 24 botellas del mismo inventario
    const vm = await ok(api('POST', '/api/ventas', { items: [{ producto_id: pm, cantidad: 2, unidad: 'mayor' }], pagos: pago(32.4) }));
    assert.equal(vm.total_usd, 32.4);
    let det = await ok(api('GET', '/api/ventas/' + vm.id));
    assert.equal(det.items[0].cantidad, 24); assert.equal(det.items[0].cant_unidad, 2); assert.equal(det.items[0].unidad, 'mayor');
    assert.equal(Math.round(det.items[0].cantidad * det.items[0].precio_usd * 100) / 100, 32.4);
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).stock, 36);
    // una caja y tres botellas en la misma venta: 16,20 + 4,50
    const vx = await ok(api('POST', '/api/ventas', { items: [{ producto_id: pm, cantidad: 1, unidad: 'mayor' }, { producto_id: pm, cantidad: 3 }], pagos: pago(20.7) }));
    assert.equal(vx.total_usd, 20.7);
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).stock, 21);
    // validaciones
    await falla(api('POST', '/api/ventas', { items: [{ producto_id: pm, cantidad: 1.5, unidad: 'mayor' }], pagos: pago(30) }), 400, /completa/);
    await falla(api('POST', '/api/ventas', { items: [{ producto_id: pm, cantidad: 5, unidad: 'mayor' }], pagos: pago(75) }), 409, /Stock insuficiente/);
    await falla(api('POST', '/api/ventas', { items: [{ producto_id: p2, cantidad: 1, unidad: 'mayor' }], pagos: pago(5) }), 400, /precio al mayor/);
    await falla(api('POST', '/api/ventas', { items: [{ producto_id: pm, cantidad: 1, unidad: 'mayor', precio_usd: 10 }], pagos: pago(10) }, tokCajero), 409); // sin caja abierta antes que el precio
    // la anulación devuelve las botellas, no las cajas
    await ok(api('POST', `/api/ventas/${vm.id}/anular`, { motivo: 'prueba mayor' }));
    await ok(api('POST', `/api/ventas/${vx.id}/anular`, { motivo: 'prueba mayor' }));
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).stock, 60);
    // app de clientes: el catálogo ofrece la caja y el pedido reserva sus botellas
    const cat = await ok(api('GET', '/api/app/catalogo?q=Aceite', null, ct));
    const pc = cat.productos.find((x) => x.id === pm);
    assert.deepEqual(pc.mayor, { precio_usd: 16.2, factor: 12, unidad: 'caja', disponible: 5 });
    assert.equal(pc.precio_mayor_usd, undefined); assert.equal(pc.descuento_mayor, undefined);
    await falla(api('POST', '/api/app/pedidos', { items: [{ producto_id: pm, cantidad: 6, unidad: 'mayor' }] }, ct), 409, /Stock insuficiente/);
    const pe = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: pm, cantidad: 2, unidad: 'mayor' }, { producto_id: pm, cantidad: 4 }] }, ct));
    assert.equal(pe.total_usd, 38.4);
    const ped2 = await ok(api('GET', '/api/app/pedidos/' + pe.id, null, ct));
    assert.deepEqual(ped2.items.map((i) => [i.cantidad, i.unidad || null, i.cant_unidad || null]), [[24, 'mayor', 2], [4, null, null]]);
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).reservado, 28);
    await ok(api('POST', `/api/app/pedidos/${pe.id}/cancelar`, {}, ct));
    assert.equal((await ok(api('GET', '/api/productos/' + pm))).reservado, 0);
    await ok(api('PUT', '/api/productos/' + pm, { activo: 0 }));
  }

  paso('Cashea: inicial en caja, el resto por cobrar a Cashea y liquidación semanal con comisión');
  {
    const pn = (await ok(api('POST', '/api/productos', { nombre: 'Licuadora (prueba Cashea)', costo_usd: 100, precio_usd: 200, stock_inicial: 5 }))).id;
    const cliC = (await ok(api('POST', '/api/clientes', { nombre: 'Clienta Cashea', documento: 'V-20123456', telefono: '04125550001' }))).id;
    const venta = (cant, inicial, ref) => api('POST', '/api/ventas', { cliente_id: cliC, items: [{ producto_id: pn, cantidad: cant }],
      pagos: [{ medio: 'efectivo', moneda: 'USD', monto: inicial }, { medio: 'cashea', ...(ref ? { referencia: ref } : {}) }] });
    await falla(venta(1, 80, 'CSH-1'), 409, /no está activado/);
    await falla(api('PUT', '/api/parametros/cashea', { comision_pct: 100 }), 400, /entre 0 y 100/);
    await ok(api('PUT', '/api/parametros/cashea', { activo: true, comision_pct: 5, inicial_min_pct: 40 }));
    assert.equal((await ok(api('GET', '/api/me'))).cashea, true);
    await falla(venta(1, 60, 'CSH-1'), 400, /inicial de al menos 40/);
    await falla(venta(1, 80), 400, /código u orden/);
    await falla(api('POST', '/api/ventas', { items: [{ producto_id: pn, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 80 }, { medio: 'cashea', referencia: 'X' }] }), 400, /cliente/);
    await falla(venta(1, 200, 'CSH-0'), 400, /ya cubren el total/);
    await falla(api('POST', '/api/ventas', { cliente_id: cliC, items: [{ producto_id: pn, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 80 }, { medio: 'credito' }, { medio: 'cashea', referencia: 'X' }] }), 400, /combinar/);
    // el monto financiado se puede escribir: inicial + Cashea deben sumar el total
    const conMonto = (inicial, financiado, ref) => api('POST', '/api/ventas', { cliente_id: cliC, items: [{ producto_id: pn, cantidad: 1 }],
      pagos: [{ medio: 'efectivo', moneda: 'USD', monto: inicial }, { medio: 'cashea', monto: financiado, referencia: ref }] });
    await falla(conMonto(80, 100, 'CSH-X'), 400, /debe sumar el total/);
    await falla(conMonto(80, 130, 'CSH-X'), 400, /debe sumar el total/);
    const v1 = await ok(conMonto(80, 120, 'CSH-1'));     // 200: 80 de inicial + 120 Cashea
    assert.equal(v1.total_usd, 200); assert.equal(v1.cashea_usd, 120); assert.equal(v1.vuelto_usd, 0);
    const dv = await ok(api('GET', '/api/ventas/' + v1.id));
    assert.equal(dv.cliente_documento, 'V-20123456', 'el ticket muestra la cédula o el RIF del cliente'); assert.ok(dv.tasa_usd_ves > 0, 'la venta informa la tasa con la que se hizo, para el ticket en bolívares');
    const v2 = await ok(venta(1, 100, 'CSH-2'));         // 200: 100 + 100
    assert.equal(v2.cashea_usd, 100);
    assert.equal((await ok(api('GET', '/api/productos/' + pn))).stock, 3);
    let cs = await ok(api('GET', '/api/cashea'));
    assert.equal(cs.pendientes.length, 2); assert.equal(cs.total_pendiente_usd, 220);
    assert.deepEqual(cs.pendientes.map((x) => x.referencia), ['CSH-1', 'CSH-2']);
    // el cobro de la caja solo trae la inicial; lo financiado no cuenta como efectivo
    const turno = await ok(api('GET', '/api/turno'));
    const pm = turno.resumen.por_medio.find((x) => x.medio === 'cashea');
    assert.equal(pm.monto_usd, 220);
    // aparece en el balance como por cobrar a Cashea
    assert.equal((await ok(api('GET', '/api/finanzas/resumen'))).balance.cashea, 220);
    // liquidación: Cashea deposita 114 por los 120 de la primera venta (5 % de comisión)
    let usdB = (await ok(api('GET', '/api/cuentas'))).find((c) => c.tipo !== 'caja' && c.moneda === 'USD');
    if (!usdB) usdB = { id: (await ok(api('POST', '/api/cuentas', { nombre: 'Banco USD Cashea', tipo: 'banco', moneda: 'USD' }))).id };
    const saldo0 = (await ok(api('GET', '/api/cuentas'))).find((c) => c.id === usdB.id).saldo;
    await falla(api('POST', '/api/cashea/liquidar', { ids: [], cuenta_id: usdB.id, monto_recibido: 114 }), 400, /Marca/);
    await falla(api('POST', '/api/cashea/liquidar', { ids: [cs.pendientes[0].id], cuenta_id: usdB.id, monto_recibido: 125 }), 400, /más de lo que financió/);
    await falla(api('POST', '/api/cashea/liquidar', { ids: [cs.pendientes[0].id], cuenta_id: usdB.id, monto_recibido: 114 }, tokCajero), 403);
    const lq = await ok(api('POST', '/api/cashea/liquidar', { ids: [cs.pendientes[0].id], cuenta_id: usdB.id, monto_recibido: 114, referencia: 'DEP-77' }));
    assert.equal(lq.bruto_usd, 120); assert.equal(lq.comision, 6); assert.equal(lq.comision_usd, 6);
    assert.equal((await ok(api('GET', '/api/cuentas'))).find((c) => c.id === usdB.id).saldo, saldo0 + 114, 'la cuenta recibe lo depositado');
    assert.ok((await ok(api('GET', '/api/gastos'))).gastos.some((g) => g.categoria === 'Comisiones Cashea' && g.monto_usd === 6));
    await falla(api('POST', '/api/cashea/liquidar', { ids: [cs.pendientes[0].id], cuenta_id: usdB.id, monto_recibido: 114 }), 409, /ya fue liquidada/);
    cs = await ok(api('GET', '/api/cashea'));
    assert.equal(cs.pendientes.length, 1); assert.equal(cs.total_pendiente_usd, 100);
    assert.equal(cs.liquidaciones[0].ventas, 1); assert.equal(cs.liquidaciones[0].recibido, 114);
    assert.equal((await ok(api('GET', '/api/finanzas/resumen'))).balance.cashea, 100);
    // anulaciones: la liquidada no se puede anular; la pendiente sí
    await falla(api('POST', `/api/ventas/${v1.id}/anular`, { motivo: 'prueba' }), 409, /ya liquidó/);
    await ok(api('POST', `/api/ventas/${v2.id}/anular`, { motivo: 'prueba Cashea' }));
    assert.equal((await ok(api('GET', '/api/cashea'))).pendientes.length, 0);
    assert.equal((await ok(api('GET', '/api/productos/' + pn))).stock, 4);
    // Cashea no sirve para cobrar un crédito ni para pagar compras
    await ok(api('PUT', '/api/parametros/cashea', { activo: false }));
    await falla(venta(1, 80, 'CSH-3'), 409, /no está activado/);
  }

  paso('historial de cuentas por cobrar: facturas abiertas, pagadas y anuladas con sus cobros');
  {
    const h = await ok(api('GET', '/api/cxc/historial'));
    assert.ok(h.filas.length >= 1 && h.totales.n === h.filas.length);
    const f1 = h.filas.find((x) => x.cliente === 'Doña Marta');
    assert.ok(f1 && f1.documento !== undefined && f1.cobrado_usd >= 0 && 'ultimo_cobro' in f1 && 'cobros' in f1);
    assert.equal(h.totales.saldo_usd, Math.round(h.filas.filter((x) => x.estado !== 'anulada').reduce((t, x) => t + x.saldo_usd, 0) * 100) / 100);
    const det = await ok(api('GET', '/api/cxc/' + f1.id));
    assert.ok(Array.isArray(det.cobros) && det.cliente === 'Doña Marta' && det.cobrado_usd === f1.cobrado_usd);
    await falla(api('GET', '/api/cxc/999999'), 404);
    const ab = await ok(api('GET', '/api/cxc/historial?estado=abiertas'));
    assert.ok(ab.filas.every((x) => ['pendiente', 'abonada'].includes(x.estado)));
    const fut = await ok(api('GET', '/api/cxc/historial?desde=2999-01-01'));
    assert.equal(fut.filas.length, 0);
    assert.equal((await ok(api('GET', '/api/cxc/historial?q=Marta'))).filas.every((x) => x.cliente.includes('Marta')), true);
  }

  paso('cierre de caja con diferencia exige comentario; cierre del día');
  const t = await ok(api('GET', '/api/turno'));
  await falla(api('POST', '/api/jornada/cerrar', {}), 409, /cajas abiertas/);
  await falla(api('POST', '/api/turnos/cerrar', { contado: { USD: 0, VES: 0, EUR: 0 } }), 400, /comentario/);
  const cierre = await ok(api('POST', '/api/turnos/cerrar', { contado: { USD: t.resumen.esperado.USD, VES: t.resumen.esperado.VES, EUR: 0 } }));
  assert.equal(cierre.diferencia_usd, 0);
  const cer = await ok(api('POST', '/api/jornada/cerrar', {}));
  assert.ok(cer.resumen.ventas.n >= 3);
  await falla(api('POST', '/api/ventas', { items: [{ producto_id: p1, cantidad: 1 }], pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 5 }] }), 409);

  paso('reportes y auditoría');
  const dash = await ok(api('GET', '/api/reportes/dashboard'));
  assert.ok(dash.ventas_hoy.n >= 3 && dash.inventario_usd > 0);
  const util = await ok(api('GET', '/api/reportes/utilidad'));
  assert.ok(util.filas.length);
  assert.ok((await ok(api('GET', '/api/auditoria?accion=venta'))).length);
  assert.ok((await ok(api('GET', '/api/reportes/cumplimiento-conteos'))).por_clase);

  paso('importar CSV de productos');
  const imp = await ok(api('POST', '/api/productos/importar', { csv: fs.readFileSync(path.join(__dirname, '..', 'plantilla_carga_productos.csv'), 'utf8') }));
  assert.equal(imp.errores.length, 0, JSON.stringify(imp));
  assert.equal(imp.creados + imp.actualizados, 3); assert.ok(imp.actualizados >= 2, 'los productos que ya existen por código se actualizan');

  paso('inventario inicial desde Excel: plantilla, validación fila por fila y carga');
  {
    const IE = require('../inv_excel'), { crearXlsx } = require('../xlsx');
    // la plantilla se descarga con las categorías y los proveedores de la empresa
    const rp = await fetch(base + '/api/inventario/plantilla', { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(rp.status, 200); assert.match(rp.headers.get('content-type'), /spreadsheetml/); assert.match(rp.headers.get('content-disposition'), /inventario_inicial_.*\.xlsx/);
    const plant = Buffer.from(await rp.arrayBuffer());
    assert.equal(plant.subarray(0, 2).toString(), 'PK');
    const lec = IE.filasDeExcel(plant); assert.equal(lec.hoja, 'Inventario'); assert.equal(lec.filas.length, 2, 'trae dos filas de ejemplo'); assert.equal(lec.ignoradas.length, 0);
    assert.equal((await fetch(base + '/api/inventario/plantilla', { headers: { Authorization: 'Bearer ' + tokCajero } })).status, 403);
    await falla(api('POST', '/api/inventario/inicial/validar', { xlsx: plant.toString('base64') }, tokCajero), 403);
    // las filas de ejemplo no cuentan: una plantilla sin llenar no carga nada
    const vacia = await ok(api('POST', '/api/inventario/inicial/validar', { xlsx: plant.toString('base64') }));
    assert.equal(vacia.omitidas, 2); assert.equal(vacia.nuevos + vacia.actualizados, 0);

    const enc = IE.COLUMNAS.map((c) => c.h), fila = (o) => IE.COLUMNAS.map((c) => (o[c.k] === undefined ? '' : o[c.k]));
    const libro = (filas) => crearXlsx({ hojas: [{ nombre: 'Inventario', filas: [enc, ...filas.map(fila)] }] }).toString('base64');
    const prod1 = await ok(api('GET', '/api/productos/' + p1)), prod2 = await ok(api('GET', '/api/productos/' + p2));
    const antes = (await ok(api('GET', '/api/productos'))).length;
    const stock1 = prod1.stock;
    const arch = libro([
      { nombre: 'Galletas María 200 g', codigo_barra: '7599000000011', codigo_interno: 'XL-001', categoria: 'Galletas importadas', costo_usd: 0.5, precio_venta_usd: 0.9, stock_actual: 40, proveedor_principal: 'Proveedor Excel' }, // fila 2: crea y carga existencia
      { nombre: 'Chocolate barra 30 g', costo_usd: 0.4, margen_utilidad: 50, stock_actual: 10, precio_fijo: 'no' },                                                                                    // fila 3: precio por margen
      { nombre: 'Jugo de naranja 1 L', costo_usd: '1,25', precio_venta_usd: '1,80', stock_actual: '12,5' },                                                                                       // fila 4: comas decimales
      { nombre: 'Sin costo', precio_venta_usd: 1, stock_actual: 5 },                                                                                                                              // fila 5: error
      { nombre: 'Existencia negativa', costo_usd: 1, precio_venta_usd: 2, stock_actual: -3 },                                                                                                     // fila 6: error
      { nombre: 'Costo con letras', costo_usd: 'abc', precio_venta_usd: 2, stock_actual: 1 },                                                                                                     // fila 7: error
      { nombre: 'Repetido', codigo_interno: 'XL-001', costo_usd: 1, precio_venta_usd: 2, stock_actual: 1 },                                                                                       // fila 8: código interno repetido en el archivo
      { nombre: 'Códigos cruzados', codigo_interno: prod1.codigo, codigo_barra: prod2.codigos[0], costo_usd: 1, precio_venta_usd: 2, stock_actual: 1 },                                           // fila 9: interno de un producto y barras de otro
      { nombre: prod1.nombre, codigo_interno: prod1.codigo, costo_usd: prod1.costo_usd, precio_venta_usd: prod1.precio_usd, stock_actual: 99 },                                                   // fila 10: ya tiene movimientos
      { nombre: '(Ejemplo) Se ignora', costo_usd: 1, precio_venta_usd: 2, stock_actual: 1 }                                                                                                       // fila 11: ejemplo
    ]);
    const val = await ok(api('POST', '/api/inventario/inicial/validar', { xlsx: arch }));
    assert.equal(val.nuevos, 3); assert.equal(val.actualizados, 1); assert.equal(val.omitidas, 1);
    assert.deepEqual(val.errores.map((x) => x.fila), [5, 6, 7, 8, 9]);
    assert.match(val.errores[0].mensaje, /costo/i); assert.match(val.errores[1].mensaje, /negativo/); assert.match(val.errores[2].mensaje, /número/); assert.match(val.errores[3].mensaje, /fila 2/); assert.match(val.errores[4].mensaje, /distintos/);
    assert.ok(val.avisos.some((x) => x.fila === 10 && /ya tiene movimientos/.test(x.mensaje)), 'avisa que la existencia de un producto con movimientos no se toca');
    assert.equal(val.unidades, 62.5); assert.equal(val.valor_usd, 39.63);
    assert.deepEqual(val.categorias_nuevas, ['Galletas importadas']); assert.deepEqual(val.proveedores_nuevos, ['Proveedor Excel']);
    assert.equal((await ok(api('GET', '/api/productos'))).length, antes, 'validar no escribe nada');

    // con errores no se carga, salvo que se pida cargar solo las filas correctas
    await falla(api('POST', '/api/inventario/inicial/importar', { xlsx: arch }), 409, /5 fila/);
    assert.equal((await ok(api('GET', '/api/productos'))).length, antes);
    const imp2 = await ok(api('POST', '/api/inventario/inicial/importar', { xlsx: arch, omitir_errores: true }));
    assert.equal(imp2.creados, 3); assert.equal(imp2.actualizados, 1); assert.equal(imp2.existencia_cargada, 62.5); assert.equal(imp2.valor_usd, 39.63); assert.equal(imp2.omitidas, 5); assert.deepEqual(imp2.errores, []);
    const gall = (await ok(api('GET', '/api/productos?q=Galletas%20Mar'))).find((x) => x.nombre === 'Galletas María 200 g');
    assert.equal(gall.stock, 40); assert.equal(gall.categoria, 'Galletas importadas'); assert.equal(gall.codigo, 'XL-001'); assert.equal(gall.costo_usd, 0.5);
    const kar = await ok(api('GET', `/api/productos/${gall.id}/kardex`));
    assert.equal(kar.movimientos[0].tipo, 'inventario_inicial'); assert.equal(kar.movimientos[0].cantidad, 40); assert.equal(kar.valor_usd, 20);
    const choc = (await ok(api('GET', '/api/productos?q=Chocolate%20barra'))).find((x) => x.nombre === 'Chocolate barra 30 g');
    assert.equal(choc.precio_usd, 0.8, 'sin precio se calcula con el margen sobre el precio (0,40 con 50 % = 0,80)'); assert.equal(choc.stock, 10);
    assert.equal((await ok(api('GET', '/api/productos?q=Jugo%20de%20naranja'))).find((x) => x.nombre === 'Jugo de naranja 1 L').stock, 12.5);
    assert.equal((await ok(api('GET', '/api/productos/' + p1))).stock, stock1, 'la existencia de un producto con movimientos no cambia');
    assert.ok((await ok(api('GET', '/api/categorias'))).some((c) => c.nombre === 'Galletas importadas'));
    assert.ok((await ok(api('GET', '/api/proveedores'))).some((c) => c.nombre === 'Proveedor Excel'));
    assert.ok((await ok(api('GET', '/api/auditoria?accion=excel'))).some((x) => x.accion === 'inventario_inicial_excel'), 'la carga queda en la bitácora');

    // cargarlo otra vez no duplica nada: los productos ya existen y ya tienen su existencia
    const otra = await ok(api('POST', '/api/inventario/inicial/importar', { xlsx: arch, omitir_errores: true }));
    assert.equal(otra.creados, 0); assert.equal(otra.actualizados, 4); assert.equal(otra.existencia_cargada, 0);
    assert.equal((await ok(api('GET', '/api/productos'))).length, antes + 3);
    assert.equal((await ok(api('GET', `/api/productos/${gall.id}`))).stock, 40);
    // archivos que no son Excel o no son la plantilla
    await falla(api('POST', '/api/inventario/inicial/validar', { xlsx: Buffer.from('esto no es un excel '.repeat(20)).toString('base64') }), 400, /Excel/);
    await falla(api('POST', '/api/inventario/inicial/validar', { xlsx: crearXlsx({ hojas: [{ nombre: 'Otra', filas: [['a', 'b'], [1, 2]] }] }).toString('base64') }), 400, /Inventario/);
    await falla(api('POST', '/api/inventario/inicial/validar', {}), 400, /archivo/);
  }

  paso('reconocimiento por imagen: sin credencial, con servicio simulado y límite mensual');
  const Rec = require('../reconocer');
  const imgOk = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await falla(api('POST', '/api/reconocer', { imagen: imgOk }), 501, /ANTHROPIC_API_KEY/);
  const visto = [];
  const mock = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', (c) => (b += c));
    rq.on('end', () => {
      visto.push({ h: rq.headers, b: JSON.parse(b) });
      rs.writeHead(200, { 'content-type': 'application/json' });
      rs.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'Claro: {"descripcion":"bolsa de harina amarilla","candidatos":[{"id":' + p1 + ',"confianza":0.93},{"id":99999,"confianza":0.9},{"id":' + p2 + ',"confianza":0.4}]}' }],
        usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'clave-de-prueba'; process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`; Rec.reiniciarCliente();
  const rec = await ok(api('POST', '/api/reconocer', { imagen: imgOk }));
  assert.equal(rec.productos.length, 2, 'el id inventado se descarta');
  assert.equal(rec.productos[0].id, p1); assert.equal(rec.productos[0].confianza, 0.93); assert.equal(rec.descripcion, 'bolsa de harina amarilla');
  assert.equal(visto[0].h['x-api-key'], 'clave-de-prueba');
  assert.equal(visto[0].b.model, 'claude-opus-5-5');
  assert.equal(visto[0].b.messages[0].content[0].type, 'image'); assert.equal(visto[0].b.messages[0].content[0].source.media_type, 'image/png');
  assert.match(JSON.stringify(visto[0].b.system), /CATÁLOGO[^"]*Harina de maiz precocida/, 'el catálogo viaja en el prompt');
  await falla(api('POST', '/api/reconocer', { imagen: 'data:text/plain;base64,AAAA' }), 400, /JPEG/);
  assert.ok((await ok(api('GET', '/api/me'))).reconocimiento.usados_mes >= 1);
  P.r("UPDATE empresas SET max_reconocimientos=1 WHERE slug='principal'"); P.invalidar('principal');
  await falla(api('POST', '/api/reconocer', { imagen: imgOk }), 402, /límite/);
  P.r("UPDATE empresas SET max_reconocimientos=100000 WHERE slug='principal'"); P.invalidar('principal');
  mock.close();

  paso('plataforma: crear abasto, aislamiento entre empresas y acceso por código');
  const tp = (await ok(api('POST', '/api/plataforma/login', { usuario: 'plataforma', clave: 'plataforma-prueba-1' }, ''))).token;
  await falla(api('GET', '/api/plataforma/empresas', null, ''), 401);
  await falla(api('POST', '/api/plataforma/empresas', { slug: 'api', nombre: 'x' }, tp), 400);
  const nueva = await ok(api('POST', '/api/plataforma/empresas', { slug: 'abasto-sur', nombre: 'Abasto del Sur', dias_prueba: 30, max_usuarios: 2, max_productos: 3 }, tp));
  assert.ok(nueva.admin_clave);
  await falla(api('POST', '/api/plataforma/empresas', { slug: 'abasto-sur', nombre: 'dup' }, tp), 409);
  assert.equal((await ok(api('GET', '/api/app/config', null, ''))).empresa.nombre, 'Mi Abasto', 'sin código, la app de clientes usa la empresa predeterminada (plan propio)');
  P.r("UPDATE empresas SET plan='basico' WHERE slug='principal'"); P.invalidar('principal');
  await falla(api('POST', '/api/login', { usuario: 'admin', clave: 'clave-prueba-1' }, ''), 400, /código/);
  await falla(api('GET', '/api/app/config', null, ''), 400, /código/);
  P.r("UPDATE empresas SET plan='propio' WHERE slug='principal'"); P.invalidar('principal');
  assert.equal((await ok(api('GET', '/api/plataforma/info', null, ''))).multi, true);
  assert.equal((await ok(api('GET', '/api/health', null, ''))).ok, true, 'la verificación de salud funciona con varias empresas');
  const tokSur = (await ok(api('POST', '/api/login', { empresa: 'abasto-sur', usuario: 'admin', clave: nueva.admin_clave }, ''))).token;
  assert.ok(tokSur.startsWith('abasto-sur.'));
  await falla(api('POST', '/api/login', { empresa: 'abasto-sur', usuario: 'admin', clave: 'clave-prueba-1' }, ''), 401);
  await falla(api('POST', '/api/login', { empresa: 'no-existe', usuario: 'admin', clave: 'x' }, ''), 404);
  assert.equal((await ok(api('GET', '/api/productos', null, tokSur))).length, 0, 'la empresa nueva está vacía');
  assert.ok((await ok(api('GET', '/api/productos'))).length >= 3);
  await falla(api('GET', '/api/productos', null, 'abasto-sur.' + token.slice(token.indexOf('.') + 1)), 401); // token de otra empresa con prefijo cambiado
  const me = await ok(api('GET', '/api/me', null, tokSur));
  assert.equal(me.empresa_codigo, 'abasto-sur'); assert.equal(me.licencia.estado, 'activa');
  const regSur = await ok(api('POST', '/api/app/registro', { nombre: 'Ana', telefono: '04125550101', pin: '1234' }, '', { 'x-empresa': 'abasto-sur' }));
  assert.ok(regSur.token.startsWith('abasto-sur.'), 'el mismo teléfono puede ser cliente en otro abasto');
  await falla(api('GET', '/api/app/perfil', null, regSur.token.replace('abasto-sur.', 'principal.')), 401);

  paso('límites del plan (usuarios y productos)');
  await ok(api('POST', '/api/usuarios', { nombre: 'Caja', usuario: 'caja', clave: '123456', rol: 'cajero' }, tokSur));
  await falla(api('POST', '/api/usuarios', { nombre: 'Otro', usuario: 'otro', clave: '123456', rol: 'cajero' }, tokSur), 402, /hasta 2 usuarios/);
  for (let i = 0; i < 3; i++) await ok(api('POST', '/api/productos', { nombre: 'Prod ' + i, precio_usd: 1 }, tokSur));
  await falla(api('POST', '/api/productos', { nombre: 'Prod 4' }, tokSur), 402, /hasta 3 productos/);

  paso('licencias: gracia, solo lectura, renovación con pago, suspensión');
  const emp = (await ok(api('GET', '/api/plataforma/empresas', null, tp))).find((e) => e.slug === 'abasto-sur');
  const fijarVence = (d) => { P.r('UPDATE empresas SET licencia_vence=? WHERE id=?', d, emp.id); P.invalidar('abasto-sur'); };
  fijarVence(D.sumarDias(-2));
  assert.equal((await ok(api('GET', '/api/me', null, tokSur))).licencia.estado, 'gracia');
  await ok(api('POST', '/api/categorias', { nombre: 'En gracia' }, tokSur));
  fijarVence(D.sumarDias(-10));
  assert.equal((await ok(api('GET', '/api/me', null, tokSur))).licencia.estado, 'vencida');
  await ok(api('GET', '/api/productos', null, tokSur));
  await falla(api('POST', '/api/categorias', { nombre: 'Vencida' }, tokSur), 402, /solo lectura/);
  assert.equal((await ok(api('GET', '/api/app/config', null, '', { 'x-empresa': 'abasto-sur' }))).cerrado, true);
  const pagoLic = await ok(api('POST', `/api/plataforma/empresas/${emp.id}/pago`, { monto_usd: 20, meses: 1, metodo: 'pago_movil', referencia: '777' }, tp));
  assert.ok(pagoLic.licencia_vence > D.hoy());
  await ok(api('POST', '/api/categorias', { nombre: 'Renovada' }, tokSur));
  assert.equal((await ok(api('GET', '/api/app/config', null, '', { 'x-empresa': 'abasto-sur' }))).cerrado, false);
  await ok(api('PUT', `/api/plataforma/empresas/${emp.id}`, { estado: 'suspendida' }, tp));
  await falla(api('GET', '/api/productos', null, tokSur), 402, /suspendida/);
  await falla(api('POST', '/api/login', { empresa: 'abasto-sur', usuario: 'admin', clave: nueva.admin_clave }, ''), 402);
  await ok(api('PUT', `/api/plataforma/empresas/${emp.id}`, { estado: 'activa' }, tp));
  await ok(api('GET', '/api/productos', null, tokSur));
  const res = await ok(api('GET', '/api/plataforma/resumen', null, tp));
  assert.equal(res.empresas, 2); assert.equal(res.mrr_usd, 20); assert.ok(res.cobrado_mes_usd >= 20);
  await ok(api('POST', `/api/plataforma/empresas/${emp.id}/clave-admin`, { clave: 'nueva-clave-9' }, tp));
  await falla(api('GET', '/api/productos', null, tokSur), 401); // sesiones cerradas al restablecer la clave
  await ok(api('POST', '/api/login', { empresa: 'abasto-sur', usuario: 'admin', clave: 'nueva-clave-9' }, ''));

  paso('código QR: generador propio contra una matriz verificada con una implementación de referencia');
  {
    global.Abasto = global.Abasto || {};
    const qr = require('../public/qr.js');
    const huella = (r) => require('node:crypto').createHash('sha256').update(r.m.map((f) => f.map((x) => (x ? '1' : '0')).join('')).join('')).digest('hex').slice(0, 16);
    const r = qr.matriz('https://abasto.onrender.com/tienda/mi-abasto/');
    assert.equal(r.version, 4); assert.equal(r.n, 33); assert.equal(r.mascara, 2);
    assert.equal(huella(r), 'ac9691cd0a332006', 'la matriz debe coincidir con la de la implementación de referencia');
    assert.equal(qr.matriz('https://a.io/t/x').version, 2);
    assert.equal(qr.matriz('x'.repeat(213)).version, 10);
    assert.throws(() => qr.matriz('x'.repeat(214)), /demasiado largo/);
    assert.match(qr.svg('https://a.io/t/x'), /^<svg[^>]*viewBox="0 0 33 33"/);
    delete global.Abasto;
  }

  paso('parámetros de impresión del ticket: medidas de la impresora térmica de 58 mm');
  {
    const p0 = (await ok(api('GET', '/api/parametros'))).impresion;
    assert.deepEqual(p0, { ancho_mm: 58, margen_lateral_mm: 5, margen_superior_mm: 2, margen_inferior_mm: 8, letra_px: 10, logo_alto_mm: 20 });
    assert.equal((await ok(api('GET', '/api/me'))).impresion.ancho_mm, 58);
    await falla(api('PUT', '/api/parametros/impresion', { letra_px: 30 }), 400, /tamaño de letra/);
    await falla(api('PUT', '/api/parametros/impresion', { ancho_mm: 20 }), 400, /ancho del papel/);
    await falla(api('PUT', '/api/parametros/impresion', { ancho_mm: 58, margen_lateral_mm: 15 }), 400, /menos de 30 mm/);
    await falla(api('PUT', '/api/parametros/impresion', { letra_px: 11 }, tokCajero), 403);
    const n = await ok(api('PUT', '/api/parametros/impresion', { letra_px: 11.5, margen_lateral_mm: 4 }));
    assert.equal(n.letra_px, 11.5); assert.equal(n.margen_lateral_mm, 4);
    assert.equal((await ok(api('GET', '/api/me'))).impresion.letra_px, 11.5);
    await ok(api('PUT', '/api/parametros/impresion', p0));
  }

  paso('tasa del BCV: lectura de la página y registro automático sin pisar lo escrito a mano');
  {
    const BCV = require('../bcv');
    const manana = D.sumarDias(1);
    const html = (usd, eur, fv) => `<div id="euro"><strong> ${eur} </strong></div><div id="dolar"><strong> ${usd} </strong></div><span class="date-display-single" content="${fv}T00:00:00-04:00">Martes</span>`;
    const t = BCV.leerPagina(html('36,58990000', '42,10250000', manana));
    assert.deepEqual([t.usd, t.eur, t.fechaValor], [36.5899, 42.1025, manana]);
    assert.equal(BCV.fechaValorDe('<span class="date-display-single">Lunes, 17 Noviembre 2026</span>'), '2026-11-17');
    assert.throws(() => BCV.leerPagina('<html>otra cosa</html>'), /formato/);
    assert.throws(() => BCV.leerPagina(html('36,5', '900,0', manana)), /coherentes/);
    const r = D.conEmpresa('abasto-sur', () => {
      D.run("INSERT OR REPLACE INTO tasas_cambio(fecha,tasa_usd_ves,tasa_eur_usd,fuente,usuario,registrada_en) VALUES(?,?,?,?,?,?)", D.hoy(), 36.5, 1.15, 'BCV', 'admin', D.ahora());
      const a1 = BCV.aplicar(t);                                  // tasa de mañana: se registra con su fecha
      const a2 = BCV.aplicar(t);                                  // igual: no hace nada
      const a3 = BCV.aplicar({ ...t, usd: 36.9, eur: 42.5 });     // cambió: se corrige la automática
      const fila = D.get('SELECT * FROM tasas_cambio WHERE fecha=?', manana);
      const a4 = BCV.aplicar({ ...t, fechaValor: D.hoy() });      // hoy fue escrita a mano: se respeta
      const hoyFila = D.get('SELECT * FROM tasas_cambio WHERE fecha=?', D.hoy());
      const a5 = BCV.aplicar({ ...t, usd: 80, eur: 92, fechaValor: D.sumarDias(2) }); // salto de más de 30%: se descarta
      const a6 = BCV.aplicar({ ...t, fechaValor: D.hoy() }, { forzar: true, usuario: 'admin' }); // el botón sí corrige
      return { a1, a2, a3, a4, a5, a6, fila, hoyFila, final: D.get('SELECT * FROM tasas_cambio WHERE fecha=?', D.hoy()), nlog: D.get("SELECT COUNT(*) n FROM tasas_log WHERE fuente LIKE 'BCV (%'").n };
    });
    assert.equal(r.a1.aplicada, true); assert.equal(r.a1.fecha, manana);
    assert.equal(r.a2.aplicada, false); assert.equal(r.a2.sinCambio, true);
    assert.equal(r.a3.aplicada, true); assert.equal(r.a3.actualizada, true);
    assert.equal(r.fila.tasa_usd_ves, 36.9); assert.equal(r.fila.fuente, 'BCV (automática)');
    assert.ok(Math.abs(r.fila.tasa_eur_usd - 42.5 / 36.9) < 1e-6);
    assert.equal(r.a4.aplicada, false); assert.match(r.a4.motivo, /a mano/);
    assert.equal(r.hoyFila.tasa_usd_ves, 36.5);
    assert.equal(r.a5.aplicada, false); assert.match(r.a5.motivo, /descart/);
    assert.equal(r.a6.aplicada, true); assert.equal(r.final.tasa_usd_ves, 36.5899); assert.equal(r.final.fuente, 'BCV (consulta manual)');
    assert.equal(r.nlog, 3, 'cada cambio queda en el historial de tasas');
    // la empresa puede apagar la actualización automática
    const par = await ok(api('GET', '/api/parametros'));
    assert.equal(par.tasas.auto_bcv, true);
    await ok(api('PUT', '/api/parametros/tasas', { auto_bcv: false }));
    assert.equal((await ok(api('GET', '/api/tasas'))).auto_bcv, false);
    await ok(api('PUT', '/api/parametros/tasas', { auto_bcv: true }));
    // abrir el día sin escribir tasa usa la registrada hoy
    const jr = await ok(api('GET', '/api/jornada'));
    if (!jr.jornada && jr.tasa_hoy) { await ok(api('POST', '/api/jornada/abrir', {})); assert.equal((await ok(api('GET', '/api/jornada'))).jornada.tasa_usd_ves, jr.tasa_hoy.tasa_usd_ves); }
  }

  paso('respaldo automático y descarga de la base');
  const { respaldarTodo } = require('../respaldo');
  assert.equal(respaldarTodo(), 3, 'principal, abasto-sur y plataforma');
  assert.equal(respaldarTodo(), 0, 'ya existe el respaldo de hoy');
  const rb = await fetch(base + '/api/respaldo', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(rb.status, 200);
  assert.equal(Buffer.from(await rb.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await fetch(base + '/api/respaldo', { headers: { Authorization: 'Bearer ' + tokCajero } })).status, 403);

  console.log(`\nOK: ${n} bloques de prueba pasaron.`);
  servidor.close(); process.exit(0);
})().catch((e) => { console.error('\nFALLÓ:', e); process.exit(1); });
