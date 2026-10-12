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
  await falla(api('POST', '/api/usuarios', { nombre: 'x', usuario: 'x', clave: '123456', rol: 'admin' }, tokCajero), 403);

  paso('sin día abierto no se opera');
  await falla(api('POST', '/api/compras', { proveedor_id: 1, moneda: 'USD', items: [] }), 400);
  await falla(api('POST', '/api/jornada/abrir', { tasa_usd_ves: 0, tasa_eur_usd: 1.1 }), 400);
  await ok(api('POST', '/api/jornada/abrir', { tasa_usd_ves: 40, tasa_eur_usd: 1.1, fuente: 'BCV' }));
  await falla(api('POST', '/api/jornada/abrir', { tasa_usd_ves: 40, tasa_eur_usd: 1.1 }), 409);
  await falla(api('POST', '/api/jornada/tasas', { tasa_usd_ves: 879, tasa_eur_usd: 960, motivo: 'x' }), 400, /no es coherente/); // Bs por euro escritos donde van USD por euro
  await ok(api('POST', '/api/jornada/tasas', { tasa_usd_ves: 40, tasa_eur_ves: 44, motivo: 'euro en bolívares' }));
  assert.equal(Math.round((await ok(api('GET', '/api/jornada'))).jornada.tasa_eur_usd * 1000) / 1000, 1.1, 'EUR/USD derivado de Bs por euro');

  paso('maestros: proveedor, productos con barras');
  const prov = (await ok(api('POST', '/api/proveedores', { nombre: 'Distribuidora Sur', dias_credito: 15 }))).id;
  const cats = await ok(api('GET', '/api/categorias'));
  const p1 = (await ok(api('POST', '/api/productos', { nombre: 'Harina de maíz 1kg', categoria_id: cats[0].id, codigos: ['7590000000011'], costo_usd: 0.95, precio_usd: 1.3, stock_min: 12, stock_max: 60, proveedor_id: prov, factor: 20, unidad_compra: 'caja' }))).id;
  const p2 = (await ok(api('POST', '/api/productos', { nombre: 'Arroz 1kg', categoria_id: cats[1].id, codigos: ['7590000000028'], costo_usd: 0.9, precio_fijo: 0, margen: 40, stock_min: 5, stock_max: 30, proveedor_id: prov }))).id;
  await falla(api('POST', '/api/productos', { nombre: 'Dup', codigos: ['7590000000011'] }), 409, /ya pertenece/);
  assert.equal((await ok(api('GET', '/api/productos/' + p2))).precio_usd, 1.26, 'precio por margen');

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
  await falla(api('POST', `/api/reparto/ordenes/${oid}/entregar`, {}, tokJuan), 409, /Primero marca/);
  await ok(api('POST', `/api/reparto/ordenes/${oid}/tomar`, {}, tokJuan));
  await falla(api('POST', `/api/reparto/ordenes/${oid}/tomar`, {}, tokPedro), 409, /Otro repartidor/);
  assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokPedro))).disponibles.length, 0, 'ya no aparece para los demás');
  assert.equal((await ok(api('GET', '/api/reparto/mis', null, tokJuan))).asignados.length, 1);
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
  await falla(api('POST', `/api/ordenes/${oid}/asignar`, { repartidor_id: 1 }), 409, /ya salió/);
  assert.equal((await ok(api('GET', '/api/repartidores'))).length, 2);
  await falla(api('POST', `/api/ordenes/${oid}/preparar/escanear`, { codigo: barraP1 }), 409, /ya terminó/);
  det = await ok(api('GET', '/api/app/pedidos/' + ped.id, null, ct));
  assert.equal(det.estado, 'entregado');
  await falla(api('POST', `/api/ordenes/${val.orden_id}/estado`, { estado: 'enviada' }), 409);

  paso('pago rechazado libera la reserva');
  const ped2 = await ok(api('POST', '/api/app/pedidos', { items: [{ producto_id: p1, cantidad: 3 }], entrega: 'retiro' }, ct));
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
