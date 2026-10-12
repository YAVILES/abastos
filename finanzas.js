'use strict';
// Análisis financiero: estado de resultados, balance general, flujo de caja e indicadores, todo en USD.
// Las cuentas en bolívares o euros se convierten con la tasa vigente; las ventas usan el costo que tenía cada producto al venderse.
const D = require('./db');
const L = require('./lib');
const { err, r2 } = L;

const CATEGORIAS_GASTO = ['Alquiler', 'Servicios (luz, agua, internet)', 'Nómina y beneficios', 'Impuestos y tasas', 'Transporte y fletes',
  'Mantenimiento y reparaciones', 'Publicidad', 'Comisiones bancarias y de punto de venta', 'Papelería y suministros', 'Otros'];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
function periodo(q) {
  const hoy = D.hoy();
  const desde = q.desde && FECHA.test(q.desde) ? q.desde : hoy.slice(0, 8) + '01';
  const hasta = q.hasta && FECHA.test(q.hasta) ? q.hasta : hoy;
  if (desde > hasta) err(400, 'La fecha inicial no puede ser posterior a la final');
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;
  if (dias > 800) err(400, 'El período es demasiado largo (máximo ~2 años)');
  return { desde, hasta, dias };
}
const pct = (a, b) => (b > 0.005 ? r2((a / b) * 100) : null);
const div = (a, b) => (b > 0.005 ? r2(a / b) : null);

function tasaVigente() {
  const t = L.jornadaAbierta() || L.ultimaTasa();
  if (!t) err(409, 'Aún no hay tasas registradas: abre un día operativo para ver los estados financieros.');
  return t;
}
const aUSD = (monto, moneda, t) => (moneda === 'USD' ? monto : moneda === 'VES' ? monto / t.tasa_usd_ves : monto * t.tasa_eur_usd);

function estadoResultados({ desde, hasta }) {
  const ventas = D.get(`SELECT COUNT(*) AS n, COALESCE(SUM(subtotal_usd),0) AS bruto, COALESCE(SUM(descuento_usd),0) AS descuentos, COALESCE(SUM(total_usd),0) AS neto
    FROM ventas WHERE estado='completada' AND substr(fecha,1,10) BETWEEN ? AND ?`, desde, hasta);
  const costo = D.get(`SELECT COALESCE(SUM(d.costo_usd*d.cantidad),0) AS c FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id
    WHERE v.estado='completada' AND substr(v.fecha,1,10) BETWEEN ? AND ?`, desde, hasta).c;
  const ajustes = D.all(`SELECT tipo, COALESCE(SUM(cantidad*costo_usd),0) AS valor FROM inventario_movimientos
    WHERE tipo IN ('merma','ajuste','consumo_interno','ajuste_conteo') AND substr(fecha,1,10) BETWEEN ? AND ? GROUP BY tipo`, desde, hasta);
  const ajusteInv = r2(ajustes.reduce((a, x) => a + x.valor, 0));
  const difCaja = r2(D.get("SELECT COALESCE(SUM(diferencia_usd),0) AS d FROM caja_turnos WHERE estado='cerrada' AND substr(cerrada_en,1,10) BETWEEN ? AND ?", desde, hasta).d);
  const gastos = D.all("SELECT categoria, COALESCE(SUM(monto_usd),0) AS monto FROM gastos WHERE anulado=0 AND fecha BETWEEN ? AND ? GROUP BY categoria ORDER BY monto DESC", desde, hasta).map((g) => ({ categoria: g.categoria, monto: r2(g.monto) }));
  const gastosTotal = r2(gastos.reduce((a, g) => a + g.monto, 0));
  const bruta = r2(ventas.neto - costo);
  const neta = r2(bruta + ajusteInv + difCaja - gastosTotal);
  return {
    ventas_n: ventas.n, ventas_brutas: r2(ventas.bruto), descuentos: r2(ventas.descuentos), ventas_netas: r2(ventas.neto), costo_ventas: r2(costo), utilidad_bruta: bruta,
    ajustes_inventario: ajustes.map((a) => ({ tipo: a.tipo, valor: r2(a.valor) })), ajuste_inventario_total: ajusteInv, diferencias_caja: difCaja,
    gastos, gastos_total: gastosTotal, utilidad_neta: neta
  };
}

