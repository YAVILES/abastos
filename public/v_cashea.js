'use strict';
// Cashea: lo que financia Cashea queda por cobrar y se liquida una vez por semana.
(() => {
  const A = Abasto, { e, fm, usd, api } = A;
  const $ = (s, r = document) => r.querySelector(s);

  A.vistas.cashea = async (root) => {
    const [d, cuentas] = await Promise.all([api.get('/api/cashea'), api.get('/api/cuentas')]);
    const puede = A.can('cuentas.operar');
    const bancos = cuentas.filter((c) => c.tipo !== 'caja' && c.activo);
    const j = A.S.jornada;
    const masVieja = d.pendientes.reduce((m, p) => Math.max(m, p.dias), 0);
    root.innerHTML = `<h1>Cashea</h1>
      ${d.param.activo ? '' : `<div class="check ojo" style="margin-bottom:12px"><span class="pt"></span><div style="flex:1">Cashea está desactivada: no aparece como forma de cobro en el punto de venta. Actívala en <a href="#/parametros/cashea">Parámetros › Cashea</a>.</div></div>`}
      <div class="grid g4" style="margin-bottom:14px">
        <div class="kpi"><div class="l">Por cobrar a Cashea</div><div class="v">${usd(d.total_pendiente_usd)}</div><div class="s">${d.pendientes.length} venta(s) sin liquidar</div></div>
        <div class="kpi"><div class="l">La más antigua</div><div class="v ${masVieja > 8 ? 'bad' : ''}">${d.pendientes.length ? masVieja + ' días' : '—'}</div><div class="s">Cashea liquida una vez por semana</div></div>
        <div class="kpi"><div class="l">Comisión estimada</div><div class="v">${fm(d.param.comision_pct, 2)} %</div><div class="s">${usd(d.total_pendiente_usd * d.param.comision_pct / 100)} sobre lo pendiente</div></div>
      </div>
      <div class="card"><div class="topbar"><div><h2 style="margin:0">Ventas pendientes de liquidar</h2><p class="muted" style="margin:4px 0 0">Es la parte que Cashea financió a tus clientes. Cuando te depositen la liquidación semanal, marca las ventas que vienen en ella y registra el depósito.</p></div>
        ${puede && d.pendientes.length ? '<button class="btn pri" data-a="liq">Registrar liquidación</button>' : ''}</div>
        ${A.tabla([{ h: puede ? `<input type="checkbox" id="todos" title="Marcar todas">` : '', f: (r) => puede ? `<input type="checkbox" data-sel="${r.id}">` : '' },
          { h: 'Venta', f: (r) => e(r.venta) }, { h: 'Fecha', f: (r) => e(A.fecha(r.creado)) }, { h: 'Cliente', f: (r) => e(r.cliente || '') }, { h: 'Código Cashea', f: (r) => e(r.referencia || '') },
          { h: 'Total venta', n: 1, f: (r) => usd(r.total_usd) }, { h: 'Financia Cashea', n: 1, f: (r) => `<b>${usd(r.monto_usd)}</b>` }, { h: 'Días', n: 1, f: (r) => `<span class="${r.dias > 8 ? 'bad' : ''}">${r.dias}</span>` }], d.pendientes, { vacio: 'No hay ventas pendientes de liquidar' })}</div>
      <div class="card" style="margin-top:14px"><h2 style="margin-top:0">Liquidaciones recibidas</h2>${A.tabla([{ h: 'N°', f: (r) => '#' + r.id }, { h: 'Fecha', f: (r) => e(r.fecha) }, { h: 'Ventas', n: 1, f: (r) => r.ventas }, { h: 'Cuenta', f: (r) => e(r.cuenta) }, { h: 'Referencia', f: (r) => e(r.referencia || '') },
        { h: 'Financiado', n: 1, f: (r) => A.mon(r.bruto, r.moneda) }, { h: 'Comisión', n: 1, f: (r) => A.mon(r.comision, r.moneda) }, { h: 'Recibido', n: 1, f: (r) => `<b>${A.mon(r.recibido, r.moneda)}</b>` }], d.liquidaciones, { vacio: 'Aún no has registrado liquidaciones' })}</div>`;

    const marcadas = () => [...root.querySelectorAll('[data-sel]:checked')].map((x) => +x.dataset.sel);
    const todos = $('#todos', root);
    if (todos) todos.onchange = () => root.querySelectorAll('[data-sel]').forEach((x) => { x.checked = todos.checked; });

    A.acciones(root, {
      liq: () => {
        let ids = marcadas();
        if (!ids.length) ids = d.pendientes.map((p) => p.id);   // sin marcar nada se toma todo lo pendiente
        const filas = d.pendientes.filter((p) => ids.includes(p.id));
        const bruto = filas.reduce((a, p) => a + p.monto_usd, 0);
        if (!bancos.length) return A.fail(new Error('Primero crea el banco donde Cashea te deposita (Bancos y cajas).'));
        const aMoneda = (mo) => (mo === 'USD' ? bruto : mo === 'VES' ? bruto * j.tasa_usd_ves : bruto / j.tasa_eur_usd);
        A.modal('Registrar liquidación de Cashea', `<p class="muted" style="margin-top:0">${filas.length} venta(s) · Cashea financió <b>${usd(bruto)}</b>. Escribe lo que realmente te depositó; la diferencia se registra como comisión de Cashea.</p>
          <form id="fl" class="form">
            <div><label>Banco donde te depositó</label><select name="cuenta_id">${bancos.map((c) => `<option value="${c.id}">${e(c.nombre)} (${e(c.moneda)})</option>`).join('')}</select></div>
            <div><label>Monto depositado <span id="mon" class="muted"></span></label><input name="monto" type="number" step="any" min="0" required></div>
            <div><label>Referencia del depósito</label><input name="referencia" autocomplete="off"></div>
            <div><label>Nota</label><input name="nota" autocomplete="off"></div>
            <div class="full muted" id="cm"></div>
            <div class="full"><button class="btn pri">Registrar liquidación</button></div></form>`, { onMount: (v, cerrar) => {
          const f = $('#fl', v), cm = $('#cm', v);
          const moneda = () => (bancos.find((c) => c.id === +f.cuenta_id.value) || {}).moneda || 'USD';
          const pintar = () => {
            const mo = moneda(), br = Math.round(aMoneda(mo) * 100) / 100;
            $('#mon', v).textContent = '(' + mo + ')';
            const rec = parseFloat(f.monto.value);
            cm.innerHTML = rec >= 0 ? `Financiado ${A.mon(br, mo)} − depositado ${A.mon(rec, mo)} = <b class="${br - rec < -0.01 ? 'bad' : ''}">comisión ${A.mon(Math.max(0, br - rec), mo)}</b>${br ? ` (${fm(Math.max(0, br - rec) / br * 100, 2)} %)` : ''}` : '';
          };
          const sugerir = () => { const br = Math.round(aMoneda(moneda()) * (1 - d.param.comision_pct / 100) * 100) / 100; f.monto.value = br; pintar(); };
          f.cuenta_id.onchange = sugerir; f.monto.oninput = pintar; sugerir();
          f.onsubmit = async (ev) => {
            ev.preventDefault(); const b = f.querySelector('button'); b.disabled = true;
            try { const r = await api.post('/api/cashea/liquidar', { ids, cuenta_id: +f.cuenta_id.value, monto_recibido: +f.monto.value, referencia: f.referencia.value, nota: f.nota.value }); cerrar(); A.ok(`Liquidación registrada: ${r.ventas} venta(s)${r.comision > 0 ? ', comisión ' + A.mon(r.comision, moneda()) : ''}`); A.render(); }
            catch (er) { A.fail(er); b.disabled = false; }
          };
        } });
      }
    });
  };
})();
