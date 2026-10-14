'use strict';
// Lógica de negocio. Las funciones NO abren transacción: el llamador usa D.tx().
const D = require('./db');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const err = (status, msg) => { throw new HttpError(status, msg); };
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const MONEDAS = ['USD', 'VES', 'EUR'];
const MEDIOS = ['efectivo', 'pago_movil', 'transferencia', 'punto', 'credito'];

function audit(usuario, accion, entidad, ref, detalle) {
  D.run('INSERT INTO auditoria(fecha,usuario,accion,entidad,ref,detalle) VALUES(?,?,?,?,?,?)',
    D.ahora(), usuario || null, accion, entidad || null, ref == null ? null : String(ref),
    detalle == null ? null : (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)));
}

// ---------- jornada y tasas ----------
function jornadaAbierta() { return D.get("SELECT * FROM jornadas WHERE estado='abierta' ORDER BY id DESC LIMIT 1") || null; }
function requireJornada() {
  const j = jornadaAbierta();
  if (!j) err(409, 'No hay día operativo abierto. Abre el día con las tasas del día.');
  return j;
}
function ultimaTasa() {
  return D.get('SELECT tasa_usd_ves, tasa_eur_usd FROM jornadas ORDER BY id DESC LIMIT 1') || null;
}
function tasaDe(moneda, jor) {
  if (moneda === 'USD') return 1;
  if (moneda === 'VES') return jor.tasa_usd_ves;
  if (moneda === 'EUR') return jor.tasa_eur_usd;
  err(400, 'Moneda no válida: ' + moneda);
}
function aUSD(monto, moneda, jor) {
  if (moneda === 'USD') return r4(monto);
  if (moneda === 'VES') return r4(monto / jor.tasa_usd_ves);
  if (moneda === 'EUR') return r4(monto * jor.tasa_eur_usd);
  err(400, 'Moneda no válida: ' + moneda);
}
function deUSD(usd, moneda, jor) {
  if (moneda === 'USD') return r2(usd);
  if (moneda === 'VES') return r2(usd * jor.tasa_usd_ves);
  if (moneda === 'EUR') return r2(usd / jor.tasa_eur_usd);
  err(400, 'Moneda no válida: ' + moneda);
}

// ---------- inventario ----------
function stockDe(id) {
  return D.get('SELECT COALESCE(SUM(cantidad),0) AS s FROM inventario_movimientos WHERE producto_id=?', id).s;
}
function reservadoDe(id, excluirPedido) {
  return D.get(`SELECT COALESCE(SUM(cantidad),0) AS s FROM reservas
                WHERE producto_id=? AND estado='activa' AND expira>? AND pedido_id<>?`,
    id, D.ahora(), excluirPedido || 0).s;
}
function disponible(id, excluirPedido) { return stockDe(id) - reservadoDe(id, excluirPedido); }
// Único lugar donde se registra un movimiento de inventario. Calcula el costo con el que se valora (promedio móvil, ver D.kardexPaso)
// y deja en el movimiento la existencia, el valor y el costo promedio resultantes. El costo del producto sigue al promedio.
function movimiento(producto_id, tipo, cantidad, costo, motivo, ref_tipo, ref_id, usuario, jornada_id) {
  const p = D.get('SELECT costo_usd FROM productos WHERE id=?', producto_id);
  if (!p) err(404, 'Producto inexistente');
  const ult = D.get('SELECT saldo_cant, saldo_valor, costo_prom FROM inventario_movimientos WHERE producto_id=? ORDER BY id DESC LIMIT 1', producto_id);
  const est = ult && ult.saldo_cant != null ? { sq: ult.saldo_cant, sv: ult.saldo_valor, prom: ult.costo_prom }
    : { sq: stockDe(producto_id), sv: stockDe(producto_id) * p.costo_usd, prom: p.costo_usd || 0 };
  const r = D.kardexPaso(est, tipo, cantidad, costo);
  const id = D.insert(`INSERT INTO inventario_movimientos(producto_id,fecha,tipo,cantidad,costo_usd,motivo,ref_tipo,ref_id,usuario,jornada_id,saldo_cant,saldo_valor,costo_prom)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, producto_id, D.ahora(), tipo, cantidad, r.costo, motivo || null,
    ref_tipo || null, ref_id || null, usuario || null, jornada_id || null, r.sq, r.sv, r.prom);
  if (D.CAMBIAN_PROMEDIO.has(tipo) && Math.abs(r.prom - (p.costo_usd || 0)) > 1e-9) D.run('UPDATE productos SET costo_usd=? WHERE id=?', r.prom, producto_id);
  return { id, costo: r.costo, costo_prom: r.prom, saldo_cant: r.sq, saldo_valor: r.sv };
}
const mov = (...a) => movimiento(...a).id;
function precioPorMargen(costo, margen) { return r2(costo * (1 + margen / 100)); }

// ---------- cuentas ----------
function saldoCuenta(id) {
  const c = D.get('SELECT saldo_inicial FROM cuentas WHERE id=?', id);
  const m = D.get('SELECT COALESCE(SUM(monto),0) AS s FROM cuenta_movimientos WHERE cuenta_id=?', id).s;
  return r2((c ? c.saldo_inicial : 0) + m);
}
function cuentaMov(cuenta_id, monto, monto_usd, tipo, o = {}) {
  return D.insert(`INSERT INTO cuenta_movimientos(cuenta_id,fecha,monto,monto_usd,tipo,referencia,ref_tipo,ref_id,usuario,jornada_id,turno_id,nota)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, cuenta_id, D.ahora(), r2(monto), r2(monto_usd), tipo,
    o.referencia || null, o.ref_tipo || null, o.ref_id || null, o.usuario || null, o.jornada_id || null, o.turno_id || null, o.nota || null);
}
function cuentaEfectivo(moneda) {
  const c = D.get("SELECT * FROM cuentas WHERE tipo='caja' AND moneda=? AND activo=1 ORDER BY id LIMIT 1", moneda);
  if (!c) err(409, `No hay una caja de efectivo activa en ${moneda}. Créala en Parámetros > Bancos y cajas.`);
  return c;
}
function resolverCuentaPago(medio, moneda, cuenta_id) {
  if (medio === 'efectivo') return cuentaEfectivo(moneda);
  let c;
  if (cuenta_id) c = D.get('SELECT * FROM cuentas WHERE id=?', cuenta_id);
  else c = D.get("SELECT * FROM cuentas WHERE tipo<>'caja' AND moneda=? AND activo=1 ORDER BY id LIMIT 1", moneda);
  if (!c || !c.activo) err(409, `Selecciona un banco o cuenta activa en ${moneda} para el pago ${medio.replace('_', ' ')}.`);
  if (c.moneda !== moneda) err(400, `La cuenta "${c.nombre}" es ${c.moneda} y el pago es en ${moneda}.`);
  return c;
}

// ---------- ventas ----------
function normalizarPagos(pagos, jor) {
  const out = [];
  for (const p of pagos || []) {
    const medio = p.medio;
    if (!MEDIOS.includes(medio)) err(400, 'Medio de pago no válido: ' + medio);
    const moneda = medio === 'credito' ? 'USD' : p.moneda;
    if (!MONEDAS.includes(moneda)) err(400, 'Moneda de pago no válida');
    const monto = Number(p.monto);
    if (medio !== 'credito' && !(monto > 0)) err(400, 'Todos los pagos deben tener monto mayor a cero');
    if (['pago_movil', 'transferencia', 'punto'].includes(medio) && !String(p.referencia || '').trim())
      err(400, `El pago ${medio.replace('_', ' ')} requiere número de referencia`);
    out.push({
      medio, moneda, monto, referencia: p.referencia || null, cuenta_id: p.cuenta_id || null,
      tasa: tasaDe(moneda, jor), monto_usd: medio === 'credito' ? 0 : aUSD(monto, moneda, jor)
    });
  }
  return out;
}

