'use strict';
// Vistas operativas: inicio (jornada), punto de venta, caja, ventas.
(() => {
  const A = Abasto, { e, fm, usd, ves, mon, api, S } = A;
  const $ = (s, r = document) => r.querySelector(s);

  // ======================= INICIO =======================
  A.vistas.inicio = async (root) => {
    const [d, jr] = await Promise.all([api.get('/api/reportes/dashboard'), api.get('/api/jornada')]);
    const j = d.jornada;
    let abrir = '';
    if (!j) {
      const th = jr.tasa_hoy, ult = jr.ultima || {};
      const u = th || {};
      abrir = `<div class="card"><h2>Abrir día operativo · ${e(A.hoy())}</h2><p class="muted">Sin día abierto no se puede vender, comprar ni cobrar. La tasa se registra a la fecha de hoy y hay que escribirla cada día${th ? ' (ya había una cargada para hoy)' : ult.tasa_usd_ves ? `. La última registrada fue la del ${e(ult.fecha || '')}: Bs ${fm(ult.tasa_usd_ves, 2)} por $` : ''}.</p>
        <form id="fa" class="row"><div><label>Tasa USD/Bs (Bs por 1 USD)</label><input name="tasa_usd_ves" type="number" step="any" min="0" value="${e(u.tasa_usd_ves || '')}" required></div>
        <div><label>Tasa EUR (Bs por 1 €)</label><input name="tasa_eur_ves" type="number" step="any" min="0" value="${u.tasa_eur_usd ? Math.round(u.tasa_eur_usd * u.tasa_usd_ves * 100) / 100 : ''}" required></div>
        <div><label>Fuente</label><input name="fuente" value="BCV"></div><div class="grow"><label>Observación</label><input name="obs"></div>
        ${A.can('jornada.gestionar') ? '<button class="btn pri">Abrir día</button>' : '<span class="muted">Un supervisor debe abrir el día.</span>'}</form></div>`;
    }
    const bars = d.ultimos_dias, mx = Math.max(1, ...bars.map((b) => b.total));
    root.innerHTML = `<h1>Inicio</h1>${abrir}
      ${j ? `<div class="card row" style="justify-content:space-between;align-items:center"><div><b>Día operativo ${e(j.fecha)}</b> · abierto por ${e(j.usuario_apertura)} · tasas: ${fm(j.tasa_usd_ves, 2)} Bs por $, ${fm(j.tasa_usd_ves * j.tasa_eur_usd, 2)} Bs por € (${e(j.fuente)})</div>
        ${A.can('jornada.gestionar') ? '<div class="chips"><button class="btn sm" data-a="tasas">Actualizar tasas</button><button class="btn sm bad" data-a="cerrar">Cerrar día</button></div>' : ''}</div>` : ''}
      <div class="grid g4">
        <div class="kpi"><div class="l">Ventas de hoy</div><div class="v">${usd(d.ventas_hoy.total)}</div><div class="s">${d.ventas_hoy.n} ventas · utilidad ${usd(d.ventas_hoy.utilidad)}</div></div>
        <div class="kpi"><div class="l">Inventario valorizado</div><div class="v">${usd(d.inventario_usd)}</div><div class="s"><a href="#/inventario">${d.bajo_minimo} productos por reponer</a></div></div>
        <div class="kpi"><div class="l">Por cobrar</div><div class="v">${usd(d.cxc.t)}</div><div class="s ${d.cxc.v > 0 ? 'bad' : ''}">vencido ${usd(d.cxc.v)}</div></div>
        <div class="kpi"><div class="l">Por pagar</div><div class="v">${usd(d.cxp.t)}</div><div class="s ${d.cxp.v > 0 ? 'bad' : ''}">vencido ${usd(d.cxp.v)}</div></div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h2>Ventas últimos 7 días</h2>${bars.length ? `<div class="bars" style="margin-bottom:22px">${bars.map((b) => `<div style="height:${Math.max(3, b.total / mx * 100)}%" title="${usd(b.total)}"><span>${e(b.dia.slice(5))}</span></div>`).join('')}</div>` : '<div class="empty">Aún sin ventas</div>'}</div>
        <div class="card"><h2>Más vendidos (7 días)</h2>${A.tabla([{ h: 'Producto', f: (r) => e(r.nombre) }, { h: 'Cant.', n: 1, f: (r) => fm(r.cant, 0) }, { h: 'Monto', n: 1, f: (r) => usd(r.monto) }], d.top_productos)}</div>
        <div class="card"><h2>Alertas</h2><ul style="margin:0;padding-left:18px">
          <li class="${d.pagos_app_pendientes ? 'warn' : 'muted'}">${d.pagos_app_pendientes} pago(s) de la app por validar ${d.pagos_app_pendientes ? '→ <a href="#/pedidos">revisar</a>' : ''}</li>
          <li class="${d.ordenes_abiertas ? 'warn' : 'muted'}">${d.ordenes_abiertas} orden(es) de entrega abiertas</li>
          <li class="${d.bajo_minimo ? 'warn' : 'muted'}">${d.bajo_minimo} producto(s) por reponer según tus ventas y el plazo del proveedor → <a href="#/compras/sugerencias">sugerencias de compra</a></li>
          <li class="${d.cxc.v > 0 ? 'bad' : 'muted'}">Cobranza vencida ${usd(d.cxc.v)}</li></ul></div>
        <div class="card"><h2>Saldos de bancos y cajas</h2>${A.tabla([{ h: 'Cuenta', f: (r) => e(r.nombre) }, { h: 'Saldo', n: 1, f: (r) => mon(r.saldo, r.moneda) }], d.cuentas)}</div>
      </div>`;
    const fa = $('#fa', root);
    if (fa) fa.onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api.post('/api/jornada/abrir', { tasa_usd_ves: +fa.tasa_usd_ves.value, tasa_eur_ves: +fa.tasa_eur_ves.value, fuente: fa.fuente.value, obs: fa.obs.value }); A.ok('Día abierto'); await A.refrescarEstado(); A.render(); }
      catch (er) { A.fail(er); }
    };
    A.acciones(root, {
      tasas: () => A.form('Actualizar tasas', [
        { n: 'fecha', l: 'Fecha a la que corresponde la tasa', t: 'date', req: true, ayuda: 'Si es la fecha del día abierto, cambia la tasa con la que se vende desde ahora. Otra fecha solo se registra en el historial (por ejemplo, cargar la de mañana).' },
        { n: 'tasa_usd_ves', l: 'Tasa USD (Bs por 1 $)', t: 'number', req: true }, { n: 'tasa_eur_ves', l: 'Tasa EUR (Bs por 1 €)', t: 'number', req: true },
        { n: 'fuente', l: 'Fuente' }, { n: 'motivo', l: 'Motivo del cambio', req: true }],
        { fecha: j.fecha, tasa_usd_ves: j.tasa_usd_ves, tasa_eur_ves: Math.round(j.tasa_eur_usd * j.tasa_usd_ves * 100) / 100, fuente: j.fuente }, async (v) => { await api.post('/api/tasas', v); A.ok('Tasas actualizadas'); await A.refrescarEstado(); A.render(); },
        { extra: '<p class="muted" style="margin-top:10px">Las operaciones anteriores conservan la tasa con la que se registraron.</p>' }),
      cerrar: async () => {
        const pc = await api.get('/api/jornada/pre-cierre');
        const html = `<div class="grid g2"><div class="kpi"><div class="l">Ventas</div><div class="v">${usd(pc.ventas.total)}</div><div class="s">${pc.ventas.n} ventas</div></div>
          <div class="kpi"><div class="l">Compras recibidas</div><div class="v">${usd(pc.compras.t)}</div><div class="s">${pc.compras.n} compras</div></div>
          <div class="kpi"><div class="l">Cobros de crédito</div><div class="v">${usd(pc.cobros_usd)}</div></div>
          <div class="kpi"><div class="l">Pagos a proveedores</div><div class="v">${usd(pc.pagos_proveedores_usd)}</div></div></div>
          <h3 style="margin-top:14px">Ventas por medio</h3>${A.tabla([{ h: 'Medio', f: (r) => e(A.MEDIOS[r.medio]) }, { h: 'Moneda', f: (r) => e(r.moneda) }, { h: 'Monto', n: 1, f: (r) => mon(r.monto, r.moneda) }, { h: 'USD', n: 1, f: (r) => usd(r.usd) }], pc.por_medio)}
          <p>Diferencia de caja acumulada: <b class="${pc.diferencia_caja_usd ? 'bad' : ''}">${usd(pc.diferencia_caja_usd)}</b></p>
          ${pc.cajas_abiertas.length ? `<p class="bad">Cajas abiertas: ${pc.cajas_abiertas.map((c) => e(c.nombre + ' (' + c.usuario + ')')).join(', ')}. Deben cerrarse antes.</p>` : ''}
          ${pc.pagos_app_pendientes ? `<p class="warn">Hay ${pc.pagos_app_pendientes} pago(s) de la app sin validar.</p>` : ''}`;
        A.modal('Cierre del día', html, { ancho: true, pie: '<button class="btn" data-n>Volver</button><button class="btn bad" data-s>Cerrar el día</button>',
          onMount: (v, c) => { v.querySelector('[data-n]').onclick = c; v.querySelector('[data-s]').onclick = async () => {
            try { await api.post('/api/jornada/cerrar', { forzar: false }); }
            catch (er) { if (/pendientes de validar/.test(er.message) && await A.confirmar('Pagos sin validar', er.message, { ok: 'Cerrar igualmente', peligro: true })) await api.post('/api/jornada/cerrar', { forzar: true }); else throw er; }
            c(); A.ok('Día cerrado'); await A.refrescarEstado(); A.render(); }; } });
      }
    });
  };

  // ======================= PUNTO DE VENTA =======================
  A.vistas.pos = async (root, arg) => {
    if (!S.jornada) { root.innerHTML = '<h1>Punto de venta</h1><div class="card"><p>No hay un día operativo abierto.</p><a class="btn pri" href="#/inicio">Abrir el día</a></div>'; return; }
    if (!S.turno) { root.innerHTML = '<h1>Punto de venta</h1><div class="card"><p>Debes abrir tu caja para vender.</p><a class="btn pri" href="#/caja">Abrir caja</a></div>'; return; }
    const cuentas = await api.get('/api/cuentas');
    const st = { items: [], cliente: null, pct: 0, res: [], sel: 0, pedido: null };
    // si está activo, cada venta del POS exige identificar al cliente por cédula o RIF
    const requiere = ((await api.get('/api/parametros').catch(() => ({ operacion: {} }))).operacion || {}).venta_requiere_cliente !== false;
    const sinCliente = requiere ? 'Sin identificar' : 'Consumidor final';
    const nPorValidar = (await api.get('/api/pedidos?estado=pago_reportado').catch(() => [])).length;
    root.innerHTML = `<h1>Punto de venta <span class="muted" style="font-size:13px;font-weight:400">· F2 cobrar</span></h1>
      <div class="pos"><div><div class="card"><div class="row" style="flex-wrap:nowrap"><input id="q" placeholder="Escanea el código de barras o escribe el nombre…" autocomplete="off" autofocus><button class="btn" data-a="traer" title="Traer un pedido de delivery o de la app" style="white-space:nowrap">🛵 Pedido delivery${nPorValidar ? ` (${nPorValidar})` : ''}</button>${S.lector && S.lector.tipo === 'camara' ? '<button class="btn" data-a="camara" style="white-space:nowrap">📷 Escanear</button>' : ''}${S.reconocimiento && S.reconocimiento.disponible ? '<button class="btn" data-a="reconocer" title="Reconocer el producto con una foto" style="white-space:nowrap">📷 Foto</button>' : ''}</div><div id="res" class="pos-res" hidden></div></div>
      <div class="card" id="carrito"></div></div>
      <div><div class="card"><div class="row"><div class="grow"><label>Cliente</label><div id="cli" class="muted">${sinCliente}</div></div><button class="btn sm" data-a="cliente">${requiere ? 'Identificar' : 'Cambiar'}</button></div>
      <div style="margin-top:10px"><label>Descuento %</label><input id="pct" type="number" min="0" max="100" step="any" value="0" style="max-width:120px"></div></div>
      <div class="total-box"><div class="muted">Total a pagar</div><div class="big" id="tot">$ 0,00</div><div class="muted" id="tot2"></div></div>
      <div class="row" style="margin-top:12px"><button class="btn pri lg grow" data-a="cobrar" id="bcob">Cobrar</button><button class="btn" data-a="vaciar">Vaciar</button></div></div></div>`;
    const q = $('#q', root), res = $('#res', root);
    const ccli = $('#cli', root);

    function totales() {
      const sub = st.items.reduce((a, i) => a + i.cantidad * i.precio, 0);
      const desc = Math.round(sub * st.pct) / 100;
      return { sub, desc, total: Math.round((sub - desc) * 100) / 100 };
    }
    function pintarVenta() {
      const t = totales();
      $('#carrito', root).innerHTML = st.items.length ? A.tabla([
        { h: 'Producto', f: (r) => `<b>${e(r.nombre)}</b><div class="muted" style="font-size:11px">${e(r.codigo)} · disp. ${fm(r.disponible, 0)}</div>` },
        { h: 'Precio', n: 1, f: (r, i) => A.can('precio.cambiar') ? `<input data-precio="${i}" type="number" step="any" value="${r.precio}" style="width:80px;text-align:right">` : usd(r.precio) },
        { h: 'Cant.', f: (r, i) => `<span class="qty"><button class="btn sm" data-a="menos" data-i="${i}">−</button><input data-cant="${i}" type="number" step="any" min="0" value="${r.cantidad}"><button class="btn sm" data-a="mas" data-i="${i}">+</button></span>` },
        { h: 'Subtotal', n: 1, f: (r) => usd(r.cantidad * r.precio) }, { h: '', f: (r, i) => `<button class="btn sm" data-a="quitar" data-i="${i}">✕</button>` }], st.items) : '<div class="empty">Carrito vacío. Escanea o busca un producto.</div>';
      $('#tot', root).textContent = usd(t.total);
      $('#tot2', root).textContent = `${ves(t.total * S.jornada.tasa_usd_ves)} · € ${fm(t.total / S.jornada.tasa_eur_usd)}`;
      $('#bcob', root).textContent = 'Cobrar'; $('#bcob', root).disabled = !st.items.length;
    }
    function fijarCliente(c) {
      st.cliente = c;
      ccli.innerHTML = c ? `<b>${e(c.nombre)}</b> ${c.documento ? '<span class="muted">' + e(c.documento) + '</span>' : ''} ${c.credito_habilitado ? A.tag('crédito', 'info') : ''}` : sinCliente;
    }
    // Pide la cédula o el RIF; si el cliente no existe ofrece crearlo. Devuelve el cliente elegido o null si se cierra sin elegir.
    function identificar() {
      return new Promise((resolve) => {
        let hecho = false;
        const fin = (c) => { if (hecho) return; hecho = true; if (c) { fijarCliente(c); q.focus(); } resolve(c); };
        A.modal('Identificar al cliente', `<p class="muted" style="margin-top:0">Para vender, escribe la cédula o el RIF del cliente.</p>
          <form id="idf" class="row" style="flex-wrap:nowrap"><input id="idd" placeholder="Ej. V-12345678 o J-123456789" autocomplete="off" required><button class="btn pri">Buscar</button></form>
          <div id="idr" style="margin-top:14px"></div>`, { onMount: (v, cerrar) => {
          const idd = $('#idd', v), idr = $('#idr', v);
          const elegir = (c) => { fin(c); cerrar(); };
          const mostrar = (r) => {
            if (r.cliente) {
              const c = r.cliente;
              idr.innerHTML = `<div class="card"><b>${e(c.nombre)}</b><div class="muted">${e(c.documento || '')} ${e(c.telefono || '')}</div>
                <div style="margin:6px 0">${c.estado !== 'activo' ? '<span class="bad">Cliente suspendido</span>' : c.credito_habilitado ? `Crédito: límite ${usd(c.limite_usd)} · debe ${usd(c.deuda_usd)}${c.vencido_usd > 0 ? ' <span class="bad">(vencido)</span>' : ''}` : '<span class="muted">Paga de contado</span>'}</div>
                <button class="btn pri" id="usar">Continuar con este cliente</button></div>`;
              $('#usar', v).onclick = () => elegir(c); $('#usar', v).focus();
              return;
            }
            idr.innerHTML = `<div class="card"><p style="margin-top:0"><b>No hay un cliente con el documento ${e(r.documento)}.</b> Créalo para continuar.</p>
              <form id="nc" class="form"><div class="full"><label>Nombre o razón social *</label><input name="nombre" required autocomplete="off"></div>
              <div><label>Teléfono</label><input name="telefono" inputmode="tel" autocomplete="off"></div><div><label>Dirección</label><input name="direccion" autocomplete="off"></div>
              <div class="full"><button class="btn pri">Crear cliente y continuar</button></div><div id="nce" class="bad"></div></form></div>`;
            const nc = $('#nc', v); nc.nombre.focus();
            nc.onsubmit = async (ev) => {
              ev.preventDefault(); const b = nc.querySelector('button'); b.disabled = true;
              try {
                const cr = await api.post('/api/clientes', { nombre: nc.nombre.value, documento: r.documento, telefono: nc.telefono.value, direccion: nc.direccion.value });
                A.ok('Cliente creado'); elegir(await api.get('/api/clientes/' + cr.id));
              } catch (er) { $('#nce', v).textContent = er.message; b.disabled = false; }
            };
          };
          $('#idf', v).onsubmit = async (ev) => {
            ev.preventDefault();
            try { mostrar(await api.get('/api/clientes/por-documento' + A.qs({ doc: idd.value }))); } catch (er) { idr.innerHTML = `<div class="bad">${e(er.message)}</div>`; }
          };
          idd.focus();
          const o = new MutationObserver(() => { if (!document.body.contains(v)) { o.disconnect(); fin(null); } }); o.observe(document.body, { childList: true, subtree: true });
        } });
      });
    }
    // Antes de vender hay que tener al cliente identificado (los pedidos de delivery ya traen el suyo)
    async function asegurarCliente() {
      if (!requiere || st.cliente || st.pedido) return true;
      return !!(await identificar());
    }
    function agregar(p) {
      if (st.pedido) return A.toast('Estás atendiendo un pedido de delivery: suéltalo para vender otra cosa', 'bad');
      if (requiere && !st.cliente) { identificar().then((c) => { if (c) agregar(p); else A.toast('Identifica al cliente para iniciar la venta', 'bad'); }); return; }
      const ex = st.items.find((i) => i.id === p.id);
      if (ex) ex.cantidad += 1; else st.items.push({ id: p.id, nombre: p.nombre, codigo: p.codigo, precio: p.precio_usd, cantidad: 1, disponible: p.disponible });
      if (!(p.precio_usd > 0)) A.toast(`"${p.nombre}" no tiene precio de venta`, 'bad');
      pintar();
    }
    async function buscar() {
      const t = q.value.trim();
      if (!t) { res.hidden = true; return; }
      st.res = (await api.get('/api/productos' + A.qs({ q: t, activo: 1 }))).slice(0, 12); st.sel = 0;
      res.hidden = !st.res.length;
      res.innerHTML = st.res.map((p, i) => `<div data-a="elegir" data-i="${i}" class="${i === st.sel ? 'sel' : ''}"><span>${e(p.nombre)} <span class="muted">${e(p.presentacion || '')}</span></span><span><b>${usd(p.precio_usd)}</b> <span class="muted">disp. ${fm(p.disponible, 0)}</span></span></div>`).join('');
    }
    q.addEventListener('input', A.debounce(() => buscar().catch(A.fail), 180));
    q.addEventListener('keydown', async (ev) => {
      if (ev.key === 'ArrowDown' && st.res.length) { st.sel = Math.min(st.res.length - 1, st.sel + 1); [...res.children].forEach((c, i) => c.classList.toggle('sel', i === st.sel)); ev.preventDefault(); }
      if (ev.key === 'ArrowUp' && st.res.length) { st.sel = Math.max(0, st.sel - 1); [...res.children].forEach((c, i) => c.classList.toggle('sel', i === st.sel)); ev.preventDefault(); }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const t = q.value.trim(); if (!t) return;
      try {
        if (A.lector.pareceCodigo(A.lector.limpiar(t))) { try { agregar(await api.get('/api/productos/barra/' + encodeURIComponent(A.lector.limpiar(t)))); A.lector.pitar(true); } catch (er) { A.lector.pitar(false); throw er; } }
        else { if (!st.res.length) await buscar(); if (st.res[st.sel]) agregar(st.res[st.sel]); }
        q.value = ''; res.hidden = true; st.res = [];
      } catch (er) { A.fail(er); q.select(); }
    });
    root.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.cant != null) { const v = parseFloat(t.value); if (v > 0) st.items[+t.dataset.cant].cantidad = v; pintar(); }
      if (t.dataset.precio != null) { const v = parseFloat(t.value); if (v >= 0) st.items[+t.dataset.precio].precio = v; pintar(); }
      if (t.id === 'pct') { st.pct = Math.min(100, Math.max(0, parseFloat(t.value) || 0)); pintar(); }
    });
    // ----- pedido de delivery traído al POS: carga cliente, productos y pago reportado; se valida desde aquí -----
    function pintar() { return st.pedido ? pintarPedido() : pintarVenta(); }
    function pintarPedido() {
      const p = st.pedido, pg = p.pagos.find((x) => x.estado === 'pendiente');
      ccli.innerHTML = `<b>${e(p.cliente)}</b> ${A.tag('pedido ' + p.numero, 'info')}<div class="muted" style="font-size:12px">${e(p.cliente_tel || '')}</div>`;
      $('#carrito', root).innerHTML = `<div class="semaforo amarillo" style="margin-bottom:12px"><span class="luz"></span><span>Atendiendo el pedido <b>${e(p.numero)}</b> de ${e(p.cliente)} · ${p.entrega === 'envio' ? 'ENVÍO a ' + e(p.zona || '') + ' — ' + e(p.direccion || '') + (p.referencia_entrega ? ' (' + e(p.referencia_entrega) + ')' : '') : 'RETIRO en tienda'}</span></div>`
        + A.tabla([{ h: 'Producto', f: (r) => `<b>${e(r.nombre)}</b><div class="muted" style="font-size:11px">${e(r.codigo)}</div>` }, { h: 'Precio', n: 1, f: (r) => usd(r.precio_usd) }, { h: 'Cant.', n: 1, f: (r) => fm(r.cantidad, 2) }, { h: 'Subtotal', n: 1, f: (r) => usd(r.cantidad * r.precio_usd) }], p.items)
        + `<h3 style="margin-top:14px">Pago reportado por el cliente</h3>` + (pg
          ? `<div class="card" style="margin:0"><div class="grid g2"><div><div class="muted" style="font-size:12px">Pagó a</div><b>${e(A.MEDIOS[pg.medio] || pg.medio)} — ${e(pg.banco_receptor)}</b></div><div><div class="muted" style="font-size:12px">Monto reportado</div><b>${mon(pg.monto, pg.moneda)}</b></div>
            <div><div class="muted" style="font-size:12px">Banco emisor</div>${e(pg.banco_emisor || '—')}</div><div><div class="muted" style="font-size:12px">Referencia</div><b>${e(pg.referencia || '—')}</b></div></div>
            ${pg.tiene_comprobante ? `<button class="btn sm" data-a="comprobante" data-id="${pg.id}" style="margin-top:8px">Ver comprobante</button>` : '<div class="muted" style="margin-top:8px;font-size:12px">Sin foto de comprobante</div>'}</div>`
          : '<div class="card bad" style="margin:0">El cliente todavía no reportó su pago: no se puede validar.</div>')
        + `<div class="row" style="margin-top:12px"><button class="btn bad" data-a="rechazarPedido" ${pg ? '' : 'disabled'}>Rechazar pago</button><button class="btn" data-a="soltarPedido">Soltar pedido</button></div>`;
      $('#tot', root).textContent = usd(p.total_usd);
      $('#tot2', root).textContent = `${ves(p.total_usd * S.jornada.tasa_usd_ves)} · € ${fm(p.total_usd / S.jornada.tasa_eur_usd)}`;
      $('#bcob', root).textContent = 'Validar pago y generar venta';
      $('#bcob', root).disabled = !pg;
    }
    function soltarPedido() {
      st.pedido = null; st.items = []; st.cliente = null;
      ccli.textContent = sinCliente; $('#bcob', root).textContent = 'Cobrar';
      pintar(); q.focus();
      if (requiere) identificar();
    }
    async function cargarPedido(id) {
      const p = await api.get('/api/pedidos/' + id);
      if (!['pendiente', 'pago_reportado'].includes(p.estado)) throw new Error('Ese pedido ya no está esperando validación de pago');
      st.items = []; st.cliente = null; st.pedido = p; pintar();
    }
    async function traerPedido() {
      const lista = (await api.get('/api/pedidos')).filter((p) => ['pago_reportado', 'pendiente'].includes(p.estado)).sort((a, b) => (a.estado === 'pago_reportado' ? 0 : 1) - (b.estado === 'pago_reportado' ? 0 : 1));
      A.modal('Pedidos de delivery y de la app', lista.length ? A.tabla([{ h: 'Pedido', f: (p) => e(p.numero) }, { h: 'Cliente', f: (p) => e(p.cliente) }, { h: 'Entrega', f: (p) => (p.entrega === 'envio' ? 'Envío' : 'Retiro') }, { h: 'Total', n: 1, f: (p) => usd(p.total_usd) },
        { h: 'Pago', f: (p) => (p.estado === 'pago_reportado' ? A.tag('reportado', 'warn') : A.tag('sin reportar')) }, { h: '', f: (p, i) => `<button class="btn sm pri" data-i="${i}">Traer al POS</button>` }], lista)
        : '<div class="empty">No hay pedidos esperando validación.</div>', { ancho: true, onMount: (v, cerrar) => {
        v.querySelectorAll('button[data-i]').forEach((b) => b.onclick = async () => { try { await cargarPedido(lista[+b.dataset.i].id); cerrar(); } catch (er) { A.fail(er); } });
      } });
    }
    function validarPedido() {
      const p = st.pedido, pg = p && p.pagos.find((x) => x.estado === 'pendiente');
      if (!pg) return A.toast('El cliente todavía no reportó su pago', 'bad');
      return A.form('Validar pago y generar venta', [{ n: 'monto_confirmado', l: `Monto confirmado en el banco (${pg.moneda})`, t: 'number', req: true, min: 0.01 }], { monto_confirmado: pg.paga_con || pg.monto }, async (v) => {
        const r = await api.post(`/api/pedidos/${p.id}/validar-pago`, { pago_id: pg.id, monto_confirmado: v.monto_confirmado });
        soltarPedido(); await A.refrescarEstado();
        A.ok('Venta ' + r.venta.numero + ' generada');
        A.modal('Pedido validado', `<div class="c"><div style="font-size:40px">✅</div><h2>${e(r.venta.numero)}</h2><div style="font-size:26px;font-weight:800">${usd(r.venta.total_usd)}</div><p class="muted">Se descontó el inventario y se creó la <b>orden de entrega</b> para despacharlo.</p></div>`,
          { pie: '<button class="btn" data-p>Imprimir recibo</button><a class="btn" href="#/pedidos/entregas" data-d>Ir al despacho</a><button class="btn pri" data-c>Seguir vendiendo</button>', onMount: (m, c2) => {
            $('[data-c]', m).onclick = () => { c2(); q.focus(); }; $('[data-d]', m).onclick = c2; $('[data-p]', m).onclick = () => A.imprimirVenta(r.venta.id); } });
      }, { ok: 'Validar y generar venta', extra: `<div class="card" style="margin-top:12px"><div class="muted" style="font-size:12px">Compara con tu estado de cuenta antes de validar</div><b>${e(A.MEDIOS[pg.medio] || pg.medio)} — ${e(pg.banco_receptor)}</b> · ref. <b>${e(pg.referencia || '')}</b> · desde ${e(pg.banco_emisor || '—')}<br>Reportó <b>${mon(pg.monto, pg.moneda)}</b> por un pedido de <b>${usd(p.total_usd)}</b>.</div>` });
    }
    async function rechazarPedido() {
      const p = st.pedido; if (!p) return;
      const motivo = await A.pedirMotivo('Motivo del rechazo del pago'); if (!motivo) return;
      await api.post(`/api/pedidos/${p.id}/rechazar-pago`, { motivo });
      A.ok('Pago rechazado; la mercancía quedó liberada'); soltarPedido();
    }
    const teclas = (ev) => { if (!document.body.contains(root)) return document.removeEventListener('keydown', teclas); if (ev.key === 'F2') { ev.preventDefault(); if (st.pedido) validarPedido(); else if (st.items.length) cobrar(); } };
    document.addEventListener('keydown', teclas);

    function cobrar() {
      const t = totales(), j = S.jornada;
      const aUSD = (m, mo) => mo === 'USD' ? m : mo === 'VES' ? m / j.tasa_usd_ves : m * j.tasa_eur_usd;
      const deUSD = (u, mo) => mo === 'USD' ? u : mo === 'VES' ? u * j.tasa_usd_ves : u / j.tasa_eur_usd;
      let lin = [], vl = [];
      const bancos = (mo) => cuentas.filter((c) => c.tipo !== 'caja' && c.activo && c.moneda === mo);
      const m = A.modal('Cobrar', '<div id="pg"></div>', { ancho: true, pie: '<button class="btn" data-n>Cancelar</button><button class="btn pri lg" data-s disabled>Confirmar venta</button>', onMount: (v, cerrar) => {
        const body = $('#pg', v); const bs = $('[data-s]', v); $('[data-n]', v).onclick = cerrar;
        const pagadoUSD = () => lin.filter((l) => l.medio !== 'credito').reduce((a, l) => a + aUSD(+l.monto || 0, l.moneda), 0);
        const vSuma = () => vl.reduce((a, l) => a + aUSD(+l.monto || 0, l.moneda), 0);
        const hayVuelto = () => { const h = lin.some((l) => l.medio === 'credito'); return !h && pagadoUSD() - t.total > 0.01; };
        const puedeConfirmar = () => {
          const pag = pagadoUSD(), h = lin.some((l) => l.medio === 'credito');
          if (!lin.length || (h ? pag >= t.total - 0.005 : pag < t.total - 0.005)) return false;
          if (hayVuelto() && vl.length) { if (Math.abs(pag - t.total - vSuma()) > 0.03) return false; if (vl.some((l) => !(+l.monto > 0) || (l.medio !== 'efectivo' && !String(l.referencia).trim()))) return false; }
          return true;
        };
        function nuevoVuelto(medio, moneda) {
          const falta = Math.max(0, pagadoUSD() - t.total - vSuma());
          vl.push({ medio, moneda, monto: Math.round(deUSD(falta, moneda) * 100) / 100 || '', referencia: '', cuenta_id: (bancos(moneda)[0] || {}).id || '' });
          pintarPago();
        }
        function nueva(medio, moneda) {
          const falta = Math.max(0, t.total - pagadoUSD());
          lin.push({ medio, moneda, monto: medio === 'credito' ? '' : (Math.round(deUSD(falta, moneda) * 100) / 100 || ''), referencia: '', cuenta_id: (bancos(moneda)[0] || {}).id || '' });
          pintarPago();
        }
        function pintarPago() {
          const pag = pagadoUSD(), hayCred = lin.some((l) => l.medio === 'credito');
          const dif = Math.round((pag - t.total) * 100) / 100;
          body.innerHTML = `<div class="row" style="justify-content:space-between"><div><div class="muted">Total</div><div style="font-size:26px;font-weight:800">${usd(t.total)}</div><div class="muted">${ves(t.total * j.tasa_usd_ves)}</div></div>
            <div class="r"><div class="muted">${hayCred ? 'A crédito' : dif >= -0.005 ? 'Vuelto' : 'Falta'}</div><div style="font-size:26px;font-weight:800" class="${hayCred || dif >= -0.005 ? 'ok' : 'bad'}">${hayCred ? usd(Math.max(0, t.total - pag)) : usd(Math.abs(dif))}</div>
            ${!hayCred && dif > 0.005 ? `<div class="muted">${ves(dif * j.tasa_usd_ves)}</div>` : ''}</div></div>
            <div class="chips no-print" style="margin:10px 0">${[['efectivo', 'USD', '+ Efectivo $'], ['efectivo', 'VES', '+ Efectivo Bs'], ['pago_movil', 'VES', '+ Pago móvil'], ['transferencia', 'VES', '+ Transferencia'], ['punto', 'VES', '+ Punto'], ['efectivo', 'EUR', '+ Efectivo €'], ['credito', 'USD', '+ Crédito']].map(([me, mo, l], i) => `<button class="btn sm" data-add="${i}">${l}</button>`).join('')}</div>
            ${lin.map((l, i) => `<div class="pago-lin"><div><label>Medio</label><select data-k="medio" data-i="${i}">${Object.entries(A.MEDIOS).map(([k, n]) => `<option value="${k}" ${k === l.medio ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
              <div><label>Moneda</label><select data-k="moneda" data-i="${i}" ${l.medio === 'credito' ? 'disabled' : ''}>${['USD', 'VES', 'EUR'].map((x) => `<option ${x === l.moneda ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
              <div><label>${l.medio === 'credito' ? 'Se calcula solo' : 'Monto'}</label><input data-k="monto" data-i="${i}" type="number" step="any" min="0" value="${e(l.monto)}" ${l.medio === 'credito' ? 'disabled' : ''}></div>
              <div>${['pago_movil', 'transferencia', 'punto'].includes(l.medio) ? `<label>Referencia / banco</label><div class="row" style="flex-wrap:nowrap"><input data-k="referencia" data-i="${i}" placeholder="N° referencia" value="${e(l.referencia)}"><select data-k="cuenta_id" data-i="${i}">${bancos(l.moneda).map((c) => `<option value="${c.id}" ${c.id == l.cuenta_id ? 'selected' : ''}>${e(c.nombre)}</option>`).join('') || '<option value="">Sin cuenta</option>'}</select></div>` : ''}</div>
              <button class="btn sm" data-del="${i}">✕</button></div>`).join('')}
            ${lin.length ? '' : '<p class="muted">Agrega uno o más medios de pago (pago mixto permitido).</p>'}
            ${!hayCred && dif > 0.01 ? `<div class="card" style="margin-top:12px;background:var(--bg2,#f6f7f9)"><h3 style="margin:0 0 6px">¿Cómo entregas el vuelto? <span class="muted" style="font-weight:400">(${usd(dif)} · ${ves(dif * j.tasa_usd_ves)})</span></h3>
              <div class="chips no-print" style="margin-bottom:8px">${[['efectivo', 'USD', 'Efectivo $'], ['efectivo', 'VES', 'Efectivo Bs'], ['pago_movil', 'VES', 'Pago móvil Bs'], ['transferencia', 'VES', 'Transferencia Bs'], ['efectivo', 'EUR', 'Efectivo €']].map(([me, mo, l], i) => `<button class="btn sm" data-vadd="${i}">+ ${l}</button>`).join('')}</div>
              ${vl.length ? vl.map((l, i) => `<div class="pago-lin"><div><label>Medio</label><select data-vk="medio" data-i="${i}">${['efectivo', 'pago_movil', 'transferencia'].map((k) => `<option value="${k}" ${k === l.medio ? 'selected' : ''}>${A.MEDIOS[k]}</option>`).join('')}</select></div>
                <div><label>Moneda</label><select data-vk="moneda" data-i="${i}">${['USD', 'VES', 'EUR'].map((x) => `<option ${x === l.moneda ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
                <div><label>Monto entregado</label><input data-vk="monto" data-i="${i}" type="number" step="any" min="0" value="${e(l.monto)}"></div>
                <div>${l.medio !== 'efectivo' ? `<label>Referencia / banco</label><div class="row" style="flex-wrap:nowrap"><input data-vk="referencia" data-i="${i}" placeholder="N° referencia" value="${e(l.referencia)}"><select data-vk="cuenta_id" data-i="${i}">${bancos(l.moneda).map((c) => `<option value="${c.id}" ${c.id == l.cuenta_id ? 'selected' : ''}>${e(c.nombre)}</option>`).join('') || '<option value="">Sin cuenta</option>'}</select></div>` : ''}</div>
                <button class="btn sm" data-vdel="${i}">✕</button></div>`).join('') + (Math.abs(dif - vSuma()) > 0.03 ? `<p class="bad" style="margin:6px 0 0">Falta por entregar: <b>${usd(dif - vSuma())}</b> · ${ves((dif - vSuma()) * j.tasa_usd_ves)}</p>` : '<p class="ok" style="margin:6px 0 0">Vuelto completo.</p>')
              : `<p class="muted" style="margin:0">Si no eliges nada se entrega todo en <b>efectivo $</b> (${usd(dif)}). Si das parte en bolívares o por pago móvil, agrégalo aquí para que la caja y el banco queden cuadrados.</p>`}</div>` : ''}`;
          const ok = hayCred ? pag < t.total - 0.005 : pag >= t.total - 0.005;
          bs.disabled = !puedeConfirmar();
          body.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { const [me, mo] = [['efectivo', 'USD'], ['efectivo', 'VES'], ['pago_movil', 'VES'], ['transferencia', 'VES'], ['punto', 'VES'], ['efectivo', 'EUR'], ['credito', 'USD']][+b.dataset.add]; nueva(me, mo); });
          body.querySelectorAll('[data-vadd]').forEach((b) => b.onclick = () => { const [me, mo] = [['efectivo', 'USD'], ['efectivo', 'VES'], ['pago_movil', 'VES'], ['transferencia', 'VES'], ['efectivo', 'EUR']][+b.dataset.vadd]; nuevoVuelto(me, mo); });
          body.querySelectorAll('[data-vdel]').forEach((b) => b.onclick = () => { vl.splice(+b.dataset.vdel, 1); pintarPago(); });
          body.querySelectorAll('[data-vk]').forEach((el) => el.onchange = el.oninput = (ev) => {
            const l = vl[+el.dataset.i], k = el.dataset.vk; l[k] = el.value;
            if (ev.type === 'change' && ['medio', 'moneda', 'cuenta_id', 'monto'].includes(k)) {
              if (k === 'moneda' || k === 'medio') l.cuenta_id = (bancos(l.moneda)[0] || {}).id || '';
              pintarPago();
            } else bs.disabled = !puedeConfirmar();
          });
          body.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { lin.splice(+b.dataset.del, 1); pintarPago(); });
          body.querySelectorAll('[data-k]').forEach((el) => el.onchange = el.oninput = (ev) => {
            const l = lin[+el.dataset.i], k = el.dataset.k; l[k] = el.value;
            if (ev.type === 'change' && (k === 'medio' || k === 'moneda' || k === 'cuenta_id' || k === 'monto')) {
              if (k === 'medio' && el.value === 'credito') l.moneda = 'USD';
              if (k === 'moneda' || k === 'medio') l.cuenta_id = (bancos(l.moneda)[0] || {}).id || '';
              pintarPago();
            } else if (k === 'monto') bs.disabled = !puedeConfirmar();
          });
        }
        pintarPago();
        if (!st.cliente) { /* sin cliente: crédito se bloquea en servidor */ }
        bs.onclick = async () => {
          bs.disabled = true;
          const body_ = { cliente_id: st.cliente ? st.cliente.id : null, descuento_pct: st.pct, items: st.items.map((i) => ({ producto_id: i.id, cantidad: i.cantidad, precio_usd: i.precio })),
            pagos: lin.map((l) => l.medio === 'credito' ? { medio: 'credito' } : { medio: l.medio, moneda: l.moneda, monto: +l.monto, referencia: l.referencia, cuenta_id: l.cuenta_id ? +l.cuenta_id : undefined }) };
          if (hayVuelto() && vl.length) body_.vuelto = vl.map((l) => ({ medio: l.medio, moneda: l.moneda, monto: +l.monto, referencia: l.referencia, cuenta_id: l.cuenta_id ? +l.cuenta_id : undefined }));
          try {
            let r;
            try { r = await api.post('/api/ventas', body_); }
            catch (er) { if (/supervisor/.test(er.message) && A.can('credito.autorizar') && await A.confirmar('Autorización de crédito', e(er.message) + '<br>¿Autorizar la excepción?', { ok: 'Autorizar' })) r = await api.post('/api/ventas', { ...body_, forzar: true }); else throw er; }
            cerrar(); st.items = []; st.cliente = null; st.pct = 0; $('#pct', root).value = 0; cli.textContent = sinCliente; pintar();
            A.ok('Venta ' + r.numero + ' registrada');
            A.modal('Venta registrada', `<div class="c"><div style="font-size:40px">✅</div><h2>${e(r.numero)}</h2><div style="font-size:28px;font-weight:800">${usd(r.total_usd)}</div>
              ${r.vuelto_usd > 0 ? `<p>Vuelto: <b>${usd(r.vuelto_usd)}</b> · ${ves(r.vuelto_usd * j.tasa_usd_ves)}</p>${(r.vuelto || []).map((x) => `<div class="muted">Entregado en ${e(A.MEDIOS[x.medio])} ${mon(x.monto, x.moneda)}${x.referencia ? ' · ref ' + e(x.referencia) : ''}</div>`).join('')}` : ''}${r.credito_usd > 0 ? `<p>A crédito: <b>${usd(r.credito_usd)}</b></p>` : ''}</div>`,
              { pie: `<button class="btn pri lg" data-p>🖨 Imprimir ticket</button><button class="btn" data-c>Nueva venta</button>`, onMount: (v2, c2) => {
                const nueva = () => { c2(); q.focus(); if (requiere) identificar(); };
                $('[data-c]', v2).onclick = nueva; $('[data-p]', v2).onclick = () => A.imprimirVenta(r.id); $('[data-p]', v2).focus();
              } });
            await A.refrescarEstado();
          } catch (er) { A.fail(er); bs.disabled = false; }
        };
      } });
    }

    A.acciones(root, {
      elegir: (el) => { agregar(st.res[+el.dataset.i]); q.value = ''; res.hidden = true; st.res = []; q.focus(); },
      reconocer: () => reconocerPorFoto((p) => { agregar(p); q.focus(); }),
      menos: (el) => { const i = st.items[+el.dataset.i]; i.cantidad = Math.max(0, +(i.cantidad - 1).toFixed(3)); if (i.cantidad <= 0) st.items.splice(+el.dataset.i, 1); pintar(); },
      mas: (el) => { st.items[+el.dataset.i].cantidad += 1; pintar(); },
      quitar: (el) => { st.items.splice(+el.dataset.i, 1); pintar(); },
      vaciar: () => { if (st.pedido) return soltarPedido(); st.items = []; pintar(); q.focus(); },
      cobrar: async () => { if (st.pedido) return validarPedido(); if (st.items.length && await asegurarCliente()) cobrar(); },
      traer: () => traerPedido(), camara: () => A.lector.escanearCamara((cod) => A.lector.emitir(cod)).catch(A.fail), soltarPedido: () => soltarPedido(), rechazarPedido: () => rechazarPedido(),
      comprobante: async (el) => { const r = await api.get(`/api/pagos-reportados/${el.dataset.id}/comprobante`); A.modal('Comprobante', `<img src="${r.comprobante}" alt="comprobante" style="max-width:100%;border-radius:8px">`); },
      cliente: () => {
        if (st.pedido) return A.toast('El cliente lo define el pedido', 'bad');
        if (requiere) return identificar();
        A.modal('Cliente', '<input id="cq" placeholder="Buscar por nombre, documento o teléfono"><div id="cl" style="margin-top:10px"></div>', { pie: '<button class="btn" data-g>Consumidor final</button>', onMount: (v, c) => {
          $('[data-g]', v).onclick = () => { st.cliente = null; cli.textContent = 'Consumidor final'; c(); };
          const lista = async () => { const rows = await api.get('/api/clientes' + A.qs({ q: $('#cq', v).value })); $('#cl', v).innerHTML = A.tabla([{ h: 'Cliente', f: (r) => `<b>${e(r.nombre)}</b><div class="muted">${e(r.telefono || '')} ${e(r.documento || '')}</div>` }, { h: 'Crédito', f: (r) => r.credito_habilitado ? `Límite ${usd(r.limite_usd)} · debe ${usd(r.deuda_usd)}${r.vencido_usd > 0 ? ' <span class="bad">vencido</span>' : ''}` : '<span class="muted">Contado</span>' }], rows, { clic: true });
            $('#cl', v).querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => { st.cliente = rows[+tr.dataset.i]; cli.innerHTML = `<b>${e(st.cliente.nombre)}</b> ${st.cliente.credito_habilitado ? A.tag('crédito', 'info') : ''}`; c(); }); };
          $('#cq', v).oninput = A.debounce(() => lista().catch(A.fail)); lista().catch(A.fail); } });
      }
    });
    // el lector escanea aunque el cursor no esté en el buscador (según los parámetros)
    A.lector.alLeer(async (codigo) => {
      if (!document.body.contains(root)) return A.lector.alLeer(null);
      if (st.pedido) { A.lector.pitar(false); return A.toast('Estás atendiendo un pedido de delivery: suéltalo para escanear otros productos', 'bad'); }
      try { agregar(await api.get('/api/productos/barra/' + encodeURIComponent(codigo))); A.lector.pitar(true); q.value = ''; res.hidden = true; }
      catch (er) { A.lector.pitar(false); A.fail(er); }
    });
    pintar(); q.focus();
    if (arg === 'pedidos') traerPedido(); else if (requiere) identificar();
  };

  // Reconocimiento de producto por foto: cámara o archivo -> /api/reconocer -> el cajero confirma el candidato.
  function reducirImagen(fuente, ancho, alto) {
    const k = Math.min(1, 900 / Math.max(ancho, alto));
    const c = document.createElement('canvas'); c.width = Math.round(ancho * k); c.height = Math.round(alto * k);
    c.getContext('2d').drawImage(fuente, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }
  function reconocerPorFoto(alElegir) {
    let stream = null;
    A.modal('Reconocer producto por foto', `<p class="muted">Apunta al producto desde cualquier ángulo y toma la foto. El sistema propone coincidencias del catálogo y tú confirmas.</p>
      <div id="rcam"><video id="rv" playsinline muted style="width:100%;max-height:300px;border-radius:8px;background:#000"></video></div>
      <div class="row" style="margin-top:10px"><button class="btn pri" id="rcap" disabled>Tomar foto</button><label class="btn" style="margin:0;cursor:pointer">Elegir imagen<input id="rfile" type="file" accept="image/*" capture="environment" hidden></label></div>
      <div id="rout" style="margin-top:12px"></div>`, { ancho: true, onMount: (v, cerrar) => {
      const parar = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
      v.querySelector('[data-x]').addEventListener('click', parar);
      const out = $('#rout', v);
      async function enviar(dataUrl) {
        out.innerHTML = '<div class="empty">Analizando la foto…</div>';
        try {
          const r = await api.post('/api/reconocer', { imagen: dataUrl });
          S.reconocimiento.usados_mes = (S.reconocimiento.usados_mes || 0) + 1;
          if (!r.productos.length) { out.innerHTML = `<div class="card">${e(r.mensaje || 'No se reconoció ningún producto del catálogo con seguridad.')} Busca por nombre.${r.descripcion ? `<div class="muted">Se ve: ${e(r.descripcion)}</div>` : ''}</div>`; return; }
          out.innerHTML = (r.descripcion ? `<p class="muted">Se ve: ${e(r.descripcion)}</p>` : '') + A.tabla([
            { h: 'Producto', f: (p) => `<b>${e(p.nombre)}</b><div class="muted" style="font-size:11px">${e(p.presentacion || '')}</div>` }, { h: 'Coincidencia', n: 1, f: (p) => fm(p.confianza * 100, 0) + '%' },
            { h: 'Precio', n: 1, f: (p) => usd(p.precio_usd) }, { h: 'Disp.', n: 1, f: (p) => fm(p.disponible, 0) }, { h: '', f: (p, i) => `<button class="btn pri sm" data-i="${i}">Agregar</button>` }], r.productos);
          out.querySelectorAll('button[data-i]').forEach((b) => b.onclick = () => { parar(); cerrar(); alElegir(r.productos[+b.dataset.i]); });
        } catch (er) { out.innerHTML = `<div class="card bad">${e(er.message)}</div>`; }
      }
      const vid = $('#rv', v), cap = $('#rcap', v);
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => { stream = s; vid.srcObject = s; vid.play(); cap.disabled = false; })
        .catch(() => { $('#rcam', v).innerHTML = '<div class="muted">No se pudo abrir la cámara: elige una imagen.</div>'; });
      cap.onclick = () => { if (vid.videoWidth) enviar(reducirImagen(vid, vid.videoWidth, vid.videoHeight)); };
      $('#rfile', v).onchange = (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        const img = new Image(); const url = URL.createObjectURL(f);
        img.onload = () => { URL.revokeObjectURL(url); enviar(reducirImagen(img, img.width, img.height)); };
        img.src = url;
      };
    } });
  }

  A.imprimirVenta = async (id) => {
    const v = await api.get('/api/ventas/' + id);
    const w = window.open('', '_blank', 'width=380,height=640');
    if (!w) return A.toast('Permite las ventanas emergentes para imprimir', 'bad');
    w.document.write(`<html><head><title>${e(v.numero)}</title><style>body{font:12px monospace;width:300px;margin:8px}table{width:100%}td{padding:1px 0}.r{text-align:right}hr{border:0;border-top:1px dashed #000}</style></head><body>
      ${S.empresa.logo ? `<img src="${S.empresa.logo}" style="max-width:140px;max-height:70px;display:block;margin:0 auto 4px"><br>` : ''}<b>${e(S.empresa.nombre)}</b><br>${e(S.empresa.rif || '')}<br>${e(S.empresa.direccion || '')}<hr>Recibo ${e(v.numero)}<br>${e(v.fecha)}<br>Cajero: ${e(v.usuario)}${v.cliente ? '<br>Cliente: ' + e(v.cliente) : ''}<hr>
      <table>${v.items.map((i) => `<tr><td colspan=2>${e(i.nombre)}</td></tr><tr><td>${fm(i.cantidad, 2)} x ${fm(i.precio_usd)}</td><td class=r>${fm(i.cantidad * i.precio_usd)}</td></tr>`).join('')}</table><hr>
      <table><tr><td>Subtotal</td><td class=r>${usd(v.subtotal_usd)}</td></tr>${v.descuento_usd > 0 ? `<tr><td>Descuento</td><td class=r>-${usd(v.descuento_usd)}</td></tr>` : ''}<tr><td><b>TOTAL</b></td><td class=r><b>${usd(v.total_usd)}</b></td></tr></table><hr>
      ${v.pagos.filter((p) => !p.anulado && p.tipo !== 'vuelto').map((p) => `${e(A.MEDIOS[p.medio])} ${mon(p.monto, p.moneda)}${p.referencia ? ' ref ' + e(p.referencia) : ''}<br>`).join('')}${v.vuelto_usd > 0 ? `Vuelto ${usd(v.vuelto_usd)}<br>${v.pagos.filter((p) => !p.anulado && p.tipo === 'vuelto').map((p) => `&nbsp;&nbsp;entregado: ${e(A.MEDIOS[p.medio])} ${mon(p.monto, p.moneda)}${p.referencia ? ' ref ' + e(p.referencia) : ''}<br>`).join('')}` : ''}<hr>Documento no fiscal. ¡Gracias por su compra!</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  };

  // ======================= CAJA =======================
  A.vistas.caja = async (root) => {
    const [t, cajas] = await Promise.all([api.get('/api/turno'), api.get('/api/cajas')]);
    const pv = t ? (await api.get('/api/pedidos?estado=pago_reportado').catch(() => [])).length : 0;
    let hist = '';
    if (A.can('caja.supervisar')) {
      const ts = await api.get('/api/turnos');
      hist = `<div class="card"><h2>Turnos de caja</h2>${A.tabla([{ h: '#', f: (r) => r.id }, { h: 'Caja', f: (r) => e(r.caja) }, { h: 'Cajero', f: (r) => e(r.usuario) }, { h: 'Abierta', f: (r) => A.fecha(r.abierta_en) }, { h: 'Cerrada', f: (r) => A.fecha(r.cerrada_en) },
        { h: 'Estado', f: (r) => A.estadoTag(r.estado) }, { h: 'Diferencia', n: 1, f: (r) => r.diferencia_usd == null ? '—' : `<span class="${Math.abs(r.diferencia_usd) > 0.005 ? 'bad' : ''}">${usd(r.diferencia_usd)}</span>` }], ts)}</div>`;
    }
    if (!t) {
      root.innerHTML = `<h1>Caja</h1><div class="card"><h2>Abrir caja</h2>${!S.jornada ? '<p class="bad">Primero abre el día operativo desde Inicio.</p>' : ''}
        <form id="fc" class="row"><div><label>Caja</label><select name="caja_id">${cajas.map((c) => `<option value="${c.id}" ${c.turno ? 'disabled' : ''}>${e(c.nombre)}${c.turno ? ' (ocupada por ' + e(c.turno.usuario) + ')' : ''}</option>`).join('')}</select></div>
        <div><label>Fondo USD</label><input name="USD" type="number" step="any" min="0" value="0"></div><div><label>Fondo Bs</label><input name="VES" type="number" step="any" min="0" value="0"></div><div><label>Fondo €</label><input name="EUR" type="number" step="any" min="0" value="0"></div>
        <button class="btn pri" ${!S.jornada ? 'disabled' : ''}>Abrir caja</button></form></div>${hist}`;
      $('#fc', root).onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; try { await api.post('/api/turnos/abrir', { caja_id: +f.caja_id.value, fondo: { USD: +f.USD.value, VES: +f.VES.value, EUR: +f.EUR.value } }); A.ok('Caja abierta: ya puedes vender'); await A.refrescarEstado(); A.ir('pos'); } catch (er) { A.fail(er); } };
      return;
    }
    const r = t.resumen;
    root.innerHTML = `<h1>${e(t.caja)} <span class="muted" style="font-size:14px;font-weight:400">· abierta ${A.fecha(t.abierta_en)}</span></h1>
      <div class="chips" style="margin:6px 0 14px"><a class="btn pri lg" href="#/pos">🧾 Iniciar una venta</a><a class="btn lg" href="#/pos/pedidos">🛵 Traer pedido de delivery${pv ? ` (${pv} por validar)` : ''}</a></div>
      <div class="grid g3"><div class="kpi"><div class="l">Ventas del turno</div><div class="v">${usd(r.ventas.total)}</div><div class="s">${r.ventas.n} ventas</div></div>
      ${['USD', 'VES', 'EUR'].map((m) => `<div class="kpi"><div class="l">Efectivo esperado ${m}</div><div class="v">${mon(r.esperado[m], m)}</div><div class="s">fondo ${mon(r.fondo[m], m)}</div></div>`).slice(0, 2).join('')}</div>
      <div class="card" style="margin-top:14px"><h2>Cobros por medio</h2>${A.tabla([{ h: 'Medio', f: (x) => e(A.MEDIOS[x.medio]) }, { h: 'Moneda', f: (x) => e(x.moneda) }, { h: 'Operaciones', n: 1, f: (x) => x.n }, { h: 'Monto', n: 1, f: (x) => mon(x.monto, x.moneda) }, { h: 'Equiv. USD', n: 1, f: (x) => usd(x.monto_usd) }], r.por_medio)}${(r.vueltos || []).length ? `<h3 style="margin-top:12px">Vueltos entregados</h3>${A.tabla([{ h: 'Medio', f: (x) => e(A.MEDIOS[x.medio]) }, { h: 'Moneda', f: (x) => e(x.moneda) }, { h: 'Operaciones', n: 1, f: (x) => x.n }, { h: 'Monto', n: 1, f: (x) => mon(x.monto, x.moneda) }, { h: 'Equiv. USD', n: 1, f: (x) => usd(x.monto_usd) }], r.vueltos)}` : ''}</div>
      <button class="btn bad lg" data-a="cerrar">Cerrar mi caja</button>${hist}`;
    A.acciones(root, { cerrar: () => A.form('Cierre de caja — conteo de efectivo', [
      { n: 'USD', l: `Efectivo USD contado (esperado ${fm(r.esperado.USD)})`, t: 'number', req: true }, { n: 'VES', l: `Efectivo Bs contado (esperado ${fm(r.esperado.VES)})`, t: 'number', req: true },
      { n: 'EUR', l: `Efectivo € contado (esperado ${fm(r.esperado.EUR)})`, t: 'number', req: true }, { n: 'comentario', l: 'Comentario (obligatorio si hay diferencia)', t: 'textarea', full: true }],
      { USD: 0, VES: 0, EUR: 0 }, async (v) => {
        const x = await api.post('/api/turnos/cerrar', { contado: { USD: v.USD, VES: v.VES, EUR: v.EUR }, comentario: v.comentario });
        await A.refrescarEstado();
        A.modal('Caja cerrada', `<p>Ventas: <b>${x.ventas.n}</b> por <b>${usd(x.ventas.total)}</b></p>${A.tabla([{ h: 'Moneda', f: (m) => m[0] }, { h: 'Esperado', n: 1, f: (m) => fm(m[1]) }, { h: 'Contado', n: 1, f: (m) => fm(m[2]) }, { h: 'Diferencia', n: 1, f: (m) => `<span class="${Math.abs(m[3]) > 0.005 ? 'bad' : 'ok'}">${fm(m[3])}</span>` }], ['USD', 'VES', 'EUR'].map((m) => [m, x.esperado[m], x.contado[m], x.diferencias[m]]))}`,
          { pie: '<button class="btn pri" data-c>Listo</button>', onMount: (vv, c) => { $('[data-c]', vv).onclick = () => { c(); A.render(); }; } });
      }, { ok: 'Cerrar caja' }) });
  };

  // ======================= VENTAS =======================
  A.vistas.ventas = async (root) => {
    const f = { desde: A.hoy(), hasta: A.hoy(), estado: '', q: '' };
    root.innerHTML = `<h1>Ventas</h1><div class="card"><div class="row"><div><label>Desde</label><input id="d" type="date" value="${f.desde}"></div><div><label>Hasta</label><input id="h" type="date" value="${f.hasta}"></div>
      <div><label>Estado</label><select id="s"><option value="">Todas</option><option value="completada">Completadas</option><option value="anulada">Anuladas</option></select></div><div class="grow"><label>Buscar</label><input id="q" placeholder="N° de venta o cliente"></div></div></div><div class="card" id="lst"></div>`;
    let rows = [];
    async function cargar() {
      rows = await api.get('/api/ventas' + A.qs({ desde: $('#d', root).value, hasta: $('#h', root).value, estado: $('#s', root).value, q: $('#q', root).value }));
      const tot = rows.filter((r) => r.estado === 'completada').reduce((a, r) => a + r.total_usd, 0);
      $('#lst', root).innerHTML = `<p class="muted">${rows.length} ventas · total completadas ${usd(tot)}</p>` + A.tabla([{ h: 'N°', f: (r) => e(r.numero) }, { h: 'Fecha', f: (r) => A.fecha(r.fecha) }, { h: 'Cliente', f: (r) => e(r.cliente || 'Consumidor final') }, { h: 'Origen', f: (r) => e(r.origen) }, { h: 'Cajero', f: (r) => e(r.usuario) },
        { h: 'Total', n: 1, f: (r) => usd(r.total_usd) }, { h: 'Estado', f: (r) => A.estadoTag(r.estado) }], rows, { clic: true });
      $('#lst', root).querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => detalle(rows[+tr.dataset.i].id));
    }
    async function detalle(id) {
      const v = await api.get('/api/ventas/' + id);
      A.modal('Venta ' + v.numero, `<p>${A.fecha(v.fecha)} · ${e(v.cliente || 'Consumidor final')} · ${A.estadoTag(v.estado)} ${v.motivo_anulacion ? `<br><span class="bad">Anulada: ${e(v.motivo_anulacion)} (${e(v.anulada_por)})</span>` : ''}</p>
        ${A.tabla([{ h: 'Producto', f: (i) => e(i.nombre) }, { h: 'Cant.', n: 1, f: (i) => fm(i.cantidad, 2) }, { h: 'Precio', n: 1, f: (i) => usd(i.precio_usd) }, { h: 'Subtotal', n: 1, f: (i) => usd(i.cantidad * i.precio_usd) }], v.items)}
        <h3 style="margin-top:12px">Pagos</h3>${A.tabla([{ h: 'Medio', f: (p) => e(A.MEDIOS[p.medio]) + (p.tipo === 'vuelto' ? ' <span class="tag">vuelto entregado</span>' : '') }, { h: 'Monto', n: 1, f: (p) => mon(p.monto, p.moneda) }, { h: 'Tasa', n: 1, f: (p) => fm(p.tasa, 4) }, { h: 'USD', n: 1, f: (p) => usd(p.monto_usd) }, { h: 'Ref.', f: (p) => e(p.referencia || '') }], v.pagos)}
        <p class="r"><b>Total ${usd(v.total_usd)}</b>${v.descuento_usd > 0 ? ` (desc. ${usd(v.descuento_usd)})` : ''}${v.vuelto_usd > 0 ? ` · vuelto ${usd(v.vuelto_usd)}` : ''}</p>`,
        { ancho: true, pie: `<button class="btn" data-p>Imprimir</button>${v.estado === 'completada' && A.can('ventas.anular') ? '<button class="btn bad" data-an>Anular venta</button>' : ''}`, onMount: (m, c) => {
          $('[data-p]', m).onclick = () => A.imprimirVenta(id);
          const an = $('[data-an]', m); if (an) an.onclick = async () => { const mo = await A.pedirMotivo('Motivo de la anulación'); if (!mo) return; try { await api.post(`/api/ventas/${id}/anular`, { motivo: mo }); A.ok('Venta anulada'); c(); cargar(); } catch (er) { A.fail(er); } };
        } });
    }
    root.querySelectorAll('input,select').forEach((el) => el.onchange = el.oninput = A.debounce(() => cargar().catch(A.fail), 250));
    cargar();
  };
})();
