'use strict';
// Análisis financiero: resumen con indicadores, estado de resultados, balance general, flujo de caja y registro de gastos.
(() => {
  const A = Abasto, { e, fm, usd, api } = A;
  const f2 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sumar = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const PRESETS = [
    ['mes', 'Este mes', () => { const h = new Date(); return [f2(new Date(h.getFullYear(), h.getMonth(), 1)), f2(h)]; }],
    ['mes_ant', 'Mes anterior', () => { const h = new Date(); return [f2(new Date(h.getFullYear(), h.getMonth() - 1, 1)), f2(new Date(h.getFullYear(), h.getMonth(), 0))]; }],
    ['7', 'Últimos 7 días', () => [f2(sumar(new Date(), -6)), f2(new Date())]],
    ['30', 'Últimos 30 días', () => [f2(sumar(new Date(), -29)), f2(new Date())]],
    ['anio', 'Este año', () => { const h = new Date(); return [f2(new Date(h.getFullYear(), 0, 1)), f2(h)]; }],
    ['otro', 'Fechas a elegir', null]
  ];
  let per = (() => { const [d, h] = PRESETS[0][2](); return { preset: 'mes', desde: d, hasta: h }; })();
  const TABS = [['resumen', 'Resumen e indicadores'], ['resultados', 'Estado de resultados'], ['balance', 'Balance general'], ['flujo', 'Flujo de caja'], ['gastos', 'Gastos']];
  const signo = (n) => (n < -0.004 ? 'bad' : n > 0.004 ? 'ok' : '');
  const num = (n) => `<span class="${signo(n)}">${usd(n)}</span>`;
  const pc = (a, b) => (b > 0.005 ? fm((a / b) * 100, 1) + '%' : '—');

  A.vistas.finanzas = async (root, arg) => {
    const tab = TABS.some(([k]) => k === arg) ? arg : 'resumen';
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Análisis financiero</h1><div class="chips no-print"><button class="btn" data-a="imprimir">Imprimir / guardar PDF</button></div></div>
      <div class="chips no-print" style="margin:10px 0">${TABS.map(([k, l]) => `<a class="btn ${k === tab ? 'pri' : ''}" href="#/finanzas/${k}">${l}</a>`).join('')}</div>
      <div class="card no-print" style="margin-bottom:14px"><div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div><label>Período</label><select id="pre">${PRESETS.map(([k, l]) => `<option value="${k}" ${k === per.preset ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>Desde</label><input type="date" id="fd" value="${e(per.desde)}"></div><div><label>Hasta</label><input type="date" id="fh" value="${e(per.hasta)}"></div>
        <button class="btn pri" data-a="aplicar">Ver</button></div></div>
      <div id="fx"><div class="empty">Calculando…</div></div>`;
    const $ = (s) => root.querySelector(s);
    $('#pre').onchange = () => { const p = PRESETS.find(([k]) => k === $('#pre').value); if (p[2]) { const [d, h] = p[2](); $('#fd').value = d; $('#fh').value = h; } };
    const volver = () => A.render();
    A.acciones(root, {
      imprimir: () => window.print(),
      aplicar: () => { per = { preset: $('#pre').value, desde: $('#fd').value, hasta: $('#fh').value }; if (per.preset !== 'otro' && !PRESETS.find(([k]) => k === per.preset)[2]) per.preset = 'otro'; volver(); }
    });
    try {
      if (tab === 'gastos') return await gastos($('#fx'));
      const d = await api.get(`/api/finanzas/resumen?desde=${per.desde}&hasta=${per.hasta}`);
      const rango = `${A.S.empresa.logo ? `<img src="${A.S.empresa.logo}" alt="" style="max-height:52px;float:right">` : ''}<p class="muted" style="margin:0 0 12px">Del ${e(d.periodo.desde)} al ${e(d.periodo.hasta)} (${d.periodo.dias} día${d.periodo.dias === 1 ? '' : 's'}) · cifras en USD · ${e(A.S.empresa.nombre || '')}</p>`;
      const vistas = { resumen, resultados, balance, flujo };
      $('#fx').innerHTML = rango + vistas[tab](d) + `<div class="card" style="margin-top:14px"><b>Notas</b><ul class="muted" style="margin:6px 0 0;padding-left:18px">${d.notas.map((n) => `<li>${e(n)}</li>`).join('')}</ul></div>`;
    } catch (er) { $('#fx').innerHTML = `<div class="card bad">${e(er.message)}</div>`; }
  };

  // ---------- Resumen ----------
  function resumen(d) {
    const r = d.resultados, b = d.balance, i = d.indicadores;
    const kpi = (l, v, s, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${s || ''}</div></div>`;
    const max = Math.max(1, ...d.serie.map((x) => x.ventas));
    const barras = d.serie.length ? `<div style="display:flex;align-items:flex-end;gap:4px;height:150px;overflow-x:auto;padding-top:8px">${d.serie.map((x) => `<div style="flex:1;min-width:14px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${e(x.d)}: ventas ${usd(x.ventas)} · utilidad bruta ${usd(x.utilidad)}"><div style="width:100%;background:var(--pri,#0f7b5f);opacity:.25;height:${Math.max(2, (x.ventas / max) * 100)}%;border-radius:3px 3px 0 0;position:relative"><div style="position:absolute;bottom:0;left:0;right:0;background:var(--pri,#0f7b5f);height:${x.ventas > 0 ? Math.max(0, (x.utilidad / x.ventas) * 100) : 0}%;border-radius:3px 3px 0 0"></div></div><div class="muted" style="font-size:9px;margin-top:2px">${e(x.d.slice(-2))}</div></div>`).join('')}</div><p class="muted" style="font-size:11px;margin:4px 0 0">Cada barra es un ${d.periodo.dias > 62 ? 'mes' : 'día'}; la parte oscura es la utilidad bruta sobre las ventas.</p>` : '<div class="empty">No hay ventas en este período</div>';
    const ind = (n, v, ayuda) => `<tr><td>${n}<div class="muted" style="font-size:11px">${ayuda}</div></td><td class="n"><b>${v}</b></td></tr>`;
    const dias = (x) => (x == null ? '—' : fm(x, 0) + ' días');
    return `<div class="grid g4" style="margin-bottom:14px">
        ${kpi('Ventas netas', usd(r.ventas_netas), `${r.ventas_n} ventas · ${usd(i.ventas_por_dia)} por día`)}
        ${kpi('Utilidad bruta', usd(r.utilidad_bruta), `margen ${i.margen_bruto_pct == null ? '—' : fm(i.margen_bruto_pct, 1) + '%'}`, signo(r.utilidad_bruta))}
        ${kpi('Utilidad neta (antes de impuestos)', usd(r.utilidad_neta), `margen ${i.margen_neto_pct == null ? '—' : fm(i.margen_neto_pct, 1) + '%'}`, signo(r.utilidad_neta))}
        ${kpi('Patrimonio', usd(b.patrimonio), 'activos − pasivos de hoy', signo(b.patrimonio))}
        ${kpi('Efectivo y bancos', usd(b.efectivo + b.bancos), `cajas ${usd(b.efectivo)} · bancos ${usd(b.bancos)}`)}
        ${kpi('Por cobrar', usd(b.cxc), b.cxc_vencida > 0.005 ? `vencido ${usd(b.cxc_vencida)}` : 'sin vencidos', b.cxc_vencida > 0.005 ? 'bad' : '')}
        ${kpi('Por pagar a proveedores', usd(b.cxp), b.cxp_vencida > 0.005 ? `vencido ${usd(b.cxp_vencida)}` : 'sin vencidos', b.cxp_vencida > 0.005 ? 'bad' : '')}
        ${kpi('Inventario', usd(b.inventario), `${dias(i.dias_inventario)} de venta`)}</div>
      ${i.alertas.length ? `<div class="card" style="margin-bottom:14px"><h2>Qué mirar</h2>${i.alertas.map((a) => `<div class="check ${a.nivel === 'mal' ? 'mal' : a.nivel === 'info' ? 'ok' : 'ojo'}"><span class="pt"></span><div style="flex:1">${e(a.texto)}</div></div>`).join('')}</div>` : ''}
      <div class="card" style="margin-bottom:14px"><h2>Ventas y utilidad</h2>${barras}</div>
      <div class="grid g2" style="align-items:start">
        <div class="card"><h2>Indicadores</h2><table><tbody>
          ${ind('Margen bruto', i.margen_bruto_pct == null ? '—' : fm(i.margen_bruto_pct, 1) + '%', 'Lo que queda de cada venta después del costo de la mercancía')}
          ${ind('Margen neto', i.margen_neto_pct == null ? '—' : fm(i.margen_neto_pct, 1) + '%', 'Lo que queda después de gastos, mermas y diferencias de caja')}
          ${ind('Ticket promedio', i.ticket_promedio == null ? '—' : usd(i.ticket_promedio), 'Venta promedio por cliente')}
          ${ind('Rotación de inventario (anual)', i.rotacion_inventario_anual == null ? '—' : fm(i.rotacion_inventario_anual, 1) + ' veces', 'Cuántas veces al año se vende y repone el inventario')}
          ${ind('Días de inventario', dias(i.dias_inventario), 'Cuánto dura la mercancía actual al ritmo de venta del período')}
          ${ind('Días de cobro', dias(i.dias_cobro), 'Tiempo promedio que tardas en cobrar lo que vendes a crédito')}
          ${ind('Días de pago', dias(i.dias_pago), 'Tiempo promedio que tardas en pagarle a proveedores')}
          ${ind('Razón corriente', i.razon_corriente == null ? 'sin deudas' : fm(i.razon_corriente, 2), 'Activos corrientes entre deudas; menos de 1 es riesgoso')}
          ${ind('Prueba ácida', i.prueba_acida == null ? 'sin deudas' : fm(i.prueba_acida, 2), 'Lo mismo sin contar el inventario')}
          ${ind('Capital de trabajo', usd(i.capital_trabajo), 'Activos corrientes menos deudas de corto plazo')}
          ${ind('Endeudamiento', i.endeudamiento_pct == null ? '—' : fm(i.endeudamiento_pct, 1) + '%', 'Qué parte de lo que tienes se debe a proveedores')}
          ${ind('Punto de equilibrio del período', i.punto_equilibrio == null ? '—' : usd(i.punto_equilibrio), 'Ventas que necesitas para cubrir los gastos del período')}
        </tbody></table></div>
        <div class="card"><h2>Utilidad por categoría</h2>${A.tabla([{ h: 'Categoría', f: (x) => e(x.categoria) }, { h: 'Ventas', n: 1, f: (x) => usd(x.ventas) }, { h: 'Utilidad', n: 1, f: (x) => num(x.utilidad) }, { h: 'Margen', n: 1, f: (x) => (x.margen_pct == null ? '—' : fm(x.margen_pct, 1) + '%') }], d.categorias, { vacio: 'Sin ventas en el período' })}
          <h2 style="margin-top:16px">Productos que más utilidad dejan</h2>${A.tabla([{ h: 'Producto', f: (x) => e(x.nombre) }, { h: 'Unid.', n: 1, f: (x) => fm(x.unidades, 0) }, { h: 'Utilidad', n: 1, f: (x) => num(x.utilidad) }, { h: 'Margen', n: 1, f: (x) => (x.margen_pct == null ? '—' : fm(x.margen_pct, 1) + '%') }], d.productos_top, { vacio: 'Sin ventas en el período' })}</div></div>`;
  }

  // ---------- Estado de resultados ----------
  function resultados(d) {
    const r = d.resultados;
    const fila = (txt, v, { negrita = false, sangria = 0, resta = false, pct: p = true, linea = false } = {}) =>
      `<tr style="${linea ? 'border-top:2px solid var(--line,#ccc);' : ''}${negrita ? 'font-weight:700;' : ''}"><td style="padding-left:${8 + sangria * 18}px">${resta ? '(−) ' : ''}${e(txt)}</td><td class="n">${negrita ? num(v) : usd(resta ? (-Math.abs(v) || 0) : v)}</td><td class="n muted">${p ? pc(v, r.ventas_netas) : ''}</td></tr>`;
    const nombresAj = { merma: 'Mermas', ajuste: 'Ajustes de inventario', consumo_interno: 'Consumo interno', ajuste_conteo: 'Diferencias de conteos cíclicos' };
    return `<div class="card"><h2>Estado de resultados</h2><div class="scroll"><table><thead><tr><th>Concepto</th><th class="n">USD</th><th class="n">% de ventas netas</th></tr></thead><tbody>
      ${fila('Ventas brutas', r.ventas_brutas)}${fila('Descuentos', r.descuentos, { resta: true })}${fila('Ventas netas', r.ventas_netas, { negrita: true, linea: true })}
      ${fila('Costo de la mercancía vendida', r.costo_ventas, { resta: true })}${fila('Utilidad bruta', r.utilidad_bruta, { negrita: true, linea: true })}
      ${r.ajustes_inventario.map((a) => fila(nombresAj[a.tipo] || a.tipo, a.valor, { sangria: 1 })).join('')}${fila('Ajustes y mermas de inventario', r.ajuste_inventario_total)}
      ${fila('Diferencias de caja (sobrantes y faltantes)', r.diferencias_caja)}
      <tr><td colspan="3" style="font-weight:700;padding-top:12px">Gastos operativos</td></tr>
      ${r.gastos.length ? r.gastos.map((g) => fila(g.categoria, g.monto, { sangria: 1, resta: true })).join('') : '<tr><td colspan="3" class="muted" style="padding-left:26px">No hay gastos registrados en el período (se cargan en la pestaña Gastos)</td></tr>'}
      ${fila('Total gastos operativos', r.gastos_total, { resta: true })}
      ${fila('Utilidad neta antes de impuestos', r.utilidad_neta, { negrita: true, linea: true })}
      </tbody></table></div></div>`;
  }

  // ---------- Balance general ----------
  function balance(d) {
    const b = d.balance;
    const f = (t, v, o = {}) => `<tr style="${o.linea ? 'border-top:2px solid var(--line,#ccc);' : ''}${o.negrita ? 'font-weight:700;' : ''}"><td style="padding-left:${8 + (o.sangria || 0) * 18}px">${e(t)}</td><td class="n">${o.negrita ? num(v) : usd(v)}</td></tr>`;
    const cuentas = (tipo) => b.cuentas.filter((c) => (tipo === 'caja' ? c.tipo === 'caja' : c.tipo !== 'caja')).map((c) => f(`${c.nombre}${c.moneda !== 'USD' ? ` (${A.mon(c.saldo, c.moneda)})` : ''}`, c.usd, { sangria: 2 })).join('');
    return `<div class="muted" style="margin-bottom:8px">Situación al ${e(b.a_la_fecha)} · tasa $ = Bs ${fm(b.tasa.usd_ves)} · € = $ ${fm(b.tasa.eur_usd, 4)}</div>
      <div class="grid g2" style="align-items:start">
        <div class="card"><h2>Activos</h2><table><tbody>
          <tr><td colspan="2" style="font-weight:700">Activos corrientes</td></tr>
          ${f('Efectivo en cajas', b.efectivo, { sangria: 1 })}${cuentas('caja')}${f('Bancos y cuentas digitales', b.bancos, { sangria: 1 })}${cuentas('banco')}
          ${f('Cuentas por cobrar a clientes', b.cxc, { sangria: 1 })}${f('Inventario de mercancía (a costo)', b.inventario, { sangria: 1 })}
          ${f('Total activos', b.activos_total, { negrita: true, linea: true })}</tbody></table></div>
        <div class="card"><h2>Pasivos y patrimonio</h2><table><tbody>
          <tr><td colspan="2" style="font-weight:700">Pasivos corrientes</td></tr>
          ${f('Cuentas por pagar a proveedores', b.cxp, { sangria: 1 })}${f('Total pasivos', b.pasivos_total, { negrita: true, linea: true })}
          <tr><td colspan="2" style="font-weight:700;padding-top:12px">Patrimonio</td></tr>
          ${f('Patrimonio del negocio (activos − pasivos)', b.patrimonio, { negrita: true })}
          ${f('Total pasivos + patrimonio', b.pasivos_total + b.patrimonio, { negrita: true, linea: true })}</tbody></table>
          <p class="muted" style="font-size:12px;margin-top:10px">Lo que te deben incluye ${usd(b.cxc_vencida)} vencido. De lo que debes, ${usd(b.cxp_vencida)} está vencido.</p></div></div>`;
  }

  // ---------- Flujo de caja ----------
  function flujo(d) {
    const fl = d.flujo;
    const f = (t, v, o = {}) => `<tr style="${o.linea ? 'border-top:2px solid var(--line,#ccc);' : ''}${o.negrita ? 'font-weight:700;' : ''}"><td>${e(t)}</td><td class="n">${num(v)}</td></tr>`;
    const oper = fl.lineas.filter((l) => l.grupo === 'operacion'), otros = fl.lineas.filter((l) => l.grupo === 'otros');
    const totOper = oper.reduce((a, l) => a + l.usd, 0);
    return `<div class="card"><h2>Flujo de caja (efectivo y bancos)</h2><table><tbody>
      ${f('Saldo al inicio del período (estimado)', fl.saldo_inicial, { negrita: true })}
      <tr><td colspan="2" style="font-weight:700;padding-top:10px">Actividad del negocio</td></tr>${oper.map((l) => f(l.concepto, l.usd)).join('')}${f('Flujo de la operación', totOper, { negrita: true, linea: true })}
      <tr><td colspan="2" style="font-weight:700;padding-top:10px">Otros</td></tr>${otros.map((l) => f(l.concepto, l.usd)).join('')}
      ${f('Flujo neto del período', fl.flujo_neto, { negrita: true, linea: true })}
      ${fl.efecto_tasa != null ? f('Efecto de la tasa de cambio sobre saldos en Bs y €', fl.efecto_tasa) : ''}
      ${f(fl.efecto_tasa != null ? 'Saldo de efectivo y bancos hoy' : 'Saldo al final del período (estimado)', fl.saldo_final, { negrita: true, linea: true })}</tbody></table>
      <p class="muted" style="font-size:12px;margin-top:10px">Entradas y salidas de dinero reales de tus cajas y bancos, sin importar cuándo se facturó. El efecto de la tasa aparece porque los bolívares se valoran con la tasa de hoy.</p></div>`;
  }

  // ---------- Gastos ----------
  async function gastos(box) {
    const [g, cuentas] = await Promise.all([api.get(`/api/gastos?desde=${per.desde}&hasta=${per.hasta}`), api.get('/api/cuentas')]);
    const activas = cuentas.filter((c) => c.activo);
    const puede = A.can('gastos.registrar');
    box.innerHTML = `<div class="card"><div class="topbar"><div><h2 style="margin:0">Gastos del período</h2><p class="muted" style="margin:4px 0 0">Alquiler, servicios, nómina, impuestos y demás gastos del negocio. Cada uno sale de una caja o banco y entra al estado de resultados.</p></div>${puede ? '<button class="btn pri" data-a="nuevo">+ Registrar gasto</button>' : ''}</div>
      <p><b>Total del período: ${usd(g.total_usd)}</b></p>
      ${A.tabla([{ h: 'Fecha', f: (x) => e(x.fecha) }, { h: 'Categoría', f: (x) => e(x.categoria) }, { h: 'Detalle', f: (x) => e([x.descripcion, x.beneficiario].filter(Boolean).join(' · ')) }, { h: 'Pagado desde', f: (x) => e(x.cuenta) },
        { h: 'Monto', n: 1, f: (x) => A.mon(x.monto, x.moneda) }, { h: 'USD', n: 1, f: (x) => usd(x.monto_usd) },
        { h: '', f: (x) => (x.anulado ? A.tag('anulado', 'bad') : puede ? `<button class="btn sm bad" data-a="anular" data-id="${x.id}">Anular</button>` : '') }], g.gastos, { vacio: 'No hay gastos registrados en este período' })}</div>`;
    A.acciones(box, {
      nuevo: () => A.form('Registrar gasto', [
        { n: 'fecha', l: 'Fecha', t: 'date', req: true }, { n: 'categoria', l: 'Categoría', t: 'select', o: g.categorias.map((c) => [c, c]) },
        { n: 'cuenta_id', l: 'Pagado desde', t: 'select', o: activas.map((c) => [c.id, `${c.nombre} (${c.moneda})`]) },
        { n: 'monto', l: 'Monto (en la moneda de esa cuenta)', t: 'number', req: true, min: 0.01 }, { n: 'beneficiario', l: 'Pagado a (opcional)' }, { n: 'referencia', l: 'N° de factura o referencia (opcional)' },
        { n: 'descripcion', l: 'Descripción', full: true }], { fecha: A.hoy(), categoria: g.categorias[0] },
      async (v) => {
        const c = activas.find((x) => x.id === +v.cuenta_id);
        await api.post('/api/gastos', { ...v, cuenta_id: +v.cuenta_id, moneda: c.moneda }); A.ok('Gasto registrado'); A.render();
      }),
      anular: async (el) => {
        const m = await A.pedirMotivo('Anular gasto'); if (!m) return;
        try { await api.post(`/api/gastos/${el.dataset.id}/anular`, { motivo: m }); A.ok('Gasto anulado'); A.render(); } catch (er) { A.fail(er); }
      }
    });
  }
})();