// Vuelto entregado: por defecto todo en efectivo USD; el cajero puede repartirlo entre monedas y medios (efectivo, pago móvil, transferencia).
function normalizarVuelto(lineas, exceso, jor) {
  if (!Array.isArray(lineas) || !lineas.length)
    return [{ medio: 'efectivo', moneda: 'USD', monto: exceso, tasa: 1, monto_usd: exceso, referencia: null, cuenta_id: null }];
  const out = [];
  for (const l of lineas) {
    if (!['efectivo', 'pago_movil', 'transferencia'].includes(l.medio)) err(400, 'El vuelto solo puede darse en efectivo, pago móvil o transferencia');
    if (!MONEDAS.includes(l.moneda)) err(400, 'Moneda del vuelto no válida');
    const monto = Number(l.monto);
    if (!(monto > 0)) err(400, 'Cada línea de vuelto debe tener monto mayor a cero');
    if (l.medio !== 'efectivo' && !String(l.referencia || '').trim()) err(400, `El vuelto por ${l.medio.replace('_', ' ')} requiere número de referencia`);
    out.push({ medio: l.medio, moneda: l.moneda, monto, tasa: tasaDe(l.moneda, jor), monto_usd: aUSD(monto, l.moneda, jor), referencia: l.referencia || null, cuenta_id: l.cuenta_id || null });
  }
  const suma = r2(out.reduce((a, x) => a + x.monto_usd, 0));
  if (Math.abs(suma - exceso) > 0.03)
    err(400, `El vuelto registrado (${suma} USD) no coincide con el que corresponde (${exceso} USD)`);
  out[out.length - 1].monto_usd = r2(out[out.length - 1].monto_usd + (exceso - suma)); // absorbe el redondeo en Bs
  return out;
}