function balance(t) {
  const cuentas = D.all('SELECT id, nombre, tipo, moneda, activo FROM cuentas ORDER BY tipo, nombre').map((c) => {
    const saldo = L.saldoCuenta(c.id);
    return { ...c, saldo, usd: r2(aUSD(saldo, c.moneda, t)) };
  }).filter((c) => c.activo || Math.abs(c.saldo) > 0.005);
  const efectivo = r2(cuentas.filter((c) => c.tipo === 'caja').reduce((a, c) => a + c.usd, 0));
  const bancos = r2(cuentas.filter((c) => c.tipo !== 'caja').reduce((a, c) => a + c.usd, 0));
  const hoy = D.hoy();
  const cxc = D.get("SELECT COALESCE(SUM(saldo_usd),0) AS t, COALESCE(SUM(CASE WHEN vence<? THEN saldo_usd ELSE 0 END),0) AS vencida FROM cxc WHERE estado IN ('pendiente','abonada')", hoy);
  const cxp = D.get("SELECT COALESCE(SUM(saldo_usd),0) AS t, COALESCE(SUM(CASE WHEN vence<? THEN saldo_usd ELSE 0 END),0) AS vencida FROM cxp WHERE estado IN ('pendiente','abonada')", hoy);
  const inv = D.get(`SELECT COALESCE(SUM(MAX(0,s)*c),0) AS v FROM (SELECT (SELECT COALESCE(SUM(cantidad),0) FROM inventario_movimientos m WHERE m.producto_id=p.id) AS s, p.costo_usd AS c FROM productos p)`).v;
  const corrientes = r2(efectivo + bancos + cxc.t + inv);
  const pasivos = r2(cxp.t);
  return {
    cuentas, efectivo, bancos, cxc: r2(cxc.t), cxc_vencida: r2(cxc.vencida), inventario: r2(inv), activos_corrientes: corrientes, activos_total: corrientes,
    cxp: r2(cxp.t), cxp_vencida: r2(cxp.vencida), pasivos_corrientes: pasivos, pasivos_total: pasivos, patrimonio: r2(corrientes - pasivos),
    tasa: { usd_ves: t.tasa_usd_ves, eur_usd: t.tasa_eur_usd }, a_la_fecha: D.hoy()
  };
}

function flujoCaja({ desde, hasta }, t, balanceHoy) {
  const filas = D.all(`SELECT m.tipo, COALESCE(SUM(m.monto_usd),0) AS usd FROM cuenta_movimientos m
    WHERE substr(m.fecha,1,10) BETWEEN ? AND ? GROUP BY m.tipo`, desde, hasta);
  const g = (...tipos) => r2(filas.filter((f) => tipos.includes(f.tipo)).reduce((a, f) => a + f.usd, 0));
  const conocidos = ['venta', 'vuelto', 'reverso_venta', 'cobro_cxc', 'compra', 'reverso_compra', 'pago_proveedor', 'gasto', 'reverso_gasto', 'transferencia_interna'];
  const otros = r2(filas.filter((f) => !conocidos.includes(f.tipo)).reduce((a, f) => a + f.usd, 0));
  const lineas = [
    { concepto: 'Cobros de ventas (netos de vuelto y anulaciones)', usd: g('venta', 'vuelto', 'reverso_venta'), grupo: 'operacion' },
    { concepto: 'Cobros de cuentas por cobrar', usd: g('cobro_cxc'), grupo: 'operacion' },
    { concepto: 'Compras pagadas de contado', usd: g('compra', 'reverso_compra'), grupo: 'operacion' },
    { concepto: 'Pagos a proveedores (cuentas por pagar)', usd: g('pago_proveedor'), grupo: 'operacion' },
    { concepto: 'Gastos operativos', usd: g('gasto', 'reverso_gasto'), grupo: 'operacion' },
    { concepto: 'Diferencias por cambio entre cuentas', usd: g('transferencia_interna'), grupo: 'otros' },
    { concepto: 'Otros movimientos', usd: otros, grupo: 'otros' }
  ];
  const neto = r2(lineas.reduce((a, l) => a + l.usd, 0));
  // saldo al inicio: saldos iniciales de las cuentas más lo movido antes del período
  const ini = D.all('SELECT id, moneda, saldo_inicial FROM cuentas').reduce((a, c) => a + aUSD(c.saldo_inicial, c.moneda, t), 0)
    + D.get('SELECT COALESCE(SUM(monto_usd),0) AS s FROM cuenta_movimientos WHERE substr(fecha,1,10)<?', desde).s;
  const saldoInicial = r2(ini);
  const saldoFinalMov = r2(saldoInicial + neto);
  const alDia = hasta >= D.hoy();
  const saldoReal = r2(balanceHoy.efectivo + balanceHoy.bancos);
  return { lineas, flujo_neto: neto, saldo_inicial: saldoInicial, saldo_final: alDia ? saldoReal : saldoFinalMov, efecto_tasa: alDia ? r2(saldoReal - saldoFinalMov) : null };
}

