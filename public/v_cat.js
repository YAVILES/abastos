'use strict';
// Vistas de catálogo e inventario: productos, existencias, conteos cíclicos, proveedores, clientes.
(() => {
  const A = Abasto, { e, fm, usd, mon, api, S } = A;
  const $ = (s, r = document) => r.querySelector(s);
  const opts = (rows, vacio) => [['', vacio || '— ninguno —'], ...rows.map((r) => [r.id, r.nombre])];

  // ======================= PRODUCTOS =======================
  A.vistas.productos = async (root) => {
    const [cats, provs] = await Promise.all([api.get('/api/categorias'), api.get('/api/proveedores?activo=1')]);
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Maestro de productos</h1><div class="chips">
      ${A.can('productos.editar') ? '<button class="btn pri" data-a="nuevo">+ Nuevo producto</button><button class="btn" data-a="importar">Importar CSV</button><button class="btn" data-a="cats">Categorías</button>' : ''}<button class="btn" data-a="exportar">Exportar CSV</button></div></div>
      <div class="card"><div class="row"><div class="grow"><label>Buscar (nombre, código o barras)</label><input id="q" autofocus></div>
      <div><label>Categoría</label><select id="c">${opts(cats, 'Todas').map(([k, l]) => `<option value="${k}">${e(l)}</option>`).join('')}</select></div>
      <div><label>Estado</label><select id="a"><option value="1">Activos</option><option value="0">Inactivos</option><option value="">Todos</option></select></div></div></div><div class="card" id="lst"></div>`;
    let rows = [];
    async function cargar() {
      rows = await api.get('/api/productos' + A.qs({ q: $('#q', root).value, categoria_id: $('#c', root).value, activo: $('#a', root).value }));
      $('#lst', root).innerHTML = `<p class="muted">${rows.length} productos</p>` + A.tabla([
        { h: 'Código', f: (r) => e(r.codigo) }, { h: 'Producto', f: (r) => `<b>${e(r.nombre)}</b><div class="muted" style="font-size:11px">${e(r.barras || 'sin código de barras')}</div>` }, { h: 'Categoría', f: (r) => e(r.categoria || '') },
        { h: 'Stock', n: 1, f: (r) => `<span class="${r.stock_min > 0 && r.stock <= r.stock_min ? 'bad' : ''}">${fm(r.stock, 0)}</span>` }, { h: 'Mín', n: 1, f: (r) => fm(r.stock_min, 0) },
        { h: 'Costo', n: 1, f: (r) => usd(r.costo_usd) }, { h: 'Precio', n: 1, f: (r) => usd(r.precio_usd) }, { h: 'Margen', n: 1, f: (r) => r.costo_usd > 0 && r.precio_usd > 0 ? fm((r.precio_usd - r.costo_usd) / r.costo_usd * 100, 1) + '%' : '—' },
        { h: '', f: (r) => (r.activo ? '' : A.tag('inactivo', 'bad')) + (r.precio_fijo ? '' : ' ' + A.tag('margen', 'info')) }], rows, { clic: true });
      $('#lst', root).querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => A.can('productos.editar') && editar(rows[+tr.dataset.i].id));
    }
    async function editar(id) {
      const p = id ? await api.get('/api/productos/' + id) : { activo: 1, precio_fijo: 1, factor: 1, margen: 30, unidad_compra: 'unidad', unidad_venta: 'unidad', codigos: [] };
      const cp = A.can('precio.cambiar') || !id;
      const campos = [
        { n: 'nombre', l: 'Nombre', req: true, full: true }, { n: 'codigo', l: 'Código interno', ph: 'Automático si se deja vacío', ro: !!id }, { n: 'categoria_id', l: 'Categoría', t: 'select', o: opts(cats) },
        { n: 'marca', l: 'Marca' }, { n: 'presentacion', l: 'Presentación', ph: 'Ej. 1 kg' }, { n: 'unidad_compra', l: 'Unidad de compra', ph: 'caja, bulto…' }, { n: 'unidad_venta', l: 'Unidad de venta', ph: 'unidad, kg…' },
        { n: 'factor', l: 'Unidades de venta por unidad de compra', t: 'number', min: 0.0001, ayuda: 'Ej. 1 caja = 24 unidades' }, { n: 'proveedor_id', l: 'Proveedor principal', t: 'select', o: opts(provs) },
        { n: 'costo_usd', l: 'Costo (USD por unidad de venta)', t: 'number', min: 0, ro: !cp }, { n: 'precio_fijo', l: 'Precio fijo (sin recalcular por margen)', t: 'checkbox' },
        { n: 'margen', l: 'Margen sobre costo %', t: 'number', min: 0, ro: !cp }, { n: 'precio_usd', l: 'Precio de venta USD', t: 'number', min: 0, ro: !cp, ayuda: 'Si no es precio fijo se calcula del costo y el margen.' },
        { n: 'stock_min', l: 'Stock mínimo', t: 'number', min: 0 }, { n: 'stock_max', l: 'Stock máximo', t: 'number', min: 0 }, { n: 'ubicacion', l: 'Ubicación', ph: 'Pasillo 1' },
        id ? { n: 'activo', l: 'Activo', t: 'checkbox' } : { n: 'stock_inicial', l: 'Existencia inicial', t: 'number', min: 0 },
        { n: 'codigos_txt', l: 'Códigos de barras (uno por línea; el primero es el principal)', t: 'textarea', full: true }];
      await A.form(id ? 'Editar producto' : 'Nuevo producto', campos, { ...p, codigos_txt: (p.codigos || []).join('\n') }, async (v) => {
        const body = { ...v, codigos: v.codigos_txt.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) };
        delete body.codigos_txt;
        if (id) await api.put('/api/productos/' + id, body); else await api.post('/api/productos', body);
        A.ok('Producto guardado'); cargar();
      }, { ancho: true });
    }
    A.acciones(root, {
      nuevo: () => editar(null),
      exportar: () => A.descargarCSV('productos.csv', [['codigo_interno', 'codigo_barra', 'nombre', 'categoria', 'stock', 'stock_minimo', 'costo_usd', 'precio_usd', 'estado'], ...rows.map((r) => [r.codigo, (r.barras || '').split(',')[0].trim(), r.nombre, r.categoria, r.stock, r.stock_min, r.costo_usd, r.precio_usd, r.activo ? 'activo' : 'inactivo'])]),
      cats: () => A.modal('Categorías', `<div id="cl"></div><form id="cf" class="row" style="margin-top:12px"><div class="grow"><label>Nueva categoría</label><input name="n" required></div><button class="btn pri">Agregar</button></form>`, { onMount: (v) => {
        const pintar = async () => { const c = await api.get('/api/categorias'); $('#cl', v).innerHTML = A.tabla([{ h: 'Categoría', f: (r) => e(r.nombre) }], c); };
        $('#cf', v).onsubmit = async (ev) => { ev.preventDefault(); try { await api.post('/api/categorias', { nombre: ev.target.n.value }); ev.target.reset(); pintar(); } catch (er) { A.fail(er); } }; pintar(); } }),
      importar: () => A.modal('Importar productos desde CSV', `<p class="muted">Columnas: codigo_barra, codigo_interno, nombre, categoria, marca, presentacion, unidad_compra, unidad_venta, factor_conversion, costo_usd, precio_venta_usd, margen_utilidad, precio_fijo, stock_actual, stock_minimo, stock_maximo, proveedor_principal, ubicacion. Si el código ya existe se actualiza; la existencia solo se carga en productos nuevos.</p>
        <input type="file" id="fi" accept=".csv,text/csv"><div id="ir" style="margin-top:12px"></div>`, { ancho: true, onMount: (v) => { $('#fi', v).onchange = async (ev) => {
          const txt = await ev.target.files[0].text();
          try { const r = await api.post('/api/productos/importar', { csv: txt }); $('#ir', v).innerHTML = `<p class="ok"><b>${r.creados}</b> creados · <b>${r.actualizados}</b> actualizados</p>${r.errores.length ? `<div class="bad">${r.errores.map(e).join('<br>')}</div>` : ''}`; cargar(); }
          catch (er) { A.fail(er); } }; } })
    });
    root.querySelectorAll('input,select').forEach((el) => el.oninput = el.onchange = A.debounce(() => cargar().catch(A.fail), 250));
    cargar();
  };

  // ======================= EXISTENCIAS =======================
  A.vistas.inventario = async (root) => {
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Existencias</h1><a class="btn" href="#/compras/sugerencias">Sugerencias de compra</a></div>
      <div class="card"><div class="row"><div class="grow"><label>Buscar</label><input id="q"></div><label style="display:flex;gap:6px;align-items:center;margin:0 0 8px"><input type="checkbox" id="b"> Solo bajo mínimo</label></div></div><div class="card" id="lst"></div>`;
    let rows = [];
    async function cargar() {
      const q = $('#q', root).value.toLowerCase();
      rows = (await api.get('/api/inventario' + A.qs({ bajo_minimo: $('#b', root).checked ? 1 : '' }))).filter((r) => !q || (r.nombre + r.codigo + (r.barras || '')).toLowerCase().includes(q));
      const valor = rows.reduce((a, r) => a + r.valor_usd, 0);
      $('#lst', root).innerHTML = `<p class="muted">${rows.length} productos · valor del inventario ${usd(valor)}</p>` + A.tabla([
        { h: 'Código', f: (r) => e(r.codigo) }, { h: 'Producto', f: (r) => e(r.nombre) }, { h: 'Ubicación', f: (r) => e(r.ubicacion || '') }, { h: 'Existencia', n: 1, f: (r) => `<b class="${r.bajo_minimo ? 'bad' : ''}">${fm(r.stock, 2)}</b>` },
        { h: 'Reservado app', n: 1, f: (r) => r.reservado ? fm(r.reservado, 2) : '' }, { h: 'Disponible', n: 1, f: (r) => fm(r.disponible, 2) }, { h: 'Mín / Máx', n: 1, f: (r) => `${fm(r.stock_min, 0)} / ${fm(r.stock_max, 0)}` },
        { h: 'Valor USD', n: 1, f: (r) => usd(r.valor_usd) }, { h: '', f: (r, i) => `<button class="btn sm" data-a="kardex" data-i="${i}">Kardex</button> ${A.can('inventario.ajustar') ? `<button class="btn sm" data-a="ajuste" data-i="${i}">Ajustar</button>` : ''}` }], rows);
    }
    A.acciones(root, {
      kardex: async (el) => { const p = rows[+el.dataset.i]; const k = await api.get(`/api/productos/${p.id}/kardex`);
        A.modal('Kardex — ' + p.nombre, A.tabla([{ h: 'Fecha', f: (m) => A.fecha(m.fecha) }, { h: 'Tipo', f: (m) => e(m.tipo.replace(/_/g, ' ')) }, { h: 'Motivo', f: (m) => e(m.motivo || '') }, { h: 'Cantidad', n: 1, f: (m) => `<span class="${m.cantidad < 0 ? 'bad' : 'ok'}">${fm(m.cantidad, 2)}</span>` }, { h: 'Saldo', n: 1, f: (m) => fm(m.saldo, 2) }, { h: 'Usuario', f: (m) => e(m.usuario || '') }], k), { ancho: true }); },
      ajuste: (el) => { const p = rows[+el.dataset.i]; return A.form('Ajuste de inventario — ' + p.nombre, [
        { n: 'tipo', l: 'Tipo', t: 'select', o: [['ajuste', 'Ajuste (+/−)'], ['merma', 'Merma (vencido, dañado, robo)'], ['consumo_interno', 'Consumo interno']] },
        { n: 'cantidad', l: `Cantidad (negativa para salidas). Existencia actual: ${fm(p.stock, 2)}`, t: 'number', req: true }, { n: 'motivo', l: 'Motivo', t: 'textarea', req: true, full: true }], { tipo: 'ajuste' },
        async (v) => { await api.post('/api/inventario/ajuste', { ...v, producto_id: p.id }); A.ok('Ajuste registrado'); cargar(); }); }
    });
    root.querySelectorAll('input').forEach((el) => el.oninput = el.onchange = A.debounce(() => cargar().catch(A.fail), 200));
    cargar();
  };

  // ======================= CONTEOS CÍCLICOS =======================
  A.vistas.conteos = async (root, arg) => {
    if (arg) return detalleConteo(root, arg);
    const [abc, lista] = await Promise.all([api.get('/api/abc'), api.get('/api/conteos')]);
    const c = abc.cfg;
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Inventarios cíclicos (ABC)</h1>${A.can('conteos.generar') ? '<button class="btn pri" data-a="generar">Generar conteo del día</button>' : ''}</div>
      <div class="grid g4"><div class="kpi"><div class="l">Clase A (${c.pctA}% · ${c.vueltasA} vueltas/año)</div><div class="v">${abc.conteo.A}</div><div class="s">productos</div></div>
      <div class="kpi"><div class="l">Clase B (${c.pctB}% · ${c.vueltasB} vueltas/año)</div><div class="v">${abc.conteo.B}</div><div class="s">productos</div></div>
      <div class="kpi"><div class="l">Clase C (${c.pctC}% · ${c.vueltasC} vueltas/año)</div><div class="v">${abc.conteo.C}</div><div class="s">productos</div></div>
      <div class="kpi"><div class="l">Conteos por día</div><div class="v">${abc.items_diarios}</div><div class="s">${abc.items_anuales} al año / ${c.dias_operativos} días · criterio: ${e(c.criterio)}</div></div></div>
      <p class="muted">La parametrización se hace en <a href="#/parametros">Parámetros › Inventario cíclico</a>. La clasificación acumula el criterio elegido: los primeros productos que suman el ${c.pctA}% del total son A, el siguiente ${c.pctB}% B y el resto C.</p>
      <div class="card"><h2>Documentos de conteo</h2>${A.tabla([{ h: 'Documento', f: (r) => `<a href="#/conteos/${r.id}">${e(r.numero)}</a>` }, { h: 'Fecha', f: (r) => A.fecha(r.fecha) }, { h: 'Responsable', f: (r) => e(r.responsable) }, { h: 'Ítems', n: 1, f: (r) => r.items }, { h: 'Con diferencia', n: 1, f: (r) => (r.con_diferencia == null ? '—' : r.con_diferencia) }, { h: 'Estado', f: (r) => A.estadoTag(r.estado) }], lista, { vacio: 'Aún no hay conteos' })}</div>`;
    A.acciones(root, { generar: async () => {
      const hay = lista.find((x) => x.fecha.slice(0, 10) === A.hoy() && ['generado', 'cargado'].includes(x.estado));
      await A.form('Generar conteo del día', [{ n: 'responsable', l: 'Responsable del conteo', req: true }, ...(hay && A.can('conteos.autorizar') ? [{ n: 'regenerar', l: `Regenerar (anula ${hay.numero})`, t: 'checkbox' }] : [])],
        { responsable: S.user.nombre }, async (v) => { const r = await api.post('/api/conteos/generar', v); A.ok('Documento ' + r.numero + ' generado: ' + r.items + ' ítems'); A.ir('conteos/' + r.id); },
        { ok: 'Generar conteo', extra: `<div class="card" style="margin:12px 0 0;background:var(--brand-l)"><b>Hoy corresponde contar ${abc.items_diarios} ítem${abc.items_diarios === 1 ? "" : "s"}</b> — A: ${abc.cuota_hoy.A} · B: ${abc.cuota_hoy.B} · C: ${abc.cuota_hoy.C}<div class="muted" style="font-size:12px;margin-top:6px">Cálculo del plan: (${abc.conteo.A} A × ${c.vueltasA} vueltas + ${abc.conteo.B} B × ${c.vueltasB} + ${abc.conteo.C} C × ${c.vueltasC}) ÷ ${c.dias_operativos} días operativos = ${abc.items_anuales} ÷ ${c.dias_operativos}, redondeado hacia arriba. La cantidad no se elige: sale del plan. Los productos se sortean al azar dentro de cada clase, con más probabilidad para los que llevan más tiempo sin contarse, están bajo mínimo o tuvieron diferencias.</div></div>` }); } });
  };
  // Hoja de conteo físico: SIEMPRE a ciegas (sin cantidad del sistema, sin diferencias, sin clase ni motivo de selección)
  function imprimirHoja(c) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return A.toast('Permite las ventanas emergentes para imprimir', 'bad');
    w.document.write(`<html><head><title>Conteo ${e(c.numero)}</title><style>body{font:13px system-ui,sans-serif;margin:18px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #666;padding:7px 8px;text-align:left;vertical-align:middle}th{background:#eee}.cant{width:130px;height:36px}.obs{width:200px}.n{text-align:center;width:34px}.firmas{margin-top:36px;display:flex;gap:40px}.firmas div{flex:1;border-top:1px solid #000;padding-top:4px;text-align:center}</style></head><body>
      <h2>Hoja de conteo físico — ${e(c.numero)}</h2><div>Conteo a ciegas · Fecha ${e(A.fecha(c.fecha))} · Responsable: <b>${e(c.responsable)}</b> · ${c.items.length} producto(s)</div>
      <p style="margin:8px 0 0">Cuenta físicamente cada producto y anota la cantidad exacta que encuentres. Esta hoja no muestra la cantidad del sistema.</p>
      <table><thead><tr><th class="n">#</th><th>Código</th><th>Código de barras</th><th>Producto</th><th>Ubicación</th><th>Cantidad física</th><th>Observación</th></tr></thead><tbody>
      ${c.items.map((i, n) => `<tr><td class="n">${n + 1}</td><td>${e(i.codigo)}</td><td>${e(i.barra || '')}</td><td><b>${e(i.nombre)}</b></td><td>${e(i.ubicacion || '')}</td><td class="cant"></td><td class="obs"></td></tr>`).join('')}</tbody></table>
      <div class="firmas"><div>Contó (nombre y firma)</div><div>Revisó / Validó</div></div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  }
  async function detalleConteo(root, id) {
    const c = await api.get('/api/conteos/' + encodeURIComponent(id));
    const ciego = !!c.ciego; // quien cuenta no ve lo que dice el sistema; solo un supervisor (que autoriza ajustes)
    const editable = ['generado', 'cargado'].includes(c.estado) && A.can('conteos.cargar');
    const dif = c.items.filter((i) => i.diferencia != null && Math.abs(i.diferencia) > 0.0001);
    const valorDif = dif.reduce((a, i) => a + i.diferencia * i.costo_usd, 0);
    const colSup = (t, cls = '') => (ciego ? '' : `<th class="${cls}">${t}</th>`);
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Conteo ${e(c.numero)} ${A.estadoTag(c.estado)}</h1><div class="chips"><a class="btn" href="#/conteos">← Volver</a><button class="btn" data-a="imprimir">Imprimir hoja de conteo</button></div></div>
      <div class="card"><p>Fecha ${A.fecha(c.fecha)} · Responsable: <b>${e(c.responsable)}</b> · Generado por ${e(c.generado_por || '')} ${c.autorizado_por ? `· Autorizó ${e(c.autorizado_por)}` : ''}</p>
      <p class="muted" style="margin-top:0">${ciego ? '<b>Conteo a ciegas:</b> cuenta físicamente cada producto y anota lo que encuentres. El sistema no te muestra su cantidad; el supervisor compara después.' : '<b>Conteo a ciegas:</b> quien cuenta no ve estas cantidades del sistema (ni en la pantalla ni en la hoja impresa). Tú las ves porque autorizas los ajustes.'}</p>
      ${!ciego && (c.estado === 'cargado' || c.estado === 'cerrado') ? `<p>Diferencias: <b>${dif.length}</b> ítems · valor neto <b class="${valorDif < 0 ? 'bad' : ''}">${usd(valorDif)}</b></p>` : ''}
      <div class="scroll"><table><thead><tr><th>#</th><th>Código</th><th>Barras</th><th>Producto</th><th>Ubicación</th>${colSup('Clase')}${colSup('Motivo de selección')}${colSup('Sistema', 'n')}<th class="n">Contado</th>${colSup('Diferencia', 'n')}<th>Observación</th></tr></thead><tbody>
      ${c.items.map((i, n) => `<tr><td>${n + 1}</td><td>${e(i.codigo)}</td><td>${e(i.barra || '')}</td><td><b>${e(i.nombre)}</b></td><td>${e(i.ubicacion || '')}</td>
        ${ciego ? '' : `<td>${e(i.clase)}</td><td class="muted" style="font-size:11px">${e(i.motivo || '')}</td><td class="n">${fm(i.stock_sistema, 2)}</td>`}
        <td class="n">${editable && !i.ajustado ? `<input data-id="${i.id}" data-k="contado" type="number" step="any" min="0" value="${i.contado ?? ''}" style="width:90px;text-align:right">` : i.contado == null ? '' : fm(i.contado, 2)}</td>
        ${ciego ? '' : `<td class="n ${i.diferencia ? (i.diferencia < 0 ? 'bad' : 'ok') : ''}">${i.diferencia == null ? '' : fm(i.diferencia, 2)}${i.ajustado ? ' ✔' : ''}</td>`}
        <td>${editable && !i.ajustado ? `<input data-id="${i.id}" data-k="observacion" value="${e(i.observacion || '')}">` : e(i.observacion || '')}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="chips">${editable ? '<button class="btn pri" data-a="cargar">Guardar resultados del conteo</button>' : ''}${c.estado === 'cargado' && A.can('conteos.autorizar') ? '<button class="btn bad" data-a="autorizar">Autorizar ajustes de inventario</button>' : ''}</div>`;
    A.acciones(root, {
      imprimir: () => imprimirHoja(c),
      cargar: async () => {
        const mapa = {};
        root.querySelectorAll('input[data-id]').forEach((el) => { (mapa[el.dataset.id] ||= { id: +el.dataset.id })[el.dataset.k] = el.value; });
        const r = await api.post(`/api/conteos/${c.id}/cargar`, { items: Object.values(mapa) });
        A.ok(r.pendientes ? `Guardado. Faltan ${r.pendientes} ítems por contar` : 'Resultados cargados'); A.render();
      },
      autorizar: async () => { if (!await A.confirmar('Autorizar ajustes', `Se ajustará el inventario en ${dif.length} producto(s) por un valor neto de ${usd(valorDif)}.`, { ok: 'Autorizar', peligro: true })) return;
        const r = await api.post(`/api/conteos/${c.id}/autorizar`, {}); A.ok(`${r.ajustes} ajuste(s) aplicados`); A.render(); }
    });
  }

  // ======================= PROVEEDORES =======================
  A.vistas.proveedores = async (root) => {
    const rows = await api.get('/api/proveedores');
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Proveedores</h1>${A.can('proveedores.editar') ? '<button class="btn pri" data-a="nuevo">+ Nuevo proveedor</button>' : ''}</div>
      <div class="card">${A.tabla([{ h: 'Proveedor', f: (r) => `<b>${e(r.nombre)}</b> ${r.activo ? '' : A.tag('inactivo', 'bad')}` }, { h: 'RIF', f: (r) => e(r.rif || '') }, { h: 'Teléfono', f: (r) => e(r.telefono || '') }, { h: 'Contacto', f: (r) => e(r.contacto || '') },
        { h: 'Crédito (días)', n: 1, f: (r) => r.dias_credito }, { h: 'Entrega (días)', n: 1, f: (r) => r.plazo_entrega }, { h: 'Deuda USD', n: 1, f: (r) => r.deuda_usd > 0 ? `<b class="warn">${usd(r.deuda_usd)}</b>` : '—' }, { h: '', f: (r, i) => `<button class="btn sm" data-a="hist" data-i="${i}">Estado de cuenta</button>` }], rows, { clic: true })}</div>`;
    const campos = [{ n: 'nombre', l: 'Nombre / razón social', req: true, full: true }, { n: 'rif', l: 'RIF' }, { n: 'telefono', l: 'Teléfono' }, { n: 'correo', l: 'Correo' }, { n: 'contacto', l: 'Persona de contacto' },
      { n: 'dias_credito', l: 'Días de crédito', t: 'number', min: 0 }, { n: 'plazo_entrega', l: 'Plazo de entrega (días)', t: 'number', min: 1, ayuda: 'Cuántos días tarda en llegar un pedido: se usa para sugerir compras' }, { n: 'direccion', l: 'Dirección', full: true }];
    const editar = (p) => A.form(p ? 'Editar proveedor' : 'Nuevo proveedor', p ? [...campos, { n: 'activo', l: 'Activo', t: 'checkbox' }] : campos, p || { dias_credito: 0, plazo_entrega: 3 }, async (v) => { if (p) await api.put('/api/proveedores/' + p.id, v); else await api.post('/api/proveedores', v); A.ok('Guardado'); A.render(); });
    A.acciones(root, { nuevo: () => editar(null),
      hist: (el, ev) => { ev.stopPropagation(); A.estadoCuentaProveedor(rows[+el.dataset.i].id).catch(A.fail); } });
    root.querySelectorAll('tr.click').forEach((tr) => tr.onclick = (ev) => { if (!ev.target.closest('button') && A.can('proveedores.editar')) editar(rows[+tr.dataset.i]); });
  };

  // ======================= CLIENTES =======================
  A.vistas.clientes = async (root) => {
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">Clientes y crédito</h1>${A.can('clientes.editar') ? '<button class="btn pri" data-a="nuevo">+ Nuevo cliente</button>' : ''}</div>
      <div class="card"><div class="row"><div class="grow"><label>Buscar</label><input id="q"></div><label style="display:flex;gap:6px;align-items:center;margin:0 0 8px"><input type="checkbox" id="cc"> Solo con crédito</label></div></div><div class="card" id="lst"></div>`;
    let rows = [];
    async function cargar() {
      rows = await api.get('/api/clientes' + A.qs({ q: $('#q', root).value, con_credito: $('#cc', root).checked ? 1 : '' }));
      $('#lst', root).innerHTML = A.tabla([{ h: 'Cliente', f: (r) => `<b>${e(r.nombre)}</b> ${r.estado === 'suspendido' ? A.tag('suspendido', 'bad') : ''}` }, { h: 'Documento', f: (r) => e(r.documento || '') }, { h: 'Teléfono', f: (r) => e(r.telefono || '') },
        { h: 'Crédito', f: (r) => r.credito_habilitado ? A.tag('habilitado', 'info') : '<span class="muted">contado</span>' }, { h: 'Límite', n: 1, f: (r) => r.credito_habilitado ? usd(r.limite_usd) : '' }, { h: 'Deuda', n: 1, f: (r) => r.deuda_usd > 0 ? `<b>${usd(r.deuda_usd)}</b>` : '' },
        { h: 'Vencido', n: 1, f: (r) => r.vencido_usd > 0 ? `<b class="bad">${usd(r.vencido_usd)}</b>` : '' }, { h: 'App', f: (r) => r.tiene_app ? '✓' : '' }], rows, { clic: true });
      $('#lst', root).querySelectorAll('tr.click').forEach((tr) => tr.onclick = () => ficha(rows[+tr.dataset.i].id));
    }
    async function ficha(id) {
      const c = await api.get('/api/clientes/' + id);
      A.modal(c.nombre, `<div class="grid g3"><div class="kpi"><div class="l">Límite</div><div class="v">${usd(c.limite_usd)}</div></div><div class="kpi"><div class="l">Deuda</div><div class="v">${usd(c.deuda_usd)}</div></div><div class="kpi"><div class="l">Vencido</div><div class="v ${c.vencido_usd > 0 ? 'bad' : ''}">${usd(c.vencido_usd)}</div></div></div>
        <h3 style="margin-top:14px">Cuentas por cobrar</h3>${A.tabla([{ h: 'Venta', f: (x) => e(x.venta || '') }, { h: 'Vence', f: (x) => e(x.vence) }, { h: 'Total', n: 1, f: (x) => usd(x.total_usd) }, { h: 'Saldo', n: 1, f: (x) => usd(x.saldo_usd) }, { h: 'Estado', f: (x) => A.estadoTag(x.estado) }], c.cxc)}
        <h3 style="margin-top:14px">Últimas compras</h3>${A.tabla([{ h: 'N°', f: (x) => e(x.numero) }, { h: 'Fecha', f: (x) => A.fecha(x.fecha) }, { h: 'Total', n: 1, f: (x) => usd(x.total_usd) }, { h: 'Estado', f: (x) => A.estadoTag(x.estado) }], c.ventas)}`,
        { ancho: true, pie: `${A.can('clientes.editar') ? '<button class="btn" data-pin>Asignar PIN de app</button><button class="btn" data-ed>Editar</button>' : ''}<a class="btn pri" href="#/cxc/${id}" data-go>Ir a cobranza</a>`, onMount: (v, cerrar) => {
          const ed = $('[data-ed]', v); if (ed) ed.onclick = () => { cerrar(); editar(c); }; $('[data-go]', v).onclick = cerrar;
          const pin = $('[data-pin]', v); if (pin) pin.onclick = () => A.form('PIN de acceso a la app', [{ n: 'pin', l: 'PIN (4 a 8 dígitos)', req: true, ph: '1234' }], {}, async (x) => { await api.post(`/api/clientes/${id}/pin`, x); A.ok('PIN asignado'); });
        } });
    }
    const editar = (c) => {
      const campos = [{ n: 'nombre', l: 'Nombre', req: true, full: true }, { n: 'documento', l: 'Cédula / RIF' }, { n: 'telefono', l: 'Teléfono (usuario de la app)' }, { n: 'direccion', l: 'Dirección', full: true },
        { n: 'estado', l: 'Estado', t: 'select', o: [['activo', 'Activo'], ['suspendido', 'Suspendido']] }, { n: 'credito_habilitado', l: 'Crédito habilitado', t: 'checkbox' }, { n: 'limite_usd', l: 'Límite de crédito USD', t: 'number', min: 0 }, { n: 'dias_credito', l: 'Días de crédito', t: 'number', min: 0 }];
      return A.form(c ? 'Editar cliente' : 'Nuevo cliente', campos, c || { estado: 'activo', dias_credito: 7, limite_usd: 0 }, async (v) => { if (c) await api.put('/api/clientes/' + c.id, v); else await api.post('/api/clientes', v); A.ok('Guardado'); cargar(); },
        { extra: A.can('credito.autorizar') ? '' : '<p class="muted" style="margin-top:8px">El crédito solo lo puede habilitar o modificar un supervisor.</p>' });
    };
    A.acciones(root, { nuevo: () => editar(null) });
    root.querySelectorAll('input').forEach((el) => el.oninput = el.onchange = A.debounce(() => cargar().catch(A.fail), 220));
    cargar();
  };
})();