function crearVenta(o) {
  const jor = requireJornada();
  const { usuario, perms, cliente_id, items, descuento_pct = 0, origen = 'pos', pedido_id = null, turno, forzar = false } = o;
  if (!turno) err(409, 'No hay caja abierta. Abre tu caja para vender.');
  if (!items || !items.length) err(400, 'La venta no tiene productos');
  const op = D.param('operacion');
  const pct = Number(descuento_pct) || 0;
  if (pct < 0 || pct > 100) err(400, 'Descuento no válido');
  if (pct > op.descuento_max_pct && !perms.has('descuento.alto'))
    err(403, `Descuentos mayores a ${op.descuento_max_pct}% requieren autorización de un supervisor`);

  // consolidar cantidades por producto para validar stock
  const lineas = [];
  const porProd = new Map();
  for (const it of items) {
    const p = D.get('SELECT * FROM productos WHERE id=?', it.producto_id);
    if (!p) err(400, 'Producto inexistente');
    if (!p.activo) err(400, `"${p.nombre}" está inactivo y no se puede vender`);
    const cant = Number(it.cantidad);
    if (!(cant > 0)) err(400, `Cantidad inválida para "${p.nombre}"`);
    let precio = p.precio_usd;
    if (it.precio_usd != null && Math.abs(Number(it.precio_usd) - p.precio_usd) > 0.0001) {
      if (!perms.has('precio.cambiar')) err(403, 'No tienes permiso para cambiar precios');
      precio = Number(it.precio_usd);
      audit(usuario, 'cambio_precio_venta', 'producto', p.id, { original: p.precio_usd, aplicado: precio });
    }
    if (!(precio > 0)) err(400, `"${p.nombre}" no tiene precio de venta activo`);
    lineas.push({ p, cant, precio });
    porProd.set(p.id, (porProd.get(p.id) || 0) + cant);
  }
  if (!op.stock_negativo) {
    for (const [id, cant] of porProd) {
      const disp = disponible(id, pedido_id);
      if (cant > disp + 1e-9) {
        const p = D.get('SELECT nombre FROM productos WHERE id=?', id);
        err(409, `Stock insuficiente de "${p.nombre}": disponible ${r2(disp)}, solicitado ${cant}`);
      }
    }
  }

  let subtotal = 0;
  for (const l of lineas) { l.bruto = r4(l.cant * l.precio); subtotal += l.bruto; l.desc = r4(l.bruto * pct / 100); }
  subtotal = r2(subtotal);
  const descuento = r2(lineas.reduce((a, l) => a + l.desc, 0));
  const total = r2(subtotal - descuento);

  // pagos
  const pagos = normalizarPagos(o.pagos, jor);
  const noCredito = pagos.filter((p) => p.medio !== 'credito');
  const pagado = r4(noCredito.reduce((a, p) => a + p.monto_usd, 0));
  const hayCredito = pagos.some((p) => p.medio === 'credito');
  let credito = 0, vuelto = 0;
  if (hayCredito) {
    credito = r2(total - pagado);
    if (credito <= 0.005) err(400, 'Los pagos ya cubren el total: quita la línea de crédito');
  } else {
    if (pagado < total - 0.01) err(400, `Pago incompleto: falta ${r2(total - pagado)} USD`);
    const exceso = r2(pagado - total);
    if (exceso > 0.01) {
      const efectivoUSD = noCredito.filter((p) => p.medio === 'efectivo').reduce((a, p) => a + p.monto_usd, 0);
      if (exceso > efectivoUSD + 0.01) err(400, 'El pago excede el total y el excedente no es devolvible en efectivo');
      vuelto = exceso;
    }
  }
  const vueltoLineas = vuelto > 0 ? normalizarVuelto(o.vuelto, vuelto, jor) : [];
  let cliente = null;
  if (cliente_id) {
    cliente = D.get('SELECT * FROM clientes WHERE id=?', cliente_id);
    if (!cliente) err(400, 'Cliente inexistente');
  }
  if (origen === 'pos' && op.venta_requiere_cliente) {
    if (!cliente) err(400, 'Identifica al cliente (cédula o RIF) para registrar la venta');
    if (!String(cliente.documento || '').trim()) err(400, `Falta la cédula o RIF de "${cliente.nombre}": complétala para registrar la venta`);
  }
  if (hayCredito) {
    if (!cliente) err(400, 'La venta a crédito requiere un cliente identificado');
    if (cliente.estado !== 'activo') err(409, 'Cliente suspendido: no puede comprar a crédito');
    if (!cliente.credito_habilitado) err(409, 'El cliente no tiene crédito habilitado');
    const deuda = D.get("SELECT COALESCE(SUM(saldo_usd),0) AS s FROM cxc WHERE cliente_id=? AND estado<>'pagada' AND estado<>'anulada'", cliente.id).s;
    const vencida = D.get("SELECT COUNT(*) AS n FROM cxc WHERE cliente_id=? AND saldo_usd>0.005 AND estado IN ('pendiente','abonada') AND vence<?", cliente.id, D.hoy()).n;
    const puedeForzar = forzar && perms.has('credito.autorizar');
    if (deuda + credito > cliente.limite_usd + 0.005 && !puedeForzar)
      err(409, `Excede el límite de crédito (${r2(cliente.limite_usd)} USD; deuda actual ${r2(deuda)} USD). Requiere autorización de supervisor.`);
    if (vencida > 0 && !puedeForzar)
      err(409, 'El cliente tiene deuda vencida. Requiere autorización de supervisor.');
  }

  const numero = D.siguiente('venta', 'V');
  const ventaId = D.insert(`INSERT INTO ventas(numero,cliente_id,turno_id,usuario,origen,pedido_id,estado,subtotal_usd,descuento_usd,total_usd,vuelto_usd,fecha,jornada_id)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, numero, cliente_id || null, turno.id, usuario, origen, pedido_id,
    'completada', subtotal, descuento, total, vuelto, D.ahora(), jor.id);
  for (const l of lineas) {
    // el consumo se valora al costo promedio vigente en este momento; el mismo costo queda en el detalle de la venta
    const m = movimiento(l.p.id, 'venta', -l.cant, l.p.costo_usd, 'Venta ' + numero, 'venta', ventaId, usuario, jor.id);
    D.insert('INSERT INTO venta_detalles(venta_id,producto_id,cantidad,precio_usd,costo_usd,descuento_usd) VALUES(?,?,?,?,?,?)',
      ventaId, l.p.id, l.cant, l.precio, m.costo, l.desc);
  }
  for (const p of pagos) {
    if (p.medio === 'credito') continue;
    const cuenta = resolverCuentaPago(p.medio, p.moneda, p.cuenta_id);
    D.insert(`INSERT INTO pagos(tipo,venta_id,fecha,medio,moneda,monto,tasa,monto_usd,referencia,cuenta_id,turno_id,usuario,jornada_id)
              VALUES('venta',?,?,?,?,?,?,?,?,?,?,?,?)`, ventaId, D.ahora(), p.medio, p.moneda, p.monto, p.tasa, p.monto_usd,
      p.referencia, cuenta.id, turno.id, usuario, jor.id);
    cuentaMov(cuenta.id, p.monto, p.monto_usd, 'venta', { referencia: p.referencia, ref_tipo: 'venta', ref_id: ventaId, usuario, jornada_id: jor.id, turno_id: turno.id });
  }
  for (const vl of vueltoLineas) {
    const cuenta = resolverCuentaPago(vl.medio, vl.moneda, vl.cuenta_id);
    D.insert(`INSERT INTO pagos(tipo,venta_id,fecha,medio,moneda,monto,tasa,monto_usd,referencia,cuenta_id,turno_id,usuario,jornada_id)
              VALUES('vuelto',?,?,?,?,?,?,?,?,?,?,?,?)`, ventaId, D.ahora(), vl.medio, vl.moneda, vl.monto, vl.tasa, vl.monto_usd,
      vl.referencia, cuenta.id, turno.id, usuario, jor.id);
    cuentaMov(cuenta.id, -vl.monto, -vl.monto_usd, 'vuelto', { referencia: vl.referencia, ref_tipo: 'venta', ref_id: ventaId, usuario, jornada_id: jor.id, turno_id: turno.id, nota: 'Vuelto entregado' });
  }
  if (credito > 0) {
    const vence = D.sumarDias(cliente.dias_credito || 7);
    D.insert('INSERT INTO cxc(cliente_id,venta_id,total_usd,saldo_usd,vence,estado,creado) VALUES(?,?,?,?,?,?,?)',
      cliente.id, ventaId, credito, credito, vence, 'pendiente', D.ahora());
    D.insert(`INSERT INTO pagos(tipo,venta_id,fecha,medio,moneda,monto,tasa,monto_usd,turno_id,usuario,jornada_id)
              VALUES('venta',?,?,?,?,?,?,?,?,?,?)`, ventaId, D.ahora(), 'credito', 'USD', credito, 1, credito, turno.id, usuario, jor.id);
  }
  audit(usuario, 'venta_creada', 'venta', ventaId, { numero, total, origen, credito });
  return { id: ventaId, numero, total_usd: total, vuelto_usd: vuelto, vuelto: vueltoLineas.map((x) => ({ medio: x.medio, moneda: x.moneda, monto: x.monto, referencia: x.referencia })), credito_usd: credito };
}

function anularVenta(id, motivo, usuario) {
  const v = D.get('SELECT * FROM ventas WHERE id=?', id);
  if (!v) err(404, 'Venta no encontrada');
  if (v.estado !== 'completada') err(409, 'La venta ya está anulada');
  if (!String(motivo || '').trim()) err(400, 'Indica el motivo de la anulación');
  const cxc = D.get('SELECT * FROM cxc WHERE venta_id=?', v.id);
  if (cxc && cxc.saldo_usd < cxc.total_usd - 0.005) err(409, 'La venta tiene abonos a crédito: reversa primero los cobros');
  const jor = jornadaAbierta();
  const turnoOrig = D.get("SELECT id FROM caja_turnos WHERE id=? AND estado='abierta'", v.turno_id);
  for (const d of D.all('SELECT * FROM venta_detalles WHERE venta_id=?', v.id))
    mov(d.producto_id, 'anulacion_venta', d.cantidad, d.costo_usd, `Anulación ${v.numero}: ${motivo}`, 'venta', v.id, usuario, jor && jor.id);
  for (const m of D.all("SELECT * FROM cuenta_movimientos WHERE ref_tipo='venta' AND ref_id=? AND tipo IN ('venta','vuelto')", v.id))
    cuentaMov(m.cuenta_id, -m.monto, -m.monto_usd, 'reverso_venta', { ref_tipo: 'venta', ref_id: v.id, usuario, jornada_id: jor && jor.id, turno_id: turnoOrig ? turnoOrig.id : null, nota: 'Anulación ' + v.numero });
  D.run('UPDATE pagos SET anulado=1 WHERE venta_id=?', v.id);
  if (cxc) D.run("UPDATE cxc SET estado='anulada', saldo_usd=0 WHERE id=?", cxc.id);
  D.run("UPDATE ventas SET estado='anulada', motivo_anulacion=?, anulada_por=?, anulada_en=? WHERE id=?", motivo, usuario, D.ahora(), v.id);
  audit(usuario, 'venta_anulada', 'venta', v.id, { numero: v.numero, motivo });
}

// ---------- cobros / pagos ----------
function turnoAbiertoDe(usuario_id) {
  return D.get("SELECT * FROM caja_turnos WHERE usuario_id=? AND estado='abierta'", usuario_id) || null;
}
function cobrarCxc(cxcId, pagosIn, usuario, turno) {
  const jor = requireJornada();
  const c = D.get('SELECT * FROM cxc WHERE id=?', cxcId);
  if (!c || c.estado === 'anulada') err(404, 'Cuenta por cobrar no encontrada');
  if (c.saldo_usd <= 0.005) err(409, 'La cuenta ya está pagada');
  const pagos = normalizarPagos(pagosIn, jor).filter((p) => p.medio !== 'credito');
  if (!pagos.length) err(400, 'Indica al menos un pago');
  const total = r4(pagos.reduce((a, p) => a + p.monto_usd, 0));
  if (total > c.saldo_usd + 0.01) err(400, `El cobro (${r2(total)}) excede el saldo (${r2(c.saldo_usd)})`);
  for (const p of pagos) {
    const cuenta = resolverCuentaPago(p.medio, p.moneda, p.cuenta_id);
    D.insert(`INSERT INTO pagos(tipo,cxc_id,venta_id,fecha,medio,moneda,monto,tasa,monto_usd,referencia,cuenta_id,turno_id,usuario,jornada_id)
              VALUES('cobro',?,?,?,?,?,?,?,?,?,?,?,?,?)`, c.id, c.venta_id, D.ahora(), p.medio, p.moneda, p.monto, p.tasa, p.monto_usd,
      p.referencia, cuenta.id, turno ? turno.id : null, usuario, jor.id);
    cuentaMov(cuenta.id, p.monto, p.monto_usd, 'cobro_cxc', { referencia: p.referencia, ref_tipo: 'cxc', ref_id: c.id, usuario, jornada_id: jor.id, turno_id: turno ? turno.id : null });
  }
  const saldo = Math.max(0, r2(c.saldo_usd - total));
  D.run('UPDATE cxc SET saldo_usd=?, estado=? WHERE id=?', saldo, saldo <= 0.005 ? 'pagada' : 'abonada', c.id);
  audit(usuario, 'cobro_cxc', 'cxc', c.id, { total_usd: r2(total), saldo });
  return { saldo_usd: saldo };
}

function pagarCxp(cxpId, o, usuario) {
  const jor = requireJornada();
  const c = D.get('SELECT * FROM cxp WHERE id=?', cxpId);
  if (!c || c.estado === 'anulada') err(404, 'Cuenta por pagar no encontrada');
  if (c.saldo_usd <= 0.005) err(409, 'La cuenta ya está pagada');
  const moneda = o.moneda || 'USD';
  const monto = Number(o.monto);
  if (!(monto > 0)) err(400, 'Monto inválido');
  const usd = aUSD(monto, moneda, jor);
  if (usd > c.saldo_usd + 0.01) err(400, `El pago (${r2(usd)}) excede el saldo (${r2(c.saldo_usd)})`);
  const cuenta = o.cuenta_id ? D.get('SELECT * FROM cuentas WHERE id=? AND activo=1', o.cuenta_id) : cuentaEfectivo(moneda);
  if (!cuenta) err(400, 'Cuenta de pago inválida');
  if (cuenta.moneda !== moneda) err(400, `La cuenta es ${cuenta.moneda} y el pago ${moneda}`);
  D.insert('INSERT INTO cxp_pagos(cxp_id,fecha,moneda,monto,tasa,monto_usd,cuenta_id,referencia,usuario) VALUES(?,?,?,?,?,?,?,?,?)',
    c.id, D.ahora(), moneda, monto, tasaDe(moneda, jor), usd, cuenta.id, o.referencia || null, usuario);
  cuentaMov(cuenta.id, -monto, -usd, 'pago_proveedor', { referencia: o.referencia, ref_tipo: 'cxp', ref_id: c.id, usuario, jornada_id: jor.id });
  const saldo = Math.max(0, r2(c.saldo_usd - usd));
  D.run('UPDATE cxp SET saldo_usd=?, estado=? WHERE id=?', saldo, saldo <= 0.005 ? 'pagada' : 'abonada', c.id);
  audit(usuario, 'pago_cxp', 'cxp', c.id, { usd: r2(usd), saldo });
  return { saldo_usd: saldo };
}

// ---------- compras ----------
function guardarCompra(o, usuario) {
  const prov = D.get('SELECT * FROM proveedores WHERE id=?', o.proveedor_id);
  if (!prov) err(400, 'Toda compra debe tener proveedor');
  if (!prov.activo) err(409, 'El proveedor está inactivo');
  if (!MONEDAS.includes(o.moneda)) err(400, 'Moneda no válida');
  if (!o.items || !o.items.length) err(400, 'La compra no tiene productos');
  const id = D.insert(`INSERT INTO compras(numero,proveedor_id,moneda,condicion,estado,cuenta_id,medio,referencia,dias_credito,nota,fecha,usuario)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, D.siguiente('compra', 'C'), prov.id, o.moneda, o.condicion === 'credito' ? 'credito' : 'contado',
    'borrador', o.cuenta_id || null, o.medio || null, o.referencia || null, Number(o.dias_credito ?? prov.dias_credito) || 0, o.nota || null, D.ahora(), usuario);
  let total = 0;
  for (const it of o.items) {
    const p = D.get('SELECT * FROM productos WHERE id=?', it.producto_id);
    if (!p) err(400, 'Producto inexistente en la compra');
    const cant = Number(it.cantidad), costo = Number(it.costo_unit);
    if (!(cant > 0) || !(costo >= 0)) err(400, `Cantidad o costo inválido para "${p.nombre}"`);
    D.insert('INSERT INTO compra_detalles(compra_id,producto_id,cantidad,costo_unit,unidades,cantidad_pedida,costo_pedido) VALUES(?,?,?,?,?,?,?)',
      id, p.id, cant, costo, cant * p.factor, cant, costo);
    total += cant * costo;
  }
  D.run('UPDATE compras SET total_moneda=?, total_pedido=? WHERE id=?', r2(total), r2(total), id);
  audit(usuario, 'compra_borrador', 'compra', id, { total });
  return id;
}