function indicadores(per, res, bal, comprasPeriodo) {
  const { dias } = per;
  const a = [];
  const mb = pct(res.utilidad_bruta, res.ventas_netas), mn = pct(res.utilidad_neta, res.ventas_netas);
  const rot = res.costo_ventas > 0 && bal.inventario > 0 ? r2((res.costo_ventas / bal.inventario) * (365 / dias)) : null;
  const diasInv = res.costo_ventas > 0 ? r2((bal.inventario / res.costo_ventas) * dias) : null;
  const diasCxc = res.ventas_netas > 0 ? r2((bal.cxc / res.ventas_netas) * dias) : null;
  const diasCxp = comprasPeriodo > 0 ? r2((bal.cxp / comprasPeriodo) * dias) : null;
  const razon = div(bal.activos_corrientes, bal.pasivos_corrientes);
  const acida = div(bal.efectivo + bal.bancos + bal.cxc, bal.pasivos_corrientes);
  const margenFrac = res.ventas_netas > 0 ? res.utilidad_bruta / res.ventas_netas : 0;
  const equilibrio = margenFrac > 0 ? r2(res.gastos_total / margenFrac) : null;
  if (mb !== null && mb < 15) a.push({ nivel: 'ojo', texto: `El margen bruto es de ${mb}%: está bajo para un abasto. Revisa precios y costos de los productos de mayor venta.` });
  if (res.ventas_netas > 0 && res.utilidad_neta < 0) a.push({ nivel: 'mal', texto: 'En este período los gastos y ajustes superan la utilidad bruta: hay pérdida.' });
  if (diasInv !== null && diasInv > 60) a.push({ nivel: 'ojo', texto: `El inventario alcanza para ${Math.round(diasInv)} días de venta: hay dinero parado en mercancía.` });
  if (bal.cxc > 0 && bal.cxc_vencida / bal.cxc > 0.3) a.push({ nivel: 'ojo', texto: `El ${Math.round((bal.cxc_vencida / bal.cxc) * 100)}% de lo que te deben ya está vencido.` });
  if (bal.cxp_vencida > 0.005) a.push({ nivel: 'ojo', texto: `Tienes ${bal.cxp_vencida.toFixed(2)} USD vencidos con proveedores.` });
  if (razon !== null && razon < 1) a.push({ nivel: 'mal', texto: 'Lo que debes a corto plazo supera lo que tienes disponible, por cobrar y en inventario.' });
  if (equilibrio !== null && res.ventas_netas < equilibrio) a.push({ nivel: 'ojo', texto: `Con estos gastos necesitas vender ${equilibrio.toFixed(2)} USD en el período para no perder; llevas ${res.ventas_netas.toFixed(2)}.` });
  if (!res.gastos_total && res.ventas_netas > 0) a.push({ nivel: 'info', texto: 'No hay gastos registrados en este período: la utilidad neta se ve más alta de lo real. Regístralos en la pestaña Gastos.' });
  return {
    margen_bruto_pct: mb, margen_neto_pct: mn, ticket_promedio: div(res.ventas_netas, res.ventas_n), ventas_por_dia: r2(res.ventas_netas / dias),
    rotacion_inventario_anual: rot, dias_inventario: diasInv, dias_cobro: diasCxc, dias_pago: diasCxp,
    razon_corriente: razon, prueba_acida: acida, capital_trabajo: r2(bal.activos_corrientes - bal.pasivos_corrientes),
    endeudamiento_pct: pct(bal.pasivos_total, bal.activos_total), punto_equilibrio: equilibrio, compras_periodo: r2(comprasPeriodo), alertas: a
  };
}

