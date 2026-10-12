'use strict';
// Vistas de compras, cuentas por pagar/cobrar, bancos y cajas, pedidos de la app.
(() => {
  const A = Abasto, { e, fm, usd, mon, api, S } = A;
  const $ = (s, r = document) => r.querySelector(s);

  // ---------- selector de ítems reutilizable (compras y pedidos de vendedor) ----------
  function itemsPicker(el, { modo }) {
    let items = [];
    el.innerHTML = `<div class="row"><div class="grow"><label>Agregar producto (nombre o código de barras)</label><input data-q autocomplete="off"></div></div><div class="pos-res" data-res hidden></div><div data-lista style="margin-top:10px"></div>`;
    const q = $('[data-q]', el), res = $('[data-res]', el), lista = $('[data-lista]', el);
    let found = [];
    function pintar() {
      lista.innerHTML = items.length ? A.tabla([{ h: 'Producto', f: (r) => `<b>${e(r.nombre)}</b>` },
        { h: modo === 'compra' ? `Cantidad (en unid. de compra)` : 'Cantidad', f: (r, i) => `<input data-i="${i}" data-k="cantidad" type="number" step="any" min="0" value="${r.cantidad}" style="width:90px"> <span class="muted">${e(modo === 'compra' ? r.unidad_compra : r.unidad_venta)}</span>` },
        modo === 'compra' ? { h: 'Costo por unid. de compra', f: (r, i) => `<input data-i="${i}" data-k="costo_unit" type="number" step="any" min="0" value="${r.costo_unit}" style="width:100px">` } : { h: 'Precio', n: 1, f: (r) => usd(r.precio_usd) },
        { h: 'Total', n: 1, f: (r) => modo === 'compra' ? fm(r.cantidad * r.costo_unit) : usd(r.cantidad * r.precio_usd) }, { h: '', f: (r, i) => `<button class="btn sm" data-del="${i}">✕</button>` }], items)
        : '<div class="empty">Sin productos</div>';
      lista.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { items.splice(+b.dataset.del, 1); pintar(); });
      lista.querySelectorAll('input[data-i]').forEach((inp) => inp.onchange = () => { items[+inp.dataset.i][inp.dataset.k] = parseFloat(inp.value) || 0; pintar(); });
    }
    q.oninput = A.debounce(async () => {
      const t = q.value.trim(); if (!t) { res.hidden = true; return; }
      found = (await api.get('/api/productos' + A.qs({ q: t, activo: 1 }))).slice(0, 10);
      res.hidden = !found.length;
      res.innerHTML = found.map((p, i) => `<div data-f="${i}"><span>${e(p.nombre)}</span><span class="muted">${modo === 'compra' ? 'costo ' + usd(p.costo_usd) : usd(p.precio_usd) + ' · disp. ' + fm(p.disponible, 0)}</span></div>`).join('');
      res.querySelectorAll('[data-f]').forEach((d) => d.onclick = () => add(found[+d.dataset.f]));
    }, 180);
    q.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (found[0]) add(found[0]); } };
    function add(p) {
      const ex = items.find((i) => i.producto_id === p.id);
      if (ex) ex.cantidad += 1; else items.push({ producto_id: p.id, nombre: p.nombre, cantidad: 1, costo_unit: +(p.costo_usd * p.factor).toFixed(4), precio_usd: p.precio_usd, unidad_compra: p.unidad_compra, unidad_venta: p.unidad_venta });
      q.value = ''; res.hidden = true; found = []; pintar(); q.focus();
    }
    pintar();
    return { get: () => items, set: (v) => { items = v; pintar(); } };
  }

  // ======================= COMPRAS =======================
  A.vistas.compras = async (root, arg) => {
    if (arg === 'nueva') return nuevaCompra(root);
    if (arg === 'sugerencias') return sugerencias(root);
    const rows = await api.get('/api/compras');
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Compras</h1><div class="chips"><a class="btn" href="#/compras/sugerencias">Sugerencias de compra</a>${A.can('compras.editar') ? '<a class="btn pri" href="#/compras/nueva">+ Nueva compra</a>' : ''}</div></div>
      <div class="card">${A.tabla([{ h: 'N°', f: (r) => e(r.numero) }, { h: 'Fecha', f: (r) => A.fecha(r.fecha) }, { h: 'Proveedor', f: (r) => e(r.proveedor) }, { h: 'Condición', f: (r) => e(r.condicion) }, { h: 'Moneda', f: (r) => e(r.moneda) },
        { h: 'Total', n: 1, f: (r) => mon(r.total_moneda, r.moneda) }, { h: 'Total USD', n: 1, f: (r) => r.estado === 'recibida' ? usd(r.total_usd) : '—' }, { h: 'Estado', f: (r) => (r.estado === 'borrador' ? A.tag('Orden de compra', 'warn') : A.estadoTag(r.estado)) }], rows, { clic: true, vacio: 'Aún no hay compras' })}</div>`;
    root.querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => detalle(rows[+tr.dataset.i].id));
    function imprimirOrden(c) {
      const w = window.open('', '_blank', 'width=820,height=700');
      if (!w) return A.toast('Permite las ventanas emergentes para imprimir', 'bad');
      const emp = S.empresa || {};
      w.document.write(`<html><head><title>Orden de compra ${e(c.numero)}</title><style>body{font:13px system-ui,sans-serif;margin:22px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #999;padding:7px;text-align:left}.n{text-align:right}.firmas{margin-top:40px;display:flex;gap:40px}.firmas div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}</style></head><body>
        ${emp.logo ? `<img src="${emp.logo}" style="max-height:60px;float:right">` : ''}<h2>Orden de compra ${e(c.numero)}</h2><div><b>${e(emp.nombre || '')}</b> ${emp.rif ? '· RIF ' + e(emp.rif) : ''} ${emp.telefono ? '· ' + e(emp.telefono) : ''}</div>
        <p>Proveedor: <b>${e(c.proveedor)}</b><br>Fecha: ${e(A.fecha(c.fecha))} · Condición: ${e(c.condicion)}${c.condicion === 'credito' ? ' (' + (c.dias_credito || 0) + ' días)' : ''} · Moneda: ${e(c.moneda)}${c.nota ? '<br>' + e(c.nota) : ''}</p>
        <table><thead><tr><th>Producto</th><th class="n">Cantidad</th><th>Presentación</th><th class="n">Unidades</th><th class="n">Costo unit.</th><th class="n">Total</th></tr></thead><tbody>${c.items.map((i) => `<tr><td>${e(i.nombre)}</td><td class="n"><b>${fm(i.cantidad, 0)}</b></td><td>${e(i.unidad_compra)}</td><td class="n">${fm(i.unidades, 0)}</td><td class="n">${fm(i.costo_unit)}</td><td class="n">${fm(i.cantidad * i.costo_unit)}</td></tr>`).join('')}</tbody></table>
        <p class="n" style="font-size:15px"><b>Total ${mon(c.total_moneda, c.moneda)}</b></p><div class="firmas"><div>Elaborado por</div><div>Aprobado por</div></div></body></html>`);
      w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
    }
    async function detalle(id) {
      const c = await api.get('/api/compras/' + id);
      const cuentas = (await api.get('/api/cuentas')).filter((x) => x.activo && x.moneda === c.moneda);
      A.modal((c.estado === 'borrador' ? 'Orden de compra ' : 'Compra ') + c.numero, `<p>${e(c.proveedor)} · ${A.fecha(c.fecha)} · ${A.estadoTag(c.estado)} · ${e(c.condicion)} · ${e(c.moneda)}${c.tasa && c.moneda !== 'USD' ? ' (tasa ' + fm(c.tasa, 4) + ')' : ''}</p>
        ${A.tabla([{ h: 'Producto', f: (i) => e(i.nombre) }, { h: 'Cant.', n: 1, f: (i) => fm(i.cantidad, 2) + ' ' + e(i.unidad_compra) }, { h: 'Unidades', n: 1, f: (i) => fm(i.unidades, 2) }, { h: 'Costo unit.', n: 1, f: (i) => fm(i.costo_unit) }, { h: 'Total', n: 1, f: (i) => fm(i.cantidad * i.costo_unit) }], c.items)}
        <p class="r"><b>Total ${mon(c.total_moneda, c.moneda)}</b>${c.estado === 'recibida' ? ` · ${usd(c.total_usd)}` : ''}</p>
        ${c.estado === 'borrador' && A.can('compras.editar') ? `<div class="card"><h3>Recibir mercancía</h3><div class="row"><div><label>Condición</label><select id="rc"><option value="contado" ${c.condicion === 'contado' ? 'selected' : ''}>Contado</option><option value="credito" ${c.condicion === 'credito' ? 'selected' : ''}>Crédito</option></select></div>
          <div id="rcont" class="row"><div><label>Medio</label><select id="rm"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="pago_movil">Pago móvil</option><option value="punto">Punto</option></select></div>
          <div><label>Cuenta de salida</label><select id="rcu">${cuentas.map((x) => `<option value="${x.id}">${e(x.nombre)} (${mon(x.saldo, x.moneda)})</option>`).join('')}</select></div><div><label>Referencia</label><input id="rr"></div></div>
          <div id="rcre" hidden><label>Días de crédito</label><input id="rd" type="number" value="${c.dias_credito || 0}"></div></div></div>` : ''}`,
        { ancho: true, pie: `<button class="btn" data-imp>Imprimir orden</button>${c.estado !== 'anulada' && A.can('compras.editar') ? '<button class="btn bad" data-an>Anular</button>' : ''}${c.estado === 'borrador' && A.can('compras.editar') ? '<button class="btn pri" data-rec>Recibir en inventario</button>' : ''}`, onMount: (v, cerrar) => {
          const rc = $('#rc', v); if (rc) { const sw = () => { $('#rcont', v).hidden = rc.value !== 'contado'; $('#rcre', v).hidden = rc.value === 'contado'; }; rc.onchange = sw; sw(); }
          const rec = $('[data-rec]', v); if (rec) rec.onclick = async () => { try {
            await api.post(`/api/compras/${id}/recibir`, { condicion: rc.value, medio: $('#rm', v).value, cuenta_id: +$('#rcu', v).value || undefined, referencia: $('#rr', v).value, dias_credito: +$('#rd', v).value }); A.ok('Compra recibida'); cerrar(); A.render(); } catch (er) { A.fail(er); } };
          $('[data-imp]', v).onclick = () => imprimirOrden(c);
          const an = $('[data-an]', v); if (an) an.onclick = async () => { const mo = await A.pedirMotivo('Motivo de la anulación'); if (!mo) return; try { await api.post(`/api/compras/${id}/anular`, { motivo: mo }); A.ok('Compra anulada'); cerrar(); A.render(); } catch (er) { A.fail(er); } };
        } });
    }
  };

  async function nuevaCompra(root) {
    const [provs, cuentas] = await Promise.all([api.get('/api/proveedores?activo=1'), api.get('/api/cuentas')]);
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Nueva compra</h1><a class="btn" href="#/compras">← Volver</a></div>
      <div class="card"><div class="row"><div class="grow"><label>Proveedor *</label><select id="pv">${provs.map((p) => `<option value="${p.id}" data-d="${p.dias_credito}">${e(p.nombre)}</option>`).join('')}</select></div>
      <div><label>Moneda de la factura</label><select id="mo"><option>USD</option><option>VES</option><option>EUR</option></select></div>
      <div><label>Condición</label><select id="co"><option value="contado">Contado</option><option value="credito">Crédito</option></select></div>
      <div id="bloque-ct" class="row"><div><label>Medio</label><select id="me"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="pago_movil">Pago móvil</option></select></div><div><label>Cuenta</label><select id="cu"></select></div><div><label>Referencia</label><input id="re"></div></div>
      <div id="bloque-cr" hidden><label>Días de crédito</label><input id="dc" type="number" min="0" value="${provs[0] ? provs[0].dias_credito : 0}" style="width:110px"></div></div></div>
      <div class="card" id="items"></div><div class="card"><label>Nota</label><input id="nt"></div>
      <div class="chips"><button class="btn" data-a="borrador">Guardar como borrador (orden de compra)</button><button class="btn pri" data-a="recibir">Guardar y recibir mercancía</button></div>`;
    const picker = itemsPicker($('#items', root), { modo: 'compra' });
    const refrescarCuentas = () => { $('#cu', root).innerHTML = cuentas.filter((c) => c.activo && c.moneda === $('#mo', root).value && (c.tipo !== 'caja' || $('#me', root).value === 'efectivo') && (c.tipo === 'caja') === ($('#me', root).value === 'efectivo')).map((c) => `<option value="${c.id}">${e(c.nombre)} (${mon(c.saldo, c.moneda)})</option>`).join('') || '<option value="">Sin cuenta en esta moneda</option>'; };
    const sw = () => { $('#bloque-ct', root).hidden = $('#co', root).value !== 'contado'; $('#bloque-cr', root).hidden = $('#co', root).value === 'contado'; refrescarCuentas(); };
    ['mo', 'co', 'me'].forEach((id) => $('#' + id, root).onchange = sw);
    $('#pv', root).onchange = () => { $('#dc', root).value = $('#pv', root).selectedOptions[0].dataset.d; };
    sw();
    const guardar = async (recibir) => {
      const items = picker.get().map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad, costo_unit: i.costo_unit }));
      const r = await api.post('/api/compras', { proveedor_id: +$('#pv', root).value, moneda: $('#mo', root).value, condicion: $('#co', root).value, medio: $('#me', root).value, cuenta_id: +$('#cu', root).value || undefined, referencia: $('#re', root).value, dias_credito: +$('#dc', root).value, nota: $('#nt', root).value, items, recibir });
      A.ok(recibir ? 'Compra recibida: inventario actualizado' : 'Borrador guardado'); A.ir('compras');
      return r;
    };
    A.acciones(root, { borrador: () => guardar(false), recibir: () => guardar(true) });
  }

  async function sugerencias(root) {
    const a = await api.get('/api/compras/analisis');
    const ordenes = (await api.get('/api/compras?estado=borrador')).length;
    const f1 = (n) => (n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }));
    const NIV = { agotado: ['bad', 'Agotado'], critico: ['bad', 'Crítico'], reponer: ['warn', 'Reponer'], planificar: ['info', 'Planificar'], sobrestock: ['', 'Sobrestock'], sin_movimiento: ['', 'Sin movimiento'] };
    const ahora = a.filas.filter((x) => ['agotado', 'critico', 'reponer'].includes(x.nivel));
    const plan = a.filas.filter((x) => x.nivel === 'planificar');
    const inm = a.filas.filter((x) => ['sobrestock', 'sin_movimiento'].includes(x.nivel));
    const porId = new Map(a.filas.map((x) => [x.id, x]));
    const tend = (x) => (x.tendencia == null ? '' : x.tendencia >= 0.25 ? ` <span class="ok" title="Ventas en alza frente al mes">▲${Math.round(x.tendencia * 100)}%</span>` : x.tendencia <= -0.25 ? ` <span class="bad" title="Ventas en baja frente al mes">▼${Math.abs(Math.round(x.tendencia * 100))}%</span>` : '');
    const fila = (x, marcado) => `<tr><td><input type="checkbox" data-sel="${x.id}" ${marcado ? 'checked' : ''} ${x.proveedor_id ? '' : 'disabled title="Asígnale un proveedor principal al producto"'}></td>
      <td><b>${e(x.nombre)}</b><div class="muted" style="font-size:11px;max-width:430px">${e(x.motivo)}${x.fiable ? '' : ' <i>(poco historial: estimación aproximada)</i>'}</div></td>
      <td>${A.tag(NIV[x.nivel][1], NIV[x.nivel][0])}</td><td class="n">${fm(x.stock, 0)}${x.pendiente ? `<div class="muted" style="font-size:11px">+${fm(x.pendiente, 0)} pedidas</div>` : ''}</td>
      <td class="n">${f1(x.venta_dia)}${tend(x)}</td><td class="n">${x.cobertura_dias == null ? '—' : f1(x.cobertura_dias) + ' d'}</td><td class="n">${fm(x.punto_pedido, 0)}</td>
      <td style="white-space:nowrap"><input data-cant="${x.id}" type="number" min="0" step="any" value="${x.sugerido_compra}" style="width:76px"> ${e(x.unidad_compra)}${x.factor > 1 ? `<div class="muted" style="font-size:11px">${fm(x.factor, 0)} u c/u</div>` : ''}</td><td class="n" data-costo="${x.id}">${usd(x.costo_estimado)}</td></tr>`;
    const grupos = (lista, marcado) => {
      const porProv = new Map();
      lista.forEach((x) => { const k = x.proveedor_id || 0; if (!porProv.has(k)) porProv.set(k, []); porProv.get(k).push(x); });
      return `<div class="scroll"><table><thead><tr><th></th><th>Producto y razón</th><th>Prioridad</th><th class="n">Existencia</th><th class="n">Ventas/día</th><th class="n">Alcanza</th><th class="n">Punto de pedido</th><th>Cantidad a pedir</th><th class="n">Costo est.</th></tr></thead><tbody>
        ${[...porProv.entries()].map(([k, l]) => `<tr><td colspan="9" style="background:var(--bg)"><b>${k ? e(l[0].proveedor) : 'Sin proveedor principal'}</b> <span class="muted">${k ? `· entrega en ${l[0].plazo} día(s)` : '· no se puede generar la orden'} · ${l.length} producto(s) · ${usd(l.reduce((s, x) => s + x.costo_estimado, 0))}</span></td></tr>${l.map((x) => fila(x, marcado)).join('')}`).join('')}</tbody></table></div>`;
    };
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Sugerencias de compra</h1><div class="chips"><a class="btn" href="#/compras">← Compras</a><a class="btn" href="#/parametros/operacion">Parámetros</a></div></div>
      ${ordenes ? `<div class="semaforo amarillo" style="margin-bottom:14px"><span class="luz"></span><span style="flex:1">Tienes <b>${ordenes} orden(es) de compra</b> creadas y pendientes de recibir. Lo que ya pediste no se vuelve a sugerir.</span><a class="btn sm" href="#/compras">Ver órdenes</a></div>` : ''}
      <div class="grid g4" style="margin-bottom:14px"><div class="kpi"><div class="l">Productos a reponer</div><div class="v">${a.resumen.reponer}</div><div class="s">${a.resumen.planificar} más para planificar</div></div>
        <div class="kpi"><div class="l">En riesgo de agotarse antes de recibir</div><div class="v ${a.resumen.en_riesgo ? 'bad' : ''}">${a.resumen.en_riesgo}</div><div class="s">agotados o críticos</div></div>
        <div class="kpi"><div class="l">Inversión sugerida</div><div class="v">${usd(a.resumen.inversion_usd)}</div><div class="s">solo lo que hay que reponer</div></div>
        <div class="kpi"><div class="l">Capital inmovilizado</div><div class="v">${usd(a.resumen.inmovilizado_usd)}</div><div class="s">sobrestock o sin ventas</div></div></div>
      <details class="card" style="padding:10px 16px"><summary style="cursor:pointer"><b>¿Cómo se calcula?</b> <span class="muted">(ventas, plazo del proveedor y margen de seguridad, no solo el mínimo)</span></summary>
        <ul style="margin:10px 0 0;padding-left:18px;line-height:1.6"><li><b>Ventas por día:</b> mezcla de los últimos 7 días (50 %), 30 días (30 %) y 90 días (20 %), así reacciona a los cambios sin dejarse engañar por un día raro. Con menos de 7 días de historial se divide entre 7.</li>
          <li><b>Alcanza:</b> existencia ÷ ventas por día.</li><li><b>Margen de seguridad:</b> cubre la irregularidad de las ventas durante el plazo del proveedor; mayor en los productos A (97,5 % de servicio) que en los B (95 %) y C (90 %).</li>
          <li><b>Punto de pedido:</b> ventas/día × plazo de entrega + margen de seguridad. Nunca menos que tu stock mínimo.</li>
          <li><b>Objetivo:</b> ventas/día × (plazo + ${a.parametros.ciclo_dias} días de ciclo de compra) + seguridad. Nunca menos que tu stock máximo ni más de ${a.parametros.cobertura_max_dias} días de venta.</li>
          <li><b>Cantidad:</b> objetivo − (existencia − reservado por la app + pedidos en borrador), en cajas completas.</li><li>El plazo de entrega se define en <a href="#/proveedores">Proveedores</a>; el ciclo y la cobertura máxima, en <a href="#/parametros/operacion">Parámetros › Operación</a>.</li></ul></details>
      <div class="card"><div class="topbar"><h2 style="margin:0">Reponer ahora (${ahora.length})</h2><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><span class="muted" id="tot"></span><button class="btn pri" data-a="crear">Generar orden de compra</button></div></div>${ahora.length ? grupos(ahora, true) : '<div class="empty">Nada urgente: con lo que se vende y lo que tarda cada proveedor, el inventario aguanta hasta el próximo pedido ✔</div>'}</div>
      ${plan.length ? `<div class="card"><h2>Planificar para el próximo pedido (${plan.length})</h2><p class="muted" style="margin-top:-4px">Aún alcanzan, pero se acabarían antes de que llegue el siguiente pedido si esperas. Márcalos si quieres incluirlos ya.</p>${grupos(plan, false)}</div>` : ''}
      ${inm.length ? `<div class="card"><h2>No compres: capital inmovilizado (${inm.length})</h2>${A.tabla([{ h: 'Producto y razón', f: (x) => `<b>${e(x.nombre)}</b><div class="muted" style="font-size:11px;max-width:520px">${e(x.motivo)}</div>` }, { h: 'Estado', f: (x) => A.tag(NIV[x.nivel][1], '') }, { h: 'Existencia', n: 1, f: (x) => fm(x.stock, 0) }, { h: 'Ventas/día', n: 1, f: (x) => f1(x.venta_dia) }, { h: 'Capital', n: 1, f: (x) => usd(x.capital_usd) }], inm)}<p class="muted" style="margin-bottom:0">Ideas: promoción, rebaja de precio o devolución al proveedor.</p></div>` : ''}
      ${ahora.length || plan.length ? '<div style="position:sticky;bottom:0;background:var(--bg);padding:10px 0;display:flex;gap:14px;align-items:center;justify-content:flex-end;flex-wrap:wrap"><span class="muted" id="tot2"></span><button class="btn pri lg" data-a="crear">Generar orden de compra de lo marcado</button></div>' : ''}`;
    const seleccion = () => [...root.querySelectorAll('[data-sel]')].filter((c) => c.checked).map((c) => ({ x: porId.get(+c.dataset.sel), cant: +root.querySelector(`[data-cant="${c.dataset.sel}"]`).value || 0 }));
    const recalcular = () => {
      root.querySelectorAll('[data-cant]').forEach((i) => { const x = porId.get(+i.dataset.cant); const cell = root.querySelector(`[data-costo="${i.dataset.cant}"]`); if (cell) cell.textContent = usd((+i.value || 0) * x.factor * x.costo_usd); });
      const t = seleccion().reduce((s, r) => s + r.cant * r.x.factor * r.x.costo_usd, 0), el = $('#tot', root), el2 = $('#tot2', root); if (el) el.innerHTML = `Marcado: <b>${usd(t)}</b>`; if (el2) el2.innerHTML = `Marcado: <b>${usd(t)}</b>`;
    };
    root.addEventListener('input', recalcular); root.addEventListener('change', recalcular); recalcular();
    A.acciones(root, { crear: async () => {
      const sel = seleccion().filter((r) => r.cant > 0);
      if (!sel.length) return A.toast('Marca al menos un producto con cantidad mayor a cero', 'bad');
      const porProv = new Map();
      sel.forEach((r) => { const k = r.x.proveedor_id; if (!porProv.has(k)) porProv.set(k, { nombre: r.x.proveedor, plazo: r.x.plazo, l: [] }); porProv.get(k).l.push(r); });
      const costo = (l) => l.reduce((s, r) => s + r.cant * r.x.factor * r.x.costo_usd, 0);
      A.modal('Generar orden de compra', `<p>Se crearán <b>${porProv.size} orden(es) de compra</b> en borrador, una por proveedor. Podrás imprimirlas para enviárselas y, cuando llegue la mercancía, recibirlas en el inventario.</p>
        ${[...porProv.values()].map((g) => `<div class="card" style="margin:0 0 10px"><b>${e(g.nombre)}</b> <span class="muted">· entrega en ${g.plazo} día(s) · ${usd(costo(g.l))}</span><ul style="margin:6px 0 0;padding-left:18px">${g.l.map((r) => `<li>${fm(r.cant, 0)} ${e(r.x.unidad_compra)} de ${e(r.x.nombre)} <span class="muted">(${fm(r.cant * r.x.factor, 0)} unidades)</span></li>`).join('')}</ul></div>`).join('')}
        <p class="r" style="margin:0"><b>Total estimado ${usd(costo(sel))}</b></p>`, { ancho: true, pie: '<button class="btn" data-n>Volver</button><button class="btn pri" data-s>Crear orden de compra</button>', onMount: (m, cerrar) => {
        $('[data-n]', m).onclick = cerrar;
        $('[data-s]', m).onclick = async () => {
          try { const r = await api.post('/api/compras/desde-sugerencias', { items: sel.map((x) => ({ producto_id: x.x.id, cantidad_compra: x.cant })) }); cerrar(); A.ok(`${r.ids.length} orden(es) de compra creadas. Ya puedes imprimirlas o recibirlas.`); A.ir('compras'); }
          catch (er) { A.fail(er); }
        };
      } });
    } });
  }

  // ======================= CxP =======================
  // Pago de una factura (se usa desde la lista y desde el estado de cuenta del proveedor)
  async function pagarFactura(f, alTerminar) {
    const cuentas = (await api.get('/api/cuentas')).filter((x) => x.activo);
    if (!cuentas.length) throw new Error('No hay cuentas activas para pagar. Créalas en Parámetros › Bancos y cajas.');
    const j = S.jornada;
    const equiv = j ? `Equivale a ${usd(f.saldo_usd)} = ${A.ves(f.saldo_usd * j.tasa_usd_ves)} = € ${fm(f.saldo_usd / j.tasa_eur_usd)} con la tasa del día` : 'Abre el día para registrar pagos';
    const porDefecto = cuentas.find((x) => x.moneda === 'USD' && x.tipo === 'caja') || cuentas[0];
    return A.form('Pagar a ' + f.proveedor, [
      { n: 'cuenta_id', l: 'Pagar desde la cuenta (la moneda del pago es la de la cuenta)', t: 'select', o: cuentas.map((x) => [x.id, `${x.nombre} (${x.moneda}) — saldo ${mon(x.saldo, x.moneda)}`]) },
      { n: 'monto', l: `Monto en la moneda de la cuenta (saldo de ${f.compra || 'la factura'}: ${usd(f.saldo_usd)})`, t: 'number', req: true, min: 0.01, ayuda: equiv }, { n: 'referencia', l: 'Referencia' }],
      { cuenta_id: porDefecto.id, monto: porDefecto.moneda === 'USD' ? f.saldo_usd : '' },
      async (x) => { const c = cuentas.find((k) => k.id === +x.cuenta_id); await api.post(`/api/cxp/${f.id}/pagar`, { moneda: c.moneda, monto: x.monto, cuenta_id: c.id, referencia: x.referencia }); A.ok('Pago registrado'); alTerminar(); });
  }

  // Estado de cuenta del proveedor: deuda, antigüedad, facturas con sus pagos y movimientos con saldo acumulado
  A.estadoCuentaProveedor = async (id) => {
    const d = await api.get(`/api/proveedores/${id}/estado-cuenta`);
    const r = d.resumen, p = d.proveedor, ant = r.antiguedad;
    const diasTxt = (f) => (f ? A.fecha(f).slice(0, 10) : '—');
    const abiertas = d.facturas.filter((x) => ['pendiente', 'abonada'].includes(x.estado));
    const TIPO = { cargo: ['warn', 'Compra a crédito'], pago: ['ok', 'Pago'], reverso: ['bad', 'Anulación'], contado: ['', 'Compra de contado'] };
    const filasMov = d.movimientos.slice().reverse(); // lo más reciente arriba
    const html = `<p class="muted" style="margin-top:0">${[p.rif && 'RIF ' + e(p.rif), p.telefono && e(p.telefono), p.contacto && 'Contacto: ' + e(p.contacto), `Crédito ${p.dias_credito} días`, `Entrega en ${p.plazo_entrega} días`, p.activo ? '' : 'INACTIVO'].filter(Boolean).join(' · ')}</p>
      <div class="grid g4" style="margin-bottom:12px"><div class="kpi"><div class="l">Deuda actual</div><div class="v ${r.deuda_usd > 0 ? 'warn' : 'ok'}">${usd(r.deuda_usd)}</div><div class="s">${r.facturas_abiertas} factura(s) abierta(s)</div></div>
        <div class="kpi"><div class="l">Vencida</div><div class="v ${r.vencida_usd > 0 ? 'bad' : ''}">${usd(r.vencida_usd)}</div><div class="s">vence en 7 días: ${usd(r.por_vencer_7d_usd)}</div></div>
        <div class="kpi"><div class="l">Pagado en total</div><div class="v">${usd(r.pagado_usd)}</div><div class="s">${r.dias_promedio_pago == null ? 'aún sin facturas pagadas' : r.dias_promedio_pago < 1 ? 'suele pagar el mismo día' : 'paga en ' + fm(r.dias_promedio_pago, 0) + ' día(s) en promedio'}</div></div>
        <div class="kpi"><div class="l">Compras</div><div class="v">${usd(r.compras_credito_usd + r.compras_contado_usd)}</div><div class="s">a crédito ${usd(r.compras_credito_usd)} · contado ${usd(r.compras_contado_usd)}</div></div></div>
      <div class="card" style="margin-bottom:12px"><b>Antigüedad de la deuda</b><div class="grid g4" style="margin-top:8px"><div>Vigente<br><b>${usd(ant.vigente)}</b></div><div>1 a 30 días vencida<br><b class="${ant.d1_30 ? 'warn' : ''}">${usd(ant.d1_30)}</b></div><div>31 a 60 días<br><b class="${ant.d31_60 ? 'bad' : ''}">${usd(ant.d31_60)}</b></div><div>Más de 60 días<br><b class="${ant.d60_mas ? 'bad' : ''}">${usd(ant.d60_mas)}</b></div></div>
        <div class="muted" style="margin-top:8px;font-size:12px">Última compra: ${diasTxt(r.ultima_compra)} · Último pago: ${diasTxt(r.ultimo_pago)}</div></div>
      <h3>Facturas</h3>${A.tabla([{ h: 'Compra', f: (x) => e(x.compra || '') }, { h: 'Fecha', f: (x) => diasTxt(x.creado) }, { h: 'Vence', f: (x) => `<span class="${x.dias_vencida ? 'bad' : ''}">${e(x.vence)}${x.dias_vencida ? ` (${x.dias_vencida} d de atraso)` : ''}</span>` },
        { h: 'Total', n: 1, f: (x) => usd(x.total_usd) }, { h: 'Pagado', n: 1, f: (x) => usd(x.pagado_usd) }, { h: 'Saldo', n: 1, f: (x) => `<b>${usd(x.saldo_usd)}</b>` }, { h: 'Estado', f: (x) => A.estadoTag(x.estado) },
        { h: 'Pagos', f: (x) => (x.pagos.length ? x.pagos.map((g) => `<div style="font-size:12px">${diasTxt(g.fecha)} · ${mon(g.monto, g.moneda)}${g.moneda !== 'USD' ? ` (${usd(g.monto_usd)})` : ''}${g.referencia ? ' · ref. ' + e(g.referencia) : ''}</div>`).join('') : '<span class="muted">—</span>') },
        { h: '', f: (x, i) => (['pendiente', 'abonada'].includes(x.estado) && A.can('cxp.pagar') ? `<button class="btn sm pri" data-pg="${x.id}">Pagar</button>` : '') }], d.facturas, { vacio: 'Este proveedor no tiene facturas a crédito' })}
      <h3 style="margin-top:14px">Movimientos</h3>${A.tabla([{ h: 'Fecha', f: (m) => A.fecha(m.fecha) }, { h: 'Documento', f: (m) => e(m.doc || '') }, { h: 'Concepto', f: (m) => A.tag(TIPO[m.tipo][1], TIPO[m.tipo][0]) + ' <span class="muted" style="font-size:12px">' + e(m.detalle) + '</span>' },
        { h: 'Cargo (deuda)', n: 1, f: (m) => (m.cargo ? usd(m.cargo) : '') }, { h: 'Abono', n: 1, f: (m) => (m.abono ? `<span class="ok">${usd(m.abono)}</span>` : '') }, { h: 'Saldo', n: 1, f: (m) => (m.tipo === 'contado' ? '<span class="muted">' + usd(m.monto_info) + '</span>' : `<b>${usd(m.saldo)}</b>`) }], filasMov, { vacio: 'Sin movimientos' })}
      <p class="muted" style="font-size:12px">Las compras de contado se muestran como referencia y no afectan el saldo. Montos en USD a la tasa del día de cada operación.</p>`;
    A.modal('Estado de cuenta — ' + p.nombre, html, { ancho: true, pie: '<button class="btn" data-csv>Exportar CSV</button><button class="btn pri" data-imp>Imprimir estado de cuenta</button>', onMount: (v, cerrar) => {
      v.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => {
        const x = d.facturas.find((f) => f.id === +b.dataset.pg);
        pagarFactura({ ...x, proveedor: p.nombre }, () => { cerrar(); A.render(); A.estadoCuentaProveedor(id).catch(A.fail); }).catch(A.fail);
      });
      $('[data-csv]', v).onclick = () => A.descargarCSV(`estado-cuenta-${p.nombre.replace(/\W+/g, '-')}.csv`, [['fecha', 'documento', 'tipo', 'detalle', 'cargo_usd', 'abono_usd', 'saldo_usd'], ...d.movimientos.map((m) => [m.fecha, m.doc, TIPO[m.tipo][1], m.detalle, m.cargo || '', m.abono || '', m.tipo === 'contado' ? '' : m.saldo])]);
      $('[data-imp]', v).onclick = () => {
        const w = window.open('', '_blank', 'width=900,height=750');
        if (!w) return A.toast('Permite las ventanas emergentes para imprimir', 'bad');
        const emp = S.empresa || {};
        w.document.write(`<html><head><title>Estado de cuenta ${e(p.nombre)}</title><style>body{font:12px system-ui,sans-serif;margin:20px}h2{margin:0}table{width:100%;border-collapse:collapse;margin:8px 0 14px}th,td{border-bottom:1px solid #aaa;padding:5px 6px;text-align:left}.n{text-align:right}</style></head><body>
          ${emp.logo ? `<img src="${emp.logo}" style="max-height:60px;float:right">` : ''}<h2>Estado de cuenta del proveedor</h2><div>${e(emp.nombre || '')} · ${e(A.fecha(new Date().toISOString().replace('T', ' ')))}</div><p><b>${e(p.nombre)}</b> ${p.rif ? '· RIF ' + e(p.rif) : ''}<br>Deuda actual: <b>${usd(r.deuda_usd)}</b> · vencida ${usd(r.vencida_usd)} · pagado en total ${usd(r.pagado_usd)}</p>
          <table><thead><tr><th>Compra</th><th>Vence</th><th class="n">Total</th><th class="n">Pagado</th><th class="n">Saldo</th><th>Estado</th></tr></thead><tbody>${abiertas.map((x) => `<tr><td>${e(x.compra || '')}</td><td>${e(x.vence)}</td><td class="n">${usd(x.total_usd)}</td><td class="n">${usd(x.pagado_usd)}</td><td class="n"><b>${usd(x.saldo_usd)}</b></td><td>${e(x.estado)}</td></tr>`).join('') || '<tr><td colspan="6">Sin facturas abiertas</td></tr>'}</tbody></table>
          <table><thead><tr><th>Fecha</th><th>Documento</th><th>Concepto</th><th class="n">Cargo</th><th class="n">Abono</th><th class="n">Saldo</th></tr></thead><tbody>${d.movimientos.filter((m) => m.tipo !== 'contado').map((m) => `<tr><td>${e(A.fecha(m.fecha))}</td><td>${e(m.doc || '')}</td><td>${e(TIPO[m.tipo][1])} — ${e(m.detalle)}</td><td class="n">${m.cargo ? usd(m.cargo) : ''}</td><td class="n">${m.abono ? usd(m.abono) : ''}</td><td class="n">${usd(m.saldo)}</td></tr>`).join('')}</tbody></table></body></html>`);
        w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
      };
    } });
  };

  A.vistas.cxp = async (root) => {
    const [rows, prov] = await Promise.all([api.get('/api/cxp?estado=abiertas'), api.get('/api/cxp/resumen')]);
    const hoy = A.hoy();
    const dif = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
    const total = rows.reduce((a, r) => a + r.saldo_usd, 0), vencido = rows.filter((r) => r.vencida).reduce((a, r) => a + r.saldo_usd, 0);
    const en7 = rows.filter((r) => !r.vencida && dif(r.vence, hoy) <= 7).reduce((a, r) => a + r.saldo_usd, 0);
    root.innerHTML = `<h1>Cuentas por pagar</h1>
      <div class="grid g4" style="margin-bottom:14px"><div class="kpi"><div class="l">Total por pagar</div><div class="v">${usd(total)}</div><div class="s">${rows.length} factura(s) abierta(s)</div></div>
        <div class="kpi"><div class="l">Vencido</div><div class="v ${vencido > 0 ? 'bad' : ''}">${usd(vencido)}</div></div><div class="kpi"><div class="l">Vence en 7 días</div><div class="v ${en7 > 0 ? 'warn' : ''}">${usd(en7)}</div></div>
        <div class="kpi"><div class="l">Proveedores con deuda</div><div class="v">${prov.length}</div></div></div>
      <div class="card"><h2>Deuda por proveedor</h2>${A.tabla([{ h: 'Proveedor', f: (r) => `<a href="#" data-a="ec" data-p="${r.id}"><b>${e(r.nombre)}</b></a>${r.telefono ? `<div class="muted" style="font-size:11px">${e(r.telefono)}</div>` : ''}` }, { h: 'Facturas', n: 1, f: (r) => r.facturas },
        { h: 'Deuda', n: 1, f: (r) => `<b>${usd(r.deuda)}</b>` }, { h: 'Vencida', n: 1, f: (r) => (r.vencida > 0 ? `<b class="bad">${usd(r.vencida)}</b>` : '—') }, { h: 'Próximo vencimiento', f: (r) => `<span class="${r.proxima_vence < hoy ? 'bad' : ''}">${e(r.proxima_vence)}</span>` },
        { h: 'Último pago', f: (r) => (r.ultimo_pago ? A.fecha(r.ultimo_pago).slice(0, 10) : '<span class="muted">nunca</span>') }, { h: '', f: (r) => `<button class="btn sm" data-a="ec" data-p="${r.id}">Estado de cuenta</button>` }], prov, { vacio: 'No hay deudas con proveedores 🎉' })}</div>
      <div class="card"><h2>Facturas por pagar</h2>${A.tabla([{ h: 'Proveedor', f: (r) => `<a href="#" data-a="ec" data-p="${r.proveedor_id}">${e(r.proveedor)}</a>` }, { h: 'Compra', f: (r) => e(r.compra || '') }, { h: 'Fecha', f: (r) => A.fecha(r.creado).slice(0, 10) },
        { h: 'Vence', f: (r) => `<span class="${r.vencida ? 'bad' : ''}">${e(r.vence)}${r.vencida ? ` (${dif(hoy, r.vence)} d)` : ''}</span>` }, { h: 'Total', n: 1, f: (r) => usd(r.total_usd) }, { h: 'Pagado', n: 1, f: (r) => usd(r.total_usd - r.saldo_usd) },
        { h: 'Saldo', n: 1, f: (r) => `<b>${usd(r.saldo_usd)}</b>` }, { h: 'Estado', f: (r) => A.estadoTag(r.estado) }, { h: '', f: (r, i) => (A.can('cxp.pagar') ? `<button class="btn sm pri" data-a="pagar" data-i="${i}">Pagar</button>` : '') }], rows, { vacio: 'No hay facturas pendientes' })}</div>`;
    A.acciones(root, {
      ec: (el, ev) => { ev.preventDefault(); return A.estadoCuentaProveedor(+el.dataset.p); },
      pagar: (el) => pagarFactura(rows[+el.dataset.i], () => A.render())
    });
  };

  // ======================= CxC =======================
  A.vistas.cxc = async (root, arg) => {
    const [rows, cuentas] = await Promise.all([api.get('/api/cxc' + A.qs({ estado: 'abiertas', cliente_id: arg })), api.get('/api/cuentas')]);
    const total = rows.reduce((a, r) => a + r.saldo_usd, 0), venc = rows.filter((r) => r.vencida).reduce((a, r) => a + r.saldo_usd, 0);
    root.innerHTML = `<h1>Cuentas por cobrar ${arg ? '<a class="btn sm" href="#/cxc">ver todas</a>' : ''}</h1><div class="grid g3" style="margin-bottom:14px"><div class="kpi"><div class="l">Por cobrar</div><div class="v">${usd(total)}</div></div><div class="kpi"><div class="l">Vencido</div><div class="v bad">${usd(venc)}</div></div></div>
      <div class="card">${A.tabla([{ h: 'Cliente', f: (r) => e(r.cliente) }, { h: 'Venta', f: (r) => e(r.venta || '') }, { h: 'Vence', f: (r) => `<span class="${r.vencida ? 'bad' : ''}">${e(r.vence)}</span>` }, { h: 'Total', n: 1, f: (r) => usd(r.total_usd) }, { h: 'Saldo', n: 1, f: (r) => `<b>${usd(r.saldo_usd)}</b>` }, { h: 'Estado', f: (r) => A.estadoTag(r.estado) },
        { h: '', f: (r, i) => A.can('cobros.crear') ? `<button class="btn sm pri" data-a="cobrar" data-i="${i}">Cobrar</button>` : '' }], rows, { vacio: 'Sin cuentas por cobrar' })}</div>`;
    A.acciones(root, { cobrar: (el) => { const c = rows[+el.dataset.i]; const bancos = cuentas.filter((x) => x.activo && x.tipo !== 'caja');
      return A.form('Cobrar a ' + c.cliente, [{ n: 'medio', l: 'Medio', t: 'select', o: [['efectivo', 'Efectivo'], ['pago_movil', 'Pago móvil'], ['transferencia', 'Transferencia'], ['punto', 'Punto']] }, { n: 'moneda', l: 'Moneda', t: 'select', o: [['USD', 'USD'], ['VES', 'Bs'], ['EUR', 'EUR']] },
        { n: 'monto', l: `Monto recibido (saldo ${usd(c.saldo_usd)})`, t: 'number', req: true, min: 0.01 }, { n: 'cuenta_id', l: 'Banco receptor (si no es efectivo)', t: 'select', o: [['', '—'], ...bancos.map((x) => [x.id, `${x.nombre} (${x.moneda})`])] }, { n: 'referencia', l: 'Referencia (si no es efectivo)' }],
        { medio: 'efectivo', moneda: 'USD', monto: c.saldo_usd }, async (v) => { await api.post(`/api/cxc/${c.id}/cobrar`, { pagos: [{ ...v, cuenta_id: v.cuenta_id ? +v.cuenta_id : undefined }] }); A.ok('Cobro registrado'); A.render(); }); } });
  };

  // ======================= BANCOS Y CAJAS =======================
  A.vistas.cuentas = async (root) => {
    const cuentas = await api.get('/api/cuentas');
    const porMoneda = {}; cuentas.filter((c) => c.activo).forEach((c) => { porMoneda[c.moneda] = (porMoneda[c.moneda] || 0) + c.saldo; });
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Bancos y cajas de efectivo</h1>${A.can('cuentas.operar') ? '<button class="btn pri" data-a="transferir">Transferencia interna</button>' : ''}</div>
      <div class="grid g4" style="margin-bottom:14px">${Object.entries(porMoneda).map(([m, v]) => `<div class="kpi"><div class="l">Total en ${m}</div><div class="v">${mon(v, m)}</div></div>`).join('')}</div>
      <div class="card">${A.tabla([{ h: 'Cuenta', f: (r) => `<b>${e(r.nombre)}</b> ${r.activo ? '' : A.tag('inactiva', 'bad')}` }, { h: 'Tipo', f: (r) => e(r.tipo) }, { h: 'Moneda', f: (r) => e(r.moneda) }, { h: 'N° cuenta', f: (r) => e(r.numero || '') }, { h: 'Saldo', n: 1, f: (r) => `<b>${mon(r.saldo, r.moneda)}</b>` }], cuentas, { clic: true })}</div>`;
    root.querySelectorAll('tr.click').forEach((tr) => tr.onclick = async () => { const c = cuentas[+tr.dataset.i]; const m = await api.get(`/api/cuentas/${c.id}/movimientos`);
      A.modal('Movimientos — ' + c.nombre, `<p>Saldo inicial ${mon(c.saldo_inicial, c.moneda)} · saldo actual <b>${mon(c.saldo, c.moneda)}</b></p>` + A.tabla([{ h: 'Fecha', f: (x) => A.fecha(x.fecha) }, { h: 'Tipo', f: (x) => e(x.tipo.replace(/_/g, ' ')) }, { h: 'Referencia', f: (x) => e(x.referencia || x.nota || '') }, { h: 'Monto', n: 1, f: (x) => `<span class="${x.monto < 0 ? 'bad' : 'ok'}">${fm(x.monto)}</span>` }, { h: 'USD', n: 1, f: (x) => usd(x.monto_usd) }, { h: 'Usuario', f: (x) => e(x.usuario || '') }], m), { ancho: true }); });
    A.acciones(root, { transferir: () => A.form('Transferencia interna', [{ n: 'origen', l: 'Desde', t: 'select', o: cuentas.filter((c) => c.activo).map((c) => [c.id, `${c.nombre} (${mon(c.saldo, c.moneda)})`]) },
      { n: 'destino', l: 'Hacia', t: 'select', o: cuentas.filter((c) => c.activo).map((c) => [c.id, `${c.nombre} (${c.moneda})`]) }, { n: 'monto', l: 'Monto (en la moneda de la cuenta origen)', t: 'number', req: true, min: 0.01 }, { n: 'referencia', l: 'Referencia' }], {},
      async (v) => { const r = await api.post('/api/cuentas/transferir', { ...v, origen: +v.origen, destino: +v.destino }); A.ok('Transferencia registrada'); A.render(); },
      { extra: '<p class="muted" style="margin-top:8px">Si las monedas difieren, se convierte con la tasa del día.</p>' }) });
  };

  // ======================= PEDIDOS APP =======================
  A.vistas.pedidos = async (root, arg) => {
    const pedidos = await api.get('/api/pedidos');
    // Una ficha por etapa del pedido, de principio a fin
    const enOrden = (...l) => (p) => p.estado === 'pagado' && l.includes(p.orden_estado);
    const ETAPAS = [
      { k: 'pagar', t: 'Por pagar', ayuda: 'El cliente armó su pedido y la mercancía está reservada, pero todavía no reporta su pago. Si la reserva vence, se libera sola.', f: (p) => p.estado === 'pendiente' },
      { k: 'validar', t: 'Por validar', ayuda: 'El cliente ya reportó su pago. Verifica la referencia en tu banco y valida o rechaza. Al validar se crea la venta y la orden de entrega.', f: (p) => p.estado === 'pago_reportado' },
      { k: 'preparar', t: 'Por preparar', ayuda: 'Pago validado y orden de entrega creada. Falta empezar a preparar el pedido.', f: enOrden('por_preparar') },
      { k: 'preparando', t: 'En preparación', ayuda: 'Se está armando el pedido.', f: enOrden('en_preparacion', 'preparada') },
      { k: 'listos', t: 'Listos / en camino', ayuda: 'Listos para que el cliente los retire, o para repartir: los repartidores reciben el aviso, toman el pedido y marcan en camino y entregado desde su app.', f: enOrden('lista_retiro', 'lista_envio', 'enviada') },
      { k: 'entregados', t: 'Entregados', ayuda: 'Pedidos completados.', f: (p) => p.estado === 'entregado' },
      { k: 'cerrados', t: 'Rechazados y cancelados', ayuda: 'No generaron venta ni orden de entrega: la mercancía quedó liberada.', f: (p) => ['rechazado', 'cancelado', 'vencido'].includes(p.estado) },
      { k: 'todos', t: 'Todos', ayuda: 'Todos los pedidos, de más reciente a más antiguo.', f: () => true }
    ];
    const cuenta = Object.fromEntries(ETAPAS.map((x) => [x.k, pedidos.filter(x.f).length]));
    let f = arg === 'entregas' ? 'preparar' : arg;
    if (!ETAPAS.find((x) => x.k === f)) f = ['validar', 'pagar', 'preparar', 'preparando', 'listos'].find((k) => cuenta[k]) || 'todos';
    const etapa = ETAPAS.find((x) => x.k === f);
    const lista = pedidos.filter(etapa.f);
    const ORDEN_TXT = { por_preparar: 'Por preparar', en_preparacion: 'En preparación', preparada: 'Preparado', lista_retiro: 'Listo para retiro', lista_envio: 'Listo para envío', enviada: 'En camino', entregada: 'Entregado' };
    const ESTADO_TXT = { pendiente: 'Esperando pago', pago_reportado: 'Pago por validar', entregado: 'Entregado', rechazado: 'Pago rechazado', cancelado: 'Cancelado', vencido: 'Reserva vencida' };
    const ETQ_SIG = { en_preparacion: 'Empezar a preparar', preparada: 'Marcar preparado', lista_retiro: 'Listo para retiro', lista_envio: 'Listo para envío', enviada: 'Salió en camino', entregada: 'Entregado al cliente' };
    const siguiente = (p) => {
      const flujo = p.entrega === 'envio' ? ['por_preparar', 'en_preparacion', 'preparada', 'lista_envio', 'enviada', 'entregada'] : ['por_preparar', 'en_preparacion', 'preparada', 'lista_retiro', 'entregada'];
      const i = flujo.indexOf(p.orden_estado);
      return i >= 0 && i < flujo.length - 1 ? flujo[i + 1] : null;
    };
    const tipoTag = { verde: 'ok', amarillo: 'warn', rojo: 'bad' };
    const estadoTxt = (p) => (p.estado === 'pagado' ? ORDEN_TXT[p.orden_estado] || 'Pagado' : ESTADO_TXT[p.estado] || p.estado);
    const accionBase = (p) => {
      const sig = A.can('pedidos.gestionar') && p.estado === 'pagado' ? siguiente(p) : null;
      if (sig && ['por_preparar', 'en_preparacion'].includes(p.orden_estado)) return `<button class="btn sm pri" data-a="preparar" data-o="${p.orden_id}">${p.orden_estado === 'por_preparar' ? 'Empezar a preparar' : 'Continuar preparación'}</button>`;
      if (sig) return `<button class="btn sm pri" data-a="avanzar" data-o="${p.orden_id}" data-e="${sig}">${e(ETQ_SIG[sig])}</button>`;
      if (p.estado === 'pago_reportado') return '<button class="btn sm pri" data-ver>Revisar y validar</button>';
      return '<button class="btn sm" data-ver>Ver</button>';
    };
    const textoAvisoReparto = (p) => `Hola ${p.repartidor || ''}, tienes un pedido para entregar (${p.numero}). Zona: ${p.zona || '-'}. Dirección: ${p.direccion || '-'}. Ábrelo en la app: ${A.urlReparto()}`;
    const accion = (p) => {
      const puede = p.estado === 'pagado' && p.entrega === 'envio' && A.can('pedidos.gestionar') && ['por_preparar', 'en_preparacion', 'preparada', 'lista_envio'].includes(p.orden_estado);
      const aviso = p.entrega === 'envio' && p.orden_id && p.repartidor_tel && ['por_preparar', 'en_preparacion', 'preparada', 'lista_envio'].includes(p.orden_estado)
        ? ` <a class="btn sm" target="_blank" rel="noopener" href="${e(A.wa(p.repartidor_tel, textoAvisoReparto(p)))}">Avisar por WhatsApp</a>` : '';
      return accionBase(p) + aviso + (puede ? ` <button class="btn sm" data-a="asignar" data-o="${p.orden_id}" data-r="${p.repartidor_id || ''}">${p.repartidor ? 'Cambiar repartidor' : 'Asignar repartidor'}</button>` : '');
    };
    const cols = [
      { h: 'Pedido', f: (p) => `<b>${e(p.numero)}</b>` },
      { h: 'Orden de entrega', f: (p) => (p.orden_numero ? e(p.orden_numero) : ['rechazado', 'cancelado', 'vencido'].includes(p.estado) ? '<span class="muted">No se generó</span>' : '<span class="muted">Se crea al validar el pago</span>') },
      { h: 'Fecha', f: (p) => A.fecha(p.creado) },
      { h: 'Cliente', f: (p) => e(p.cliente) },
      { h: 'Entrega', f: (p) => (p.entrega === 'envio' ? `Envío${p.zona ? ' — ' + e(p.zona) : ''}` : 'Retiro en tienda') },
      { h: 'Repartidor', f: (p) => (p.entrega !== 'envio' || !p.orden_id ? '<span class="muted">—</span>' : p.repartidor
          ? `<b>${e(p.repartidor)}</b>${p.entregado_en ? `<div class="muted" style="font-size:11px">entregó ${e(p.entregado_en.slice(11, 16))}${p.receptor ? ' · recibió ' + e(p.receptor) : ''}</div>` : p.salida_en ? `<div class="muted" style="font-size:11px">salió ${e(p.salida_en.slice(11, 16))}</div>` : ''}`
          : '<span class="muted">Sin asignar</span>') },
      { h: 'Total', n: 1, f: (p) => usd(p.total_usd) },
      { h: 'Estado', f: (p) => A.tag(estadoTxt(p), tipoTag[p.semaforo.color] || '') + (['pendiente', 'pago_reportado'].includes(p.estado) && p.expira ? `<div class="muted" style="font-size:11px">reserva hasta ${e(A.fecha(p.expira).slice(11))}</div>` : '') + (['rechazado', 'cancelado', 'vencido'].includes(p.estado) && p.motivo ? `<div class="muted" style="font-size:11px">${e(p.motivo)}</div>` : '') },
      { h: '', f: accion }
    ];
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Pedidos de la app</h1>${A.can('pedidos.crear') ? '<button class="btn pri" data-a="nuevo">+ Pedido de vendedor</button>' : ''}</div>
      <div class="chips" style="margin-bottom:8px">${ETAPAS.map((x) => `<a class="btn ${x.k === f ? 'pri' : ''}" href="#/pedidos/${x.k}">${e(x.t)} <span style="opacity:.75">(${cuenta[x.k]})</span></a>`).join('')}</div>
      <p class="muted" style="margin:0 0 12px">${e(etapa.ayuda)}</p>
      <div class="card">${A.tabla(cols, lista, { clic: true, vacio: 'No hay pedidos en esta etapa' })}</div>`;
    root.querySelectorAll('tr.click').forEach((tr) => tr.onclick = (ev) => { if (ev.target.closest('[data-a]')) return; detalle(lista[+tr.dataset.i].id); });
    if (!root._auto) root._auto = setInterval(() => { if (!document.body.contains(root)) return clearInterval(root._auto); if (document.querySelector('.velo')) return; A.vistas.pedidos(root, arg).catch(() => {}); }, 20000);

    // ----- Preparación con verificación por escaneo: lista de productos + lector activo -----
    async function abrirPreparacion(ordenId) {
      let st = await api.post(`/api/ordenes/${ordenId}/preparar/iniciar`, {});
      const mod = A.modal('Preparación del pedido', '<div id="prep"></div>', { ancho: true });
      const v = mod.el, caja = $('#prep', v);
      let ultimo = { tipo: '', texto: 'Escanea cada producto al incluirlo en la caja o bolsa.' };
      const entregaTxt = (p) => (p.entrega === 'envio' ? `Envío — ${p.zona || ''}${p.direccion ? ', ' + p.direccion : ''}` : 'Retiro en tienda');
      function pintar() {
        const pct = st.requerido ? Math.round((st.escaneado / st.requerido) * 100) : 0;
        const falta = Math.round((st.requerido - st.escaneado) * 1000) / 1000;
        caja.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><div><b>${e(st.pedido.numero)}</b> · ${e(st.orden.numero)} · ${e(st.pedido.cliente)}<div class="muted">${e(entregaTxt(st.pedido))}</div></div><div class="r"><b style="font-size:20px">${fm(st.escaneado, 0)} de ${fm(st.requerido, 0)}</b><div class="muted">unidades verificadas</div></div></div>
          <div class="barra" style="margin-bottom:12px"><i style="width:${pct}%"></i></div>
          <div class="semaforo ${ultimo.tipo === 'mal' ? 'rojo' : ultimo.tipo === 'bien' ? 'verde' : 'amarillo'}" style="margin-bottom:12px;font-size:16px"><span class="luz"></span><span>${e(ultimo.texto)}</span></div>
          <input id="pcod" placeholder="Escanea con el lector, o escribe el código y pulsa Enter" autocomplete="off" style="margin-bottom:12px">
          ${A.tabla([{ h: 'Producto', f: (l) => `<b>${e(l.nombre)}</b><div class="muted" style="font-size:11px">${e(l.barra || l.codigo)}</div>` }, { h: 'Pedido', n: 1, f: (l) => fm(l.requerido, 0) }, { h: 'Verificado', n: 1, f: (l) => `<b class="${l.escaneado >= l.requerido - 1e-9 ? 'ok' : ''}">${fm(l.escaneado, 0)}</b>${l.manual > 0 ? ` <span class="muted" title="Marcado a mano">(${fm(l.manual, 0)} a mano)</span>` : ''}` },
            { h: 'Estado', f: (l) => (l.escaneado >= l.requerido - 1e-9 ? A.tag('✔ Completo', 'ok') : A.tag('Faltan ' + fm(l.requerido - l.escaneado, 0), 'warn')) },
            { h: '', f: (l) => `<button class="btn sm" data-und="${l.producto_id}" title="Quitar una unidad marcada" ${l.escaneado > 0 ? '' : 'disabled'}>−1</button> <button class="btn sm" data-man="${l.producto_id}" ${l.escaneado >= l.requerido - 1e-9 ? 'disabled' : ''}>Marcar a mano</button>` }], st.lineas)}
          <div class="row" style="margin-top:14px;justify-content:space-between"><div class="muted">${st.completo ? 'Todo verificado.' : `Faltan ${fm(falta, 0)} unidad(es) por incluir.`}</div>
            <div class="chips"><button class="btn" id="pimp">Imprimir lista</button><button class="btn" id="psal">Guardar y salir</button><button class="btn pri lg" id="pfin" ${st.completo ? '' : 'disabled'}>Terminar preparación</button></div></div>`;
        const inp = $('#pcod', v);
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const c = inp.value; inp.value = ''; if (c.trim()) escanear(A.lector.limpiar(c)); } };
        inp.focus();
        caja.querySelectorAll('[data-und]').forEach((b) => b.onclick = async () => { try { st = await api.post(`/api/ordenes/${ordenId}/preparar/deshacer`, { producto_id: +b.dataset.und }); ultimo = { tipo: '', texto: 'Se quitó una unidad de la verificación.' }; pintar(); } catch (er) { A.fail(er); } });
        caja.querySelectorAll('[data-man]').forEach((b) => b.onclick = () => {
          const l = st.lineas.find((x) => x.producto_id === +b.dataset.man);
          A.form('Marcar a mano: ' + l.nombre, [{ n: 'cantidad', l: `Unidades que incluiste (faltan ${fm(l.requerido - l.escaneado, 0)})`, t: 'number', req: true, min: 0.001 }, { n: 'motivo', l: 'Motivo (queda registrado)', req: true, ph: 'Ej. el código de barras no se lee' }], { cantidad: l.requerido - l.escaneado },
            async (x) => { st = await api.post(`/api/ordenes/${ordenId}/preparar/manual`, { producto_id: l.producto_id, cantidad: x.cantidad, motivo: x.motivo }); ultimo = { tipo: 'bien', texto: `${l.nombre}: marcado a mano.` }; pintar(); });
        });
        $('#psal', v).onclick = () => { v.remove(); A.render(); };
        $('#pimp', v).onclick = imprimir;
        $('#pfin', v).onclick = async () => {
          try { await api.post(`/api/ordenes/${ordenId}/estado`, { estado: 'preparada' }); v.remove(); A.ok('Preparación terminada: pedido verificado'); A.render(); } catch (er) { A.fail(er); }
        };
      }
      async function escanear(codigo) {
        try {
          const r = await api.post(`/api/ordenes/${ordenId}/preparar/escanear`, { codigo });
          st = await api.get(`/api/ordenes/${ordenId}/preparacion`);
          ultimo = { tipo: 'bien', texto: `✔ ${r.producto}: ${fm(r.escaneado, 0)} de ${fm(r.requerido, 0)}${r.completo ? ' · ¡PEDIDO COMPLETO!' : r.linea_completa ? ' · línea completa' : ''}` };
          A.lector.pitar(true);
        } catch (er) { ultimo = { tipo: 'mal', texto: '✖ ' + er.message }; A.lector.pitar(false); }
        pintar();
      }
      function imprimir() {
        const w = window.open('', '_blank', 'width=520,height=700');
        if (!w) return A.toast('Permite las ventanas emergentes para imprimir', 'bad');
        w.document.write(`<html><head><title>Preparación ${e(st.orden.numero)}</title><style>body{font:13px system-ui;margin:16px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #999;padding:6px;text-align:left}.n{text-align:right}</style></head><body>
          <h2>Lista de preparación ${e(st.orden.numero)}</h2><p>Pedido ${e(st.pedido.numero)} · ${e(st.pedido.cliente)}<br>${e(entregaTxt(st.pedido))}${st.pedido.referencia_entrega ? '<br>Ref.: ' + e(st.pedido.referencia_entrega) : ''}</p>
          <table><thead><tr><th>☐</th><th>Producto</th><th>Código</th><th class="n">Cant.</th></tr></thead><tbody>${st.lineas.map((l) => `<tr><td>☐</td><td>${e(l.nombre)}</td><td>${e(l.barra || l.codigo)}</td><td class="n"><b>${fm(l.requerido, 0)}</b></td></tr>`).join('')}</tbody></table></body></html>`);
        w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
      }
      // el lector activo mientras esta pantalla esté abierta
      A.lector.alLeer((c) => { if (!document.body.contains(v)) return A.lector.alLeer(null); escanear(c); });
      pintar();
    }

    async function detalle(id) {
      const p = await api.get('/api/pedidos/' + id);
      const flujo = p.entrega === 'envio' ? ['por_preparar', 'en_preparacion', 'preparada', 'lista_envio', 'enviada', 'entregada'] : ['por_preparar', 'en_preparacion', 'preparada', 'lista_retiro', 'entregada'];
      const sig = p.orden && !['entregada', 'cancelada'].includes(p.orden.estado) ? flujo[flujo.indexOf(p.orden.estado) + 1] : null;
      const html = `<div class="semaforo ${p.semaforo.color}"><span class="luz"></span>${e(p.semaforo.mensaje)}</div>
        <div class="grid g2" style="margin-top:12px"><div><p><b>${e(p.cliente)}</b><br>${e(p.cliente_tel || '')}<br>${p.entrega === 'envio' ? `<b>Envío</b> a ${e(p.contacto)} (${e(p.telefono)})<br>${e(p.zona)} — ${e(p.direccion)}<br><span class="muted">Ref.: ${e(p.referencia_entrega || '')}</span>` : '<b>Retiro en tienda</b>'}</p>${p.nota ? `<p class="muted">Nota: ${e(p.nota)}</p>` : ''}${p.expira && ['pendiente', 'pago_reportado'].includes(p.estado) ? `<p class="warn">Reserva vence: ${A.fecha(p.expira)}</p>` : ''}</div>
        <div>${A.tabla([{ h: 'Producto', f: (i) => e(i.nombre) }, { h: 'Cant.', n: 1, f: (i) => fm(i.cantidad, 2) }, { h: 'Subtotal', n: 1, f: (i) => usd(i.cantidad * i.precio_usd) }], p.items)}<p class="r"><b>Total ${usd(p.total_usd)}</b> · ${A.ves ? '' : ''}Bs ${fm(p.total_usd * (S.jornada ? S.jornada.tasa_usd_ves : 0))}</p></div></div>
        <h3>Pagos reportados</h3>${A.tabla([{ h: 'Fecha', f: (x) => A.fecha(x.creado) }, { h: 'Medio', f: (x) => e(A.MEDIOS[x.medio]) + ' · ' + e(x.banco_receptor) }, { h: 'Monto', n: 1, f: (x) => mon(x.monto, x.moneda) }, { h: 'Banco emisor', f: (x) => x.paga_con ? `Paga con ${mon(x.paga_con, x.moneda)} · vuelto ${mon(Math.max(0, x.paga_con - x.monto), x.moneda)}` : e(x.banco_emisor) }, { h: 'Referencia', f: (x) => e(x.referencia) },
          { h: 'Estado', f: (x) => A.estadoTag(x.estado) + (x.motivo ? ` <span class="muted">${e(x.motivo)}</span>` : '') }, { h: '', f: (x) => (x.tiene_comprobante ? `<button class="btn sm" data-comp="${x.id}">Ver comprobante</button> ` : '') + (x.estado === 'pendiente' && A.can('pedidos.gestionar') ? `<button class="btn sm pri" data-val="${x.id}" data-m="${x.paga_con || x.monto}" data-mo="${x.moneda}">Validar</button> <button class="btn sm bad" data-rec="${x.id}">Rechazar</button>` : '') }], p.pagos, { vacio: 'El cliente aún no ha reportado pago' })}
        ${p.orden ? `<h3 style="margin-top:14px">Orden de entrega ${e(p.orden.numero)} ${A.estadoTag(p.orden.estado)}</h3>` : ''}
        ${p.orden && p.orden.repartidor ? `<p>Repartidor: <b>${e(p.orden.repartidor)}</b>${p.orden.repartidor_tel ? ' · ' + e(p.orden.repartidor_tel) : ''}${p.orden.salida_en ? ' · salió ' + e(p.orden.salida_en.slice(11, 16)) : ''}${p.orden.entregado_en ? ' · entregó ' + e(p.orden.entregado_en.slice(11, 16)) + (p.orden.receptor ? ' (recibió ' + e(p.orden.receptor) + ')' : '') : ''}</p>${p.orden.nota_entrega ? `<p class="muted">Nota del repartidor: ${e(p.orden.nota_entrega)}</p>` : ''}` : ''}`;
      A.modal('Pedido ' + p.numero + (p.orden ? ' · Orden ' + p.orden.numero : ''), html, { ancho: true, pie: `${!['cancelado', 'vencido', 'rechazado', 'entregado'].includes(p.estado) && A.can('pedidos.gestionar') ? '<button class="btn bad" data-can>Cancelar pedido</button>' : ''}${sig && A.can('pedidos.gestionar') ? (['por_preparar', 'en_preparacion'].includes(p.orden.estado) ? `<button class="btn pri" data-prep="${p.orden.id}">${p.orden.estado === 'por_preparar' ? 'Empezar a preparar' : 'Continuar preparación'}</button>` : `<button class="btn pri" data-sig="${sig}">Marcar: ${e(sig.replace(/_/g, ' '))}</button>`) : ''}`, onMount: (v, cerrar) => {
        v.querySelectorAll('[data-comp]').forEach((b) => b.onclick = async () => { try { const r = await api.get(`/api/pagos-reportados/${b.dataset.comp}/comprobante`); A.modal('Comprobante', `<img src="${r.comprobante}" alt="comprobante" style="max-width:100%;border-radius:8px">`); } catch (er) { A.fail(er); } });
        v.querySelectorAll('[data-val]').forEach((b) => b.onclick = () => {
          if (!S.turno) return A.toast('Abre tu caja para validar pagos y generar la venta', 'bad');
          A.form('Validar pago y generar venta', [{ n: 'monto_confirmado', l: `Monto confirmado en el banco (${b.dataset.mo})`, t: 'number', req: true, min: 0.01 }], { monto_confirmado: +b.dataset.m }, async (x) => {
            const r = await api.post(`/api/pedidos/${id}/validar-pago`, { pago_id: +b.dataset.val, monto_confirmado: x.monto_confirmado }); A.ok('Venta ' + r.venta.numero + ' generada. Orden de entrega creada.'); cerrar(); A.render(); },
            { ok: 'Validar', extra: '<p class="muted" style="margin-top:8px">Se registra la venta, el cobro en la cuenta bancaria configurada y se descuenta el inventario.</p>' });
        });
        v.querySelectorAll('[data-rec]').forEach((b) => b.onclick = async () => { const mo = await A.pedirMotivo('Motivo del rechazo'); if (!mo) return; try { await api.post(`/api/pedidos/${id}/rechazar-pago`, { motivo: mo }); A.ok('Pago rechazado; stock liberado'); cerrar(); A.render(); } catch (er) { A.fail(er); } });
        const can = $('[data-can]', v); if (can) can.onclick = async () => { const mo = await A.pedirMotivo('Motivo de la cancelación'); if (!mo) return; try { await api.post(`/api/pedidos/${id}/cancelar`, { motivo: mo }); A.ok('Pedido cancelado'); cerrar(); A.render(); } catch (er) { A.fail(er); } };
        const pr = $('[data-prep]', v); if (pr) pr.onclick = () => { cerrar(); abrirPreparacion(+pr.dataset.prep).catch(A.fail); };
        const sg = $('[data-sig]', v); if (sg) sg.onclick = async () => { try { await api.post(`/api/ordenes/${p.orden.id}/estado`, { estado: sg.dataset.sig }); A.ok('Estado actualizado'); cerrar(); A.render(); } catch (er) { A.fail(er); } };
      } });
    }

    A.acciones(root, {
      preparar: (el) => abrirPreparacion(+el.dataset.o),
      asignar: async (el) => {
        const reps = await api.get('/api/repartidores');
        if (!reps.length) return A.toast('Primero crea usuarios con rol Repartidor en Parámetros › Usuarios', 'bad');
        A.form('Asignar repartidor', [{ n: 'repartidor_id', l: 'Repartidor', t: 'select', o: [['', 'Sin asignar: el aviso llega a todos y el primero lo toma'], ...reps.map((x) => [x.id, x.nombre + (x.telefono ? ' · ' + x.telefono : '')])] }], { repartidor_id: el.dataset.r },
          async (x) => { await api.post(`/api/ordenes/${el.dataset.o}/asignar`, { repartidor_id: x.repartidor_id ? +x.repartidor_id : null }); A.ok('Repartidor actualizado');
            const r = x.repartidor_id ? reps.find((y) => y.id == x.repartidor_id) : null;
            if (r && r.telefono && await A.confirmar('Avisar al repartidor', `¿Enviarle un mensaje de WhatsApp a <b>${e(r.nombre)}</b> con el pedido?`, { ok: 'Abrir WhatsApp' }))
              window.open(A.wa(r.telefono, `Hola ${r.nombre}, te asignaron un pedido para entregar. Ábrelo en la app: ${A.urlReparto()}`), '_blank', 'noopener');
            A.render(); });
      },
      avanzar: async (el) => { await api.post(`/api/ordenes/${el.dataset.o}/estado`, { estado: el.dataset.e }); A.ok('Estado actualizado'); A.render(); },
      nuevo: async () => {
      const clientes = await api.get('/api/clientes');
      A.modal('Pedido de vendedor', `<div class="form"><div class="full"><label>Cliente *</label><select id="pc">${clientes.map((c) => `<option value="${c.id}">${e(c.nombre)} ${e(c.telefono || '')}</option>`).join('')}</select></div>
        <div><label>Entrega</label><select id="pe"><option value="retiro">Retiro en tienda</option><option value="envio">Envío al comprador</option></select></div><div class="full" id="envio" hidden><div class="form"><div><label>Contacto</label><input id="pcn"></div><div><label>Teléfono</label><input id="pt"></div><div><label>Zona</label><input id="pz"></div><div><label>Dirección</label><input id="pd"></div><div class="full"><label>Referencia</label><input id="pr"></div></div></div></div>
        <div id="pi" style="margin-top:12px"></div><div id="pe_err" class="bad" style="margin-top:8px"></div>`, { ancho: true, pie: '<button class="btn pri" data-s>Crear pedido y reservar stock</button>', onMount: (v, cerrar) => {
        const pk = itemsPicker($('#pi', v), { modo: 'pedido' });
        $('#pe', v).onchange = () => { $('#envio', v).hidden = $('#pe', v).value !== 'envio'; };
        $('[data-s]', v).onclick = async () => { try {
          await api.post('/api/pedidos', { cliente_id: +$('#pc', v).value, entrega: $('#pe', v).value, contacto: $('#pcn', v).value, telefono: $('#pt', v).value, zona: $('#pz', v).value, direccion: $('#pd', v).value, referencia_entrega: $('#pr', v).value, items: pk.get().map((i) => ({ producto_id: i.producto_id, cantidad: i.cantidad })) });
          A.ok('Pedido creado'); cerrar(); A.render(); } catch (er) { $('#pe_err', v).textContent = er.message; } }; } }); } });
  };
})();