// La orden pasa a "enviada": se pidió al proveedor. Queda registrado quién, cuándo y por qué medio, y las cantidades pedidas ya no cambian.
function enviarCompra(id, o, usuario) {
  const c = D.get('SELECT * FROM compras WHERE id=?', id);
  if (!c) err(404, 'Compra no encontrada');
  if (c.estado !== 'borrador') err(409, c.estado === 'enviada' ? 'La orden ya fue enviada al proveedor' : 'Solo se puede enviar una orden que esté en borrador');
  const medio = ['whatsapp', 'correo', 'telefono', 'en_persona', 'otro'].includes(o.medio_envio) ? o.medio_envio : 'otro';
  D.run("UPDATE compras SET estado='enviada', enviada_en=?, enviada_por=?, envio_medio=?, envio_nota=? WHERE id=?", D.ahora(), usuario, medio, String(o.nota || '').trim() || null, c.id);
  audit(usuario, 'compra_enviada', 'compra', c.id, { numero: c.numero, medio });
}

// Al recibir, lo que llega no tiene que ser exactamente lo pedido: se ajusta la cantidad (y el costo de la factura) de cada línea.
// La orden conserva lo pedido en cantidad_pedida y costo_pedido; cantidad y costo_unit quedan con lo recibido.
function ajustarRecepcion(c, items) {
  const dets = D.all('SELECT d.*, p.nombre, p.factor FROM compra_detalles d JOIN productos p ON p.id=d.producto_id WHERE d.compra_id=?', c.id);
  const dadas = new Map();
  for (const it of items) {
    const k = Number(it.detalle_id);
    if (!dets.some((d) => d.id === k)) err(400, 'Una de las líneas no pertenece a esta orden');
    dadas.set(k, it);
  }
  let total = 0, hayRecibido = false, diferencias = 0;
  for (const d of dets) {
    const a = dadas.get(d.id) || {};
    const cant = a.cantidad != null && a.cantidad !== '' ? Number(a.cantidad) : d.cantidad;
    const costo = a.costo_unit != null && a.costo_unit !== '' ? Number(a.costo_unit) : d.costo_unit;
    if (!(cant >= 0) || !(costo >= 0)) err(400, `Cantidad o costo inválido para "${d.nombre}"`);
    if (cant > 0) hayRecibido = true;
    if (Math.abs(cant - (d.cantidad_pedida ?? d.cantidad)) > 1e-9 || Math.abs(costo - (d.costo_pedido ?? d.costo_unit)) > 1e-9) diferencias++;
    D.run('UPDATE compra_detalles SET cantidad=?, unidades=?, costo_unit=? WHERE id=?', cant, cant * d.factor, costo, d.id);
    total += cant * costo;
  }
  if (!hayRecibido) err(400, 'Indica al menos un producto recibido. Si no llegó nada, anula la orden.');
  D.run('UPDATE compras SET total_moneda=? WHERE id=?', r2(total), c.id);
  return diferencias;
}