function resumen(q) {
  const per = periodo(q);
  const t = tasaVigente();
  const res = estadoResultados(per);
  const bal = balance(t);
  const flujo = flujoCaja(per, t, bal);
  const compras = D.get("SELECT COALESCE(SUM(total_usd),0) AS c FROM compras WHERE estado<>'anulada' AND substr(fecha,1,10) BETWEEN ? AND ?", per.desde, per.hasta).c;
  const ind = indicadores(per, res, bal, compras);
  const agrupa = per.dias > 62 ? 'substr(v.fecha,1,7)' : 'substr(v.fecha,1,10)';
  const serie = D.all(`SELECT ${agrupa} AS d, COALESCE(SUM(v.total_usd),0) AS ventas,
      COALESCE(SUM(v.total_usd - (SELECT COALESCE(SUM(x.costo_usd*x.cantidad),0) FROM venta_detalles x WHERE x.venta_id=v.id)),0) AS utilidad
    FROM ventas v WHERE v.estado='completada' AND substr(v.fecha,1,10) BETWEEN ? AND ? GROUP BY d ORDER BY d`, per.desde, per.hasta).map((x) => ({ d: x.d, ventas: r2(x.ventas), utilidad: r2(x.utilidad) }));
  const categorias = D.all(`SELECT COALESCE(c.nombre,'Sin categoría') AS categoria, SUM(d.precio_usd*d.cantidad - d.descuento_usd) AS ventas, SUM(d.costo_usd*d.cantidad) AS costo
    FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id JOIN productos p ON p.id=d.producto_id LEFT JOIN categorias c ON c.id=p.categoria_id
    WHERE v.estado='completada' AND substr(v.fecha,1,10) BETWEEN ? AND ? GROUP BY categoria ORDER BY (SUM(d.precio_usd*d.cantidad - d.descuento_usd) - SUM(d.costo_usd*d.cantidad)) DESC`, per.desde, per.hasta)
    .map((x) => ({ categoria: x.categoria, ventas: r2(x.ventas), costo: r2(x.costo), utilidad: r2(x.ventas - x.costo), margen_pct: pct(x.ventas - x.costo, x.ventas) }));
  const productos = D.all(`SELECT p.nombre, SUM(d.cantidad) AS unidades, SUM(d.precio_usd*d.cantidad - d.descuento_usd) AS ventas, SUM(d.costo_usd*d.cantidad) AS costo
    FROM venta_detalles d JOIN ventas v ON v.id=d.venta_id JOIN productos p ON p.id=d.producto_id
    WHERE v.estado='completada' AND substr(v.fecha,1,10) BETWEEN ? AND ? GROUP BY p.id ORDER BY (SUM(d.precio_usd*d.cantidad - d.descuento_usd) - SUM(d.costo_usd*d.cantidad)) DESC LIMIT 10`, per.desde, per.hasta)
    .map((x) => ({ nombre: x.nombre, unidades: r2(x.unidades), ventas: r2(x.ventas), utilidad: r2(x.ventas - x.costo), margen_pct: pct(x.ventas - x.costo, x.ventas) }));
  return { periodo: per, resultados: res, balance: bal, flujo, indicadores: ind, serie, categorias, productos_top: productos, notas: [
    'Todo está expresado en USD. Las cuentas en bolívares o euros se convierten con la tasa vigente, por eso el efecto de la tasa aparece aparte en el flujo de caja.',
    'El balance es de hoy: no incluye activos fijos, préstamos ni capital aportado porque el sistema aún no los registra; el patrimonio se calcula como activos menos pasivos.',
    'La utilidad no descuenta impuestos sobre la renta ni IVA.'] };
}