function recibirCompra(id, o, usuario) {
  let c = D.get('SELECT * FROM compras WHERE id=?', id);
  if (!c) err(404, 'Compra no encontrada');
  if (!['borrador', 'enviada'].includes(c.estado)) err(409, 'Solo se pueden recibir órdenes de compra pendientes');
  const jor = requireJornada();
  const diferencias = Array.isArray(o.items) && o.items.length ? ajustarRecepcion(c, o.items) : 0;
  c = D.get('SELECT * FROM compras WHERE id=?', id); // con el total de lo realmente recibido
  const condicion = o.condicion || c.condicion;
  const tasa = tasaDe(c.moneda, jor);
  const totalUSD = aUSD(c.total_moneda, c.moneda, jor);
  const op = D.param('operacion');
  for (const d of D.all('SELECT * FROM compra_detalles WHERE compra_id=?', c.id)) {
    if (!(d.unidades > 0)) continue; // lo que no llegó no entra al inventario
    const p = D.get('SELECT * FROM productos WHERE id=?', d.producto_id);
    const costoUnidadMoneda = d.costo_unit / p.factor;
    const costoUSD = aUSD(costoUnidadMoneda, c.moneda, jor);
    const { costo_prom: nuevoCosto } = movimiento(p.id, 'compra', d.unidades, costoUSD, 'Compra ' + c.numero, 'compra', c.id, usuario, jor.id);
    D.run('UPDATE compra_detalles SET costo_usd_unidad=? WHERE id=?', costoUSD, d.id);
    let precio = p.precio_usd;
    if (!p.precio_fijo) precio = precioPorMargen(nuevoCosto, p.margen);
    if (Math.abs(nuevoCosto - p.costo_usd) > 0.00001 || precio !== p.precio_usd) {
      D.run('UPDATE productos SET costo_usd=?, precio_usd=? WHERE id=?', nuevoCosto, precio, p.id);
      audit(usuario, 'cambio_costo', 'producto', p.id, { costo: [p.costo_usd, nuevoCosto], precio: [p.precio_usd, precio], origen: c.numero });
    }
  }
  if (condicion === 'contado') {
    const medio = o.medio || c.medio || 'efectivo';
    if (!MEDIOS.includes(medio) || medio === 'credito') err(400, 'Medio de pago no válido');
    if (medio !== 'efectivo' && !String(o.referencia || c.referencia || '').trim()) err(400, 'El pago bancario requiere referencia');
    const cuenta = resolverCuentaPago(medio, c.moneda, o.cuenta_id || c.cuenta_id);
    cuentaMov(cuenta.id, -c.total_moneda, -totalUSD, 'compra', { referencia: o.referencia || c.referencia, ref_tipo: 'compra', ref_id: c.id, usuario, jornada_id: jor.id });
    D.run('UPDATE compras SET cuenta_id=?, medio=?, referencia=? WHERE id=?', cuenta.id, medio, o.referencia || c.referencia || null, c.id);
  } else {
    const dias = Number(o.dias_credito ?? c.dias_credito) || 0;
    D.insert('INSERT INTO cxp(proveedor_id,compra_id,total_usd,saldo_usd,vence,estado,creado) VALUES(?,?,?,?,?,?,?)',
      c.proveedor_id, c.id, totalUSD, totalUSD, D.sumarDias(dias), 'pendiente', D.ahora());
  }
  D.run("UPDATE compras SET estado='recibida', condicion=?, tasa=?, total_usd=?, recibida_en=?, jornada_id=?, recibida_por=?, factura=?, factura_fecha=?, recepcion_nota=?, con_diferencias=? WHERE id=?",
    condicion, tasa, totalUSD, D.ahora(), jor.id, usuario, String(o.factura || '').trim() || null, String(o.factura_fecha || '').trim() || null, String(o.recepcion_nota || '').trim() || null, diferencias ? 1 : 0, c.id);
  audit(usuario, 'compra_recibida', 'compra', c.id, { numero: c.numero, total_usd: totalUSD, diferencias, total_pedido: c.total_pedido });
  void op;
}

function anularCompra(id, motivo, usuario) {
  const c = D.get('SELECT * FROM compras WHERE id=?', id);
  if (!c) err(404, 'Compra no encontrada');
  if (c.estado === 'anulada') err(409, 'La compra ya está anulada');
  if (!String(motivo || '').trim()) err(400, 'Indica el motivo');
  if (c.estado === 'recibida') {
    const cxp = D.get('SELECT * FROM cxp WHERE compra_id=?', c.id);
    if (cxp && cxp.saldo_usd < cxp.total_usd - 0.005) err(409, 'La cuenta por pagar tiene abonos: no se puede anular');
    const jor = jornadaAbierta();
    for (const d of D.all('SELECT * FROM compra_detalles WHERE compra_id=?', c.id)) {
      if (!(d.unidades > 0)) continue; // línea que no llegó: nunca entró al inventario
      if (stockDe(d.producto_id) < d.unidades - 1e-9) {
        const p = D.get('SELECT nombre FROM productos WHERE id=?', d.producto_id);
        err(409, `No se puede anular: ya se vendió parte de "${p.nombre}"`);
      }
      mov(d.producto_id, 'anulacion_compra', -d.unidades, d.costo_usd_unidad, `Anulación ${c.numero}: ${motivo}`, 'compra', c.id, usuario, jor && jor.id);
    }
    for (const m of D.all("SELECT * FROM cuenta_movimientos WHERE ref_tipo='compra' AND ref_id=? AND tipo='compra'", c.id))
      cuentaMov(m.cuenta_id, -m.monto, -m.monto_usd, 'reverso_compra', { ref_tipo: 'compra', ref_id: c.id, usuario, jornada_id: jor && jor.id, nota: 'Anulación ' + c.numero });
    if (cxp) D.run("UPDATE cxp SET estado='anulada', saldo_usd=0 WHERE id=?", cxp.id);
  }
  D.run("UPDATE compras SET estado='anulada', motivo_anulacion=? WHERE id=?", motivo, c.id);
  audit(usuario, 'compra_anulada', 'compra', c.id, { numero: c.numero, motivo });
}