// ---------- gastos ----------
function registrarGasto(o) {
  const jor = L.requireJornada();
  const monto = Number(o.monto);
  if (!(monto > 0)) err(400, 'Indica el monto del gasto');
  if (!L.MONEDAS.includes(o.moneda)) err(400, 'Moneda no válida');
  const categoria = String(o.categoria || '').trim();
  if (!categoria) err(400, 'Elige la categoría del gasto');
  const cuenta = D.get('SELECT * FROM cuentas WHERE id=? AND activo=1', o.cuenta_id);
  if (!cuenta) err(400, 'Elige la caja o el banco desde donde se pagó');
  if (cuenta.moneda !== o.moneda) err(400, `La cuenta "${cuenta.nombre}" es ${cuenta.moneda}: el gasto debe estar en esa moneda`);
  const fecha = o.fecha && FECHA.test(o.fecha) ? o.fecha : D.hoy();
  if (fecha > D.hoy()) err(400, 'La fecha del gasto no puede ser futura');
  if (!['USD', 'VES', 'EUR'].includes(o.moneda)) err(400, 'Moneda no válida');
  const tasa = L.tasaDe(o.moneda, jor), usd = L.aUSD(monto, o.moneda, jor);
  const id = D.insert(`INSERT INTO gastos(fecha,categoria,descripcion,beneficiario,moneda,monto,tasa,monto_usd,cuenta_id,referencia,usuario,jornada_id,creado) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    fecha, categoria, (o.descripcion || '').trim() || null, (o.beneficiario || '').trim() || null, o.moneda, monto, tasa, usd, cuenta.id, (o.referencia || '').trim() || null, o.usuario, jor.id, D.ahora());
  const turno = cuenta.tipo === 'caja' && o.turno_id ? o.turno_id : null;
  L.cuentaMov(cuenta.id, -monto, -usd, 'gasto', { referencia: o.referencia, ref_tipo: 'gasto', ref_id: id, usuario: o.usuario, jornada_id: jor.id, turno_id: turno, nota: categoria });
  L.audit(o.usuario, 'gasto_registrado', 'gasto', id, { categoria, monto_usd: usd });
  return { id, monto_usd: usd };
}
function anularGasto(id, motivo, usuario) {
  const g = D.get('SELECT * FROM gastos WHERE id=?', id);
  if (!g) err(404, 'Gasto no encontrado');
  if (g.anulado) err(409, 'El gasto ya está anulado');
  if (!String(motivo || '').trim()) err(400, 'Indica el motivo de la anulación');
  const jor = L.jornadaAbierta();
  for (const m of D.all("SELECT * FROM cuenta_movimientos WHERE ref_tipo='gasto' AND ref_id=? AND tipo='gasto'", g.id))
    L.cuentaMov(m.cuenta_id, -m.monto, -m.monto_usd, 'reverso_gasto', { ref_tipo: 'gasto', ref_id: g.id, usuario, jornada_id: jor && jor.id, nota: 'Anulación: ' + motivo });
  D.run('UPDATE gastos SET anulado=1, motivo_anulacion=? WHERE id=?', motivo.trim(), g.id);
  L.audit(usuario, 'gasto_anulado', 'gasto', g.id, motivo);
}
function listarGastos(q) {
  const per = periodo(q);
  const filas = D.all(`SELECT g.*, c.nombre AS cuenta FROM gastos g JOIN cuentas c ON c.id=g.cuenta_id WHERE g.fecha BETWEEN ? AND ? ORDER BY g.fecha DESC, g.id DESC`, per.desde, per.hasta);
  return { periodo: per, gastos: filas, total_usd: r2(filas.filter((g) => !g.anulado).reduce((a, g) => a + g.monto_usd, 0)), categorias: CATEGORIAS_GASTO };
}

module.exports = { resumen, registrarGasto, anularGasto, listarGastos, CATEGORIAS_GASTO };