// ---------- Sugerencias de compra inteligentes ----------
// Para cada producto se compara lo que hay contra lo que se va a vender mientras llega el pedido:
//   ventas/día   = mezcla de los últimos 7 (50 %), 30 (30 %) y 90 días (20 %); con poco historial se usa un piso de 7 días para no inflar un día atípico
//   seguridad    = z × variación diaria de las ventas × √plazo, sin pasar de lo que se vende en el plazo   (z = 1,96 / 1,65 / 1,28 para clases A / B / C: 97,5 / 95 / 90 % de servicio)
//   punto pedido = ventas/día × plazo de entrega + seguridad        (nunca menos que el stock mínimo definido)
//   objetivo     = ventas/día × (plazo + ciclo de compra) + seguridad (nunca menos que el stock máximo definido, ni más de N días de venta)
//   posición     = existencia − reservado por la app + pedidos en borrador
//   se sugiere comprar (objetivo − posición), redondeado a cajas, cuando la posición está en o bajo el punto de pedido.
const Z_SERVICIO = { A: 1.96, B: 1.65, C: 1.28 };
const f1 = (n) => Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 });
function analisisCompras() {
  const op = D.param('operacion');
  const hoy = D.hoy();
  const dif = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
  const f7 = D.sumarDias(-7), f30 = D.sumarDias(-30), f90 = D.sumarDias(-90);
  const ventas = new Map(), diarias = new Map(), primera = new Map(), stocks = new Map(), reservas = new Map(), pendientes = new Map();
  for (const r of D.all(`SELECT producto_id, SUM(CASE WHEN substr(fecha,1,10)>? THEN -cantidad ELSE 0 END) AS u7, SUM(CASE WHEN substr(fecha,1,10)>? THEN -cantidad ELSE 0 END) AS u30, SUM(-cantidad) AS u90
      FROM inventario_movimientos WHERE tipo IN ('venta','anulacion_venta') AND substr(fecha,1,10)>? GROUP BY producto_id`, f7, f30, f90)) ventas.set(r.producto_id, r);
  for (const r of D.all(`SELECT producto_id, substr(fecha,1,10) AS dia, SUM(-cantidad) AS u FROM inventario_movimientos WHERE tipo IN ('venta','anulacion_venta') AND substr(fecha,1,10)>? GROUP BY producto_id, dia`, f30)) {
    if (!diarias.has(r.producto_id)) diarias.set(r.producto_id, []);
    diarias.get(r.producto_id).push(r.u);
  }
  for (const r of D.all("SELECT producto_id, MIN(substr(fecha,1,10)) AS f FROM inventario_movimientos WHERE tipo='venta' GROUP BY producto_id")) primera.set(r.producto_id, r.f);
  for (const r of D.all('SELECT producto_id, SUM(cantidad) AS s FROM inventario_movimientos GROUP BY producto_id')) stocks.set(r.producto_id, r.s);
  for (const r of D.all("SELECT producto_id, SUM(cantidad) AS s FROM reservas WHERE estado='activa' AND expira>? GROUP BY producto_id", D.ahora())) reservas.set(r.producto_id, r.s);
  for (const r of D.all("SELECT d.producto_id, SUM(d.unidades) AS s FROM compra_detalles d JOIN compras c ON c.id=d.compra_id WHERE c.estado IN ('borrador','enviada') GROUP BY d.producto_id")) pendientes.set(r.producto_id, r.s);
  const clase = new Map(clasificarABC().productos.map((p) => [p.id, p.clase]));
  const provs = new Map(D.all('SELECT id, nombre, plazo_entrega FROM proveedores').map((p) => [p.id, p]));
  const filas = [];
  let sinProblema = 0;
  for (const p of D.all('SELECT * FROM productos WHERE activo=1')) {
    const stock = stocks.get(p.id) || 0, reservado = reservas.get(p.id) || 0, pendiente = pendientes.get(p.id) || 0;
    const v = ventas.get(p.id) || { u7: 0, u30: 0, u90: 0 };
    const hist = primera.has(p.id) ? dif(hoy, primera.get(p.id)) + 1 : 0;
    const den = (W) => Math.max(Math.min(W, hist), Math.min(W, 7));
    const r7 = Math.max(0, v.u7) / 7, r30 = Math.max(0, v.u30) / den(30), r90 = Math.max(0, v.u90) / den(90);
    const rate = 0.5 * r7 + 0.3 * r30 + 0.2 * r90;
    const tendencia = hist >= 14 && r30 > 0 ? (r7 - r30) / r30 : null;
    // variación diaria (incluye los días sin ventas)
    const n30 = den(30), dias = diarias.get(p.id) || [], media = Math.max(0, v.u30) / n30;
    const varianza = (dias.reduce((a, u) => a + (u - media) ** 2, 0) + Math.max(0, n30 - dias.length) * media ** 2) / n30;
    const sigma = Math.sqrt(varianza);
    const prov = provs.get(p.proveedor_id) || null;
    const plazo = prov && prov.plazo_entrega > 0 ? prov.plazo_entrega : 3;
    const cl = clase.get(p.id) || 'C';
    const demandaPlazo = rate * plazo;
    const seguridad = rate > 0 ? Math.min(Z_SERVICIO[cl] * sigma * Math.sqrt(plazo), demandaPlazo) : 0;
    const puntoPedido = Math.max(p.stock_min, Math.ceil(demandaPlazo + seguridad));
    let objDem = rate * (plazo + op.compra_ciclo_dias) + seguridad;
    if (rate > 0) objDem = Math.min(objDem, Math.max(rate * op.compra_cobertura_max_dias, p.stock_min));
    const objetivo = Math.max(p.stock_max || 0, Math.ceil(objDem), puntoPedido);
    const posicion = stock - reservado + pendiente;
    const cobertura = rate > 0 ? stock / rate : null;
    const necesita = (p.stock_min > 0 || rate > 0) && posicion <= puntoPedido + 1e-9 && (rate > 0 || p.stock_min > 0);
    let nivel = 'ok';
    if (rate > 0 && stock <= 0) nivel = 'agotado';
    else if (necesita && rate > 0 && cobertura < plazo) nivel = 'critico';
    else if (necesita) nivel = 'reponer';
    else if (rate > 0 && cobertura < plazo + op.compra_ciclo_dias) nivel = 'planificar';
    else if (rate === 0 && stock > 0 && hist >= 30 && v.u90 <= 0) nivel = 'sin_movimiento';
    else if (rate > 0 && cobertura > op.compra_cobertura_max_dias * 2 && stock > (p.stock_max || 0)) nivel = 'sobrestock';
    if (nivel === 'ok') { sinProblema++; continue; }
    const faltante = Math.max(0, Math.ceil(objetivo - posicion));
    const factor = p.factor || 1;
    const cajas = ['sobrestock', 'sin_movimiento'].includes(nivel) ? 0 : Math.ceil(faltante / factor);
    const unidades = cajas * factor;
    const capital = Math.max(0, stock) * p.costo_usd;
    const vende = rate > 0 ? `Vende ${f1(rate)}/día (${f1(r7)} en los últimos 7 días, ${f1(r30)} en 30)` : 'Sin ventas recientes';
    const tend = tendencia != null && Math.abs(tendencia) >= 0.25 ? ` · ventas en ${tendencia > 0 ? 'alza' : 'baja'} ${Math.round(tendencia * 100)} %` : '';
    const motivo = {
      agotado: `${vende}. Está agotado: cada día sin stock es venta perdida.`,
      critico: `${vende}${tend}. El stock dura ${f1(cobertura)} día(s) y el proveedor tarda ${plazo}: se agotaría antes de que llegue el pedido.`,
      reponer: rate > 0 ? `${vende}${tend}. La posición (${f1(posicion)}) está en o bajo el punto de pedido (${f1(puntoPedido)} = lo que se vende en ${plazo} días + margen de seguridad).` : `Está en o bajo el mínimo definido (${f1(p.stock_min)}) y no tiene ventas recientes.`,
      planificar: `${vende}${tend}. Alcanza para ${f1(cobertura)} día(s): con el plazo (${plazo} d) y el ciclo de compra (${op.compra_ciclo_dias} d) conviene incluirlo en el próximo pedido.`,
      sobrestock: `${vende}. Hay para ${f1(cobertura)} días de venta (lo recomendable es máx. ${op.compra_cobertura_max_dias}): no compres; son ${f1(capital)} USD inmovilizados.`,
      sin_movimiento: `Sin ventas en 90 días y con ${f1(stock)} en existencia: ${f1(capital)} USD inmovilizados.`
    }[nivel] + (p.stock_max > 0 && rate * (plazo + op.compra_ciclo_dias) > p.stock_max && !['sobrestock', 'sin_movimiento'].includes(nivel) ? ` Tu stock máximo (${f1(p.stock_max)}) parece bajo para lo que vendes.` : '');
    filas.push({ id: p.id, codigo: p.codigo, nombre: p.nombre, proveedor_id: p.proveedor_id, proveedor: prov ? prov.nombre : null, plazo, clase: cl, unidad_compra: p.unidad_compra, unidad_venta: p.unidad_venta, factor,
      costo_usd: p.costo_usd, stock, reservado, pendiente, posicion: r2(posicion), stock_min: p.stock_min, stock_max: p.stock_max, venta_dia: r2(rate), venta_7d: r2(r7), venta_30d: r2(r30), tendencia: tendencia == null ? null : r2(tendencia),
      cobertura_dias: cobertura == null ? null : r2(cobertura), stock_seguridad: r2(seguridad), punto_pedido: puntoPedido, objetivo, nivel, sugerido_unidades: unidades, sugerido_compra: cajas, costo_estimado: r2(unidades * p.costo_usd),
      capital_usd: r2(capital), historial_dias: hist, fiable: hist >= 14, motivo });
  }
  const orden = { agotado: 0, critico: 1, reponer: 2, planificar: 3, sobrestock: 4, sin_movimiento: 5 };
  filas.sort((a, b) => orden[a.nivel] - orden[b.nivel] || (a.cobertura_dias ?? 1e9) - (b.cobertura_dias ?? 1e9));
  const accion = filas.filter((x) => ['agotado', 'critico', 'reponer'].includes(x.nivel));
  return {
    parametros: { ciclo_dias: op.compra_ciclo_dias, cobertura_max_dias: op.compra_cobertura_max_dias, servicio: { A: 97.5, B: 95, C: 90 } },
    resumen: {
      reponer: accion.length, en_riesgo: filas.filter((x) => ['agotado', 'critico'].includes(x.nivel)).length, planificar: filas.filter((x) => x.nivel === 'planificar').length,
      inversion_usd: r2(accion.reduce((a, x) => a + x.costo_estimado, 0)), inmovilizado_usd: r2(filas.filter((x) => ['sobrestock', 'sin_movimiento'].includes(x.nivel)).reduce((a, x) => a + x.capital_usd, 0)), sin_problema: sinProblema
    },
    filas
  };
}
// Lista de productos a reponer ahora (formato usado por el dashboard, el simulador y la creación de órdenes)
function sugerenciasCompra() { return analisisCompras().filas.filter((x) => ['agotado', 'critico', 'reponer'].includes(x.nivel)); }

// ---------- caja ----------
function resumenTurno(turno) {
  const movs = D.all(`SELECT c.id AS cuenta_id, c.moneda, c.tipo, SUM(m.monto) AS monto
      FROM cuenta_movimientos m JOIN cuentas c ON c.id=m.cuenta_id WHERE m.turno_id=? GROUP BY c.id`, turno.id);
  const fondo = JSON.parse(turno.fondo || '{}');
  const esperado = { USD: fondo.USD || 0, VES: fondo.VES || 0, EUR: fondo.EUR || 0 };
  for (const m of movs) if (m.tipo === 'caja') esperado[m.moneda] = r2(esperado[m.moneda] + m.monto);
  const porMedio = D.all(`SELECT medio, moneda, SUM(monto) AS monto, SUM(monto_usd) AS monto_usd, COUNT(*) AS n
      FROM pagos WHERE turno_id=? AND anulado=0 AND tipo<>'vuelto' GROUP BY medio, moneda`, turno.id);
  const vueltos = D.all(`SELECT medio, moneda, SUM(monto) AS monto, SUM(monto_usd) AS monto_usd, COUNT(*) AS n
      FROM pagos WHERE turno_id=? AND anulado=0 AND tipo='vuelto' GROUP BY medio, moneda`, turno.id);
  const ventas = D.get("SELECT COUNT(*) AS n, COALESCE(SUM(total_usd),0) AS total FROM ventas WHERE turno_id=? AND estado='completada'", turno.id);
  return { fondo, esperado, por_medio: porMedio, vueltos, ventas };
}

// ---------- pedidos / reservas ----------
function barrerReservas() {
  const ahora = D.ahora();
  const vencidas = D.all("SELECT DISTINCT pedido_id FROM reservas WHERE estado='activa' AND expira<=?", ahora);
  if (!vencidas.length) return;
  D.tx(() => {
    for (const { pedido_id } of vencidas) {
      D.run("UPDATE reservas SET estado='vencida' WHERE pedido_id=? AND estado='activa' AND expira<=?", pedido_id, ahora);
      const act = D.get("SELECT COUNT(*) AS n FROM reservas WHERE pedido_id=? AND estado='activa'", pedido_id).n;
      if (!act) D.run("UPDATE pedidos SET estado='vencido', motivo='La reserva venció', expira=NULL WHERE id=? AND estado IN ('pendiente','pago_reportado')", pedido_id);
    }
  });
}
function liberarReservas(pedido_id, estado = 'liberada') {
  D.run("UPDATE reservas SET estado=? WHERE pedido_id=? AND estado='activa'", estado, pedido_id);
}

function semaforo(p, orden) {
  const envio = p.entrega === 'envio';
  const pasos = ['Pedido creado', 'Soporte de pago recibido', 'Pago en validación', 'Pago validado', 'En preparación',
    envio ? 'Listo para envío' : 'Listo para retiro', ...(envio ? ['En camino'] : []), 'Entregado'];
  let idx = 0, color = 'amarillo', mensaje = 'Esperando tu reporte de pago.';
  if (p.estado === 'pendiente') { idx = 0; color = 'amarillo'; }
  else if (p.estado === 'pago_reportado') { idx = 2; color = 'amarillo'; mensaje = 'Recibimos tu soporte. Estamos validando el pago.'; }
  else if (['pagado', 'entregado'].includes(p.estado)) {
    color = 'verde'; mensaje = 'Pago validado.';
    const e = orden ? orden.estado : 'por_preparar';
    idx = { por_preparar: 3, en_preparacion: 4, preparada: 5, lista_retiro: 5, lista_envio: 5, enviada: envio ? 6 : 5, entregada: pasos.length - 1 }[e] ?? 3;
    if (e === 'por_preparar') mensaje = 'Pago validado. Tu pedido pasa a preparación.';
    if (e === 'en_preparacion') mensaje = 'Estamos preparando tu pedido.';
    if (e === 'lista_retiro') mensaje = 'Tu pedido está listo para retirar en tienda.';
    if (e === 'lista_envio') mensaje = 'Tu pedido está listo para ser enviado.';
    if (e === 'enviada') mensaje = 'Tu pedido va en camino.';
    if (e === 'entregada') mensaje = 'Pedido entregado. ¡Gracias por tu compra!';
  } else if (p.estado === 'rechazado') { idx = 2; color = 'rojo'; mensaje = 'Pago rechazado: ' + (p.motivo || 'revisa los datos del pago.'); }
  else if (p.estado === 'vencido') { idx = 0; color = 'rojo'; mensaje = 'La reserva venció y el stock fue liberado.'; }
  else if (p.estado === 'cancelado') { idx = 0; color = 'rojo'; mensaje = 'Pedido cancelado' + (p.motivo ? ': ' + p.motivo : '.'); }
  return { color, paso: idx, pasos, mensaje };
}

// ---------- inventario cíclico ABC ----------
function clasificarABC() {
  const cfg = D.param('abc');
  const desde = D.sumarDias(-90);
  const rows = D.all(`SELECT p.id, p.codigo, p.nombre, p.costo_usd, p.stock_min, p.ubicacion,
      COALESCE((SELECT SUM(cantidad) FROM inventario_movimientos m WHERE m.producto_id=p.id),0) AS stock,
      COALESCE((SELECT SUM(-cantidad) FROM inventario_movimientos m WHERE m.producto_id=p.id AND m.tipo='venta' AND substr(m.fecha,1,10)>=?),0) AS vendido
      FROM productos p WHERE p.activo=1`, desde);
  for (const r of rows) { r.valor = Math.max(0, r.stock) * r.costo_usd; r.mov = Math.max(0, r.vendido) * r.costo_usd; }
  const maxV = Math.max(1e-9, ...rows.map((r) => r.valor)), maxM = Math.max(1e-9, ...rows.map((r) => r.mov));
  for (const r of rows) {
    r.metrica = cfg.criterio === 'movimiento' ? r.mov : cfg.criterio === 'mixto' ? 0.5 * r.valor / maxV + 0.5 * r.mov / maxM : r.valor;
  }
  rows.sort((a, b) => b.metrica - a.metrica);
  const total = rows.reduce((a, r) => a + r.metrica, 0);
  const a = cfg.pctA / 100, ab = (cfg.pctA + cfg.pctB) / 100;
  let acum = 0;
  for (const r of rows) {
    if (total <= 0) r.clase = 'C';
    else r.clase = acum < a - 1e-9 ? 'A' : acum < ab - 1e-9 ? 'B' : 'C';
    acum += total > 0 ? r.metrica / total : 0;
    r.acumulado = r2(acum * 100);
  }
  const n = { A: 0, B: 0, C: 0 };
  rows.forEach((r) => n[r.clase]++);
  const anuales = n.A * cfg.vueltasA + n.B * cfg.vueltasB + n.C * cfg.vueltasC;
  const diarios = rows.length ? Math.max(1, Math.ceil(anuales / Math.max(1, cfg.dias_operativos))) : 0;
  return { cfg, productos: rows, conteo: n, items_anuales: anuales, items_diarios: diarios };
}

// --- Plan de conteo: la cantidad diaria y su reparto por clase son un RESULTADO MATEMÁTICO del plan ABC ---
//   ítems_anuales = A×vueltasA + B×vueltasB + C×vueltasC        ítems_diarios = ⌈ítems_anuales ÷ días_operativos⌉
// Los ítems del día se reparten entre las clases en proporción a su carga anual (productos × vueltas). Como el reparto de cada
// día es entero, la fracción sobrante se arrastra al día siguiente: así a lo largo del año cada clase recibe exactamente sus vueltas.
// Lo único aleatorio es QUÉ productos se cuentan dentro de cada clase.
function leerArrastre() {
  const f = D.get("SELECT valor FROM parametros WHERE clave='abc_arrastre'");
  try { return f ? JSON.parse(f.valor) : {}; } catch { return {}; }
}
function guardarArrastre(c) {
  D.run("INSERT INTO parametros(clave,valor) VALUES('abc_arrastre',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", JSON.stringify(c));
}
function cuotasDelDia(cls, arrastre = {}) {
  const { cfg, conteo: n, items_diarios: objetivo } = cls;
  const vueltas = { A: cfg.vueltasA, B: cfg.vueltasB, C: cfg.vueltasC };
  const anual = { A: n.A * vueltas.A, B: n.B * vueltas.B, C: n.C * vueltas.C };
  const total = anual.A + anual.B + anual.C;
  const cuota = { A: 0, B: 0, C: 0 }, nuevo = { A: 0, B: 0, C: 0 };
  if (!total || !objetivo) return { cuota, arrastre: nuevo };
  const x = {};
  for (const k of ['A', 'B', 'C']) x[k] = (objetivo * anual[k]) / total + (arrastre[k] || 0);
  let resto = objetivo;
  for (const k of ['A', 'B', 'C']) { cuota[k] = Math.min(n[k], Math.max(0, Math.floor(x[k]))); resto -= cuota[k]; }
  // lo que falta se da a las clases con mayor fracción pendiente que aún tengan productos por contar
  while (resto > 0) {
    const k = ['A', 'B', 'C'].filter((c) => cuota[c] < n[c]).sort((a, b) => (x[b] - cuota[b]) - (x[a] - cuota[a]))[0];
    if (!k) break;
    cuota[k]++; resto--;
  }
  while (resto < 0) { // si los arrastres hicieron pasarse del objetivo
    const k = ['A', 'B', 'C'].filter((c) => cuota[c] > 0).sort((a, b) => (x[a] - cuota[a]) - (x[b] - cuota[b]))[0];
    if (!k) break;
    cuota[k]--; resto++;
  }
  for (const k of ['A', 'B', 'C']) nuevo[k] = Math.max(-2, Math.min(2, x[k] - cuota[k]));
  return { cuota, arrastre: nuevo };
}

// La cantidad NO la decide el usuario: sale del plan. El tercer parámetro se conserva por compatibilidad y se ignora.
function generarConteo(usuario, responsable, _ignorado, regenerar) {
  const hoy = D.hoy();
  const previo = D.get("SELECT * FROM conteos WHERE substr(fecha,1,10)=? AND estado IN ('generado','cargado') ORDER BY id DESC LIMIT 1", hoy);
  if (previo && !regenerar) err(409, `Ya existe el conteo del día ${previo.numero} (${previo.estado}). Solo un supervisor puede regenerarlo.`);
  if (previo && regenerar) {
    if (previo.arrastre_antes) guardarArrastre(JSON.parse(previo.arrastre_antes)); // el conteo anulado no cuenta para el plan
    D.run("UPDATE conteos SET estado='anulado' WHERE id=?", previo.id);
  }
  const cls = clasificarABC();
  if (!cls.productos.length) err(409, 'No hay productos activos para contar');
  const cfg = cls.cfg;
  const vueltas = { A: cfg.vueltasA, B: cfg.vueltasB, C: cfg.vueltasC };
  const arrastreAntes = leerArrastre();
  const { cuota, arrastre } = cuotasDelDia(cls, arrastreAntes);
  const reservados = new Set(D.all("SELECT DISTINCT producto_id FROM reservas WHERE estado='activa' AND expira>?", D.ahora()).map((r) => r.producto_id));
  // Sorteo ponderado sin reemplazo dentro de cada clase (Efraimidis-Spirakis): más probable lo que lleva más tiempo sin contarse,
  // lo que está bajo mínimo, con reservas de la app o con diferencias previas. Nadie sabe de antemano qué se contará.
  const candidatos = cls.productos.map((p) => {
    const ult = D.get(`SELECT MAX(substr(c.fecha,1,10)) AS f FROM conteo_items i JOIN conteos c ON c.id=i.conteo_id
                       WHERE i.producto_id=? AND i.contado IS NOT NULL`, p.id).f;
    const dias = ult ? Math.max(0, Math.round((new Date(hoy) - new Date(ult)) / 86400000)) : 365;
    const difs = D.get('SELECT COUNT(*) AS n FROM conteo_items WHERE producto_id=? AND diferencia IS NOT NULL AND ABS(diferencia)>0.0001', p.id).n;
    const intervalo = cfg.dias_operativos / Math.max(0.1, vueltas[p.clase]);
    const urgencia = Math.min(4, dias / intervalo);
    const bajoMin = p.stock_min > 0 && p.stock <= p.stock_min;
    const peso = 0.15 + urgencia + (bajoMin ? 0.5 : 0) + (reservados.has(p.id) ? 0.3 : 0) + Math.min(2, difs * 0.4);
    const motivos = [`Clase ${p.clase}`, ult ? `${dias} días sin contar` : 'nunca contado'];
    if (bajoMin) motivos.push('bajo mínimo');
    if (reservados.has(p.id)) motivos.push('con reservas app');
    if (difs) motivos.push(`${difs} diferencia(s) previa(s)`);
    return { p, clave: -Math.log(Math.random() || 1e-12) / peso, motivo: motivos.join(' · ') };
  });
  const elegidos = [];
  for (const k of ['A', 'B', 'C']) elegidos.push(...candidatos.filter((c) => c.p.clase === k).sort((a, b) => a.clave - b.clave).slice(0, cuota[k]));
  if (!elegidos.length) err(409, 'El plan ABC no asigna ítems para hoy: revisa los parámetros del inventario cíclico');
  const numero = `IC-${hoy.replace(/-/g, '')}-${String(D.get("SELECT COUNT(*) AS n FROM conteos WHERE substr(fecha,1,10)=?", hoy).n + 1).padStart(3, '0')}`;
  const id = D.insert('INSERT INTO conteos(numero,fecha,responsable,estado,generado_por,arrastre_antes) VALUES(?,?,?,?,?,?)', numero, D.ahora(), responsable || usuario, 'generado', usuario, JSON.stringify(arrastreAntes));
  for (const c of elegidos)
    D.insert('INSERT INTO conteo_items(conteo_id,producto_id,clase,motivo,stock_sistema) VALUES(?,?,?,?,?)', id, c.p.id, c.p.clase, c.motivo, c.p.stock);
  guardarArrastre(arrastre);
  audit(usuario, 'conteo_generado', 'conteo', id, { numero, items: elegidos.length, cuota });
  return { id, numero, items: elegidos.length, cuota };
}

module.exports = {
  HttpError, err, r2, r4, MONEDAS, MEDIOS, audit, jornadaAbierta, requireJornada, ultimaTasa, tasaDe, aUSD, deUSD,
  stockDe, reservadoDe, disponible, mov, movimiento, precioPorMargen, saldoCuenta, cuentaMov, cuentaEfectivo, resolverCuentaPago,
  crearVenta, anularVenta, turnoAbiertoDe, cobrarCxc, pagarCxp, guardarCompra, enviarCompra, recibirCompra, anularCompra, sugerenciasCompra, analisisCompras,
  resumenTurno, barrerReservas, liberarReservas, semaforo, clasificarABC, generarConteo, cuotasDelDia, leerArrastre
};
