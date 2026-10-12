'use strict';
// Reportes y parámetros del sistema.
(() => {
  const A = Abasto, { e, fm, usd, mon, api } = A;
  const $ = (s, r = document) => r.querySelector(s);

  // ======================= REPORTES =======================
  A.vistas.reportes = async (root, arg) => {
    const tab = arg || 'ventas';
    const tabs = [['ventas', 'Ventas'], ['utilidad', 'Utilidad por producto'], ['conteos', 'Cumplimiento de conteos'], ['auditoria', 'Auditoría']];
    root.innerHTML = `<h1>Reportes</h1><div class="chips" style="margin-bottom:12px">${tabs.map(([k, l]) => `<a class="btn ${k === tab ? 'pri' : ''}" href="#/reportes/${k}">${l}</a>`).join('')}</div>
      <div class="card no-print ${tab === 'conteos' || tab === 'auditoria' ? '' : ''}" ${tab === 'conteos' || tab === 'auditoria' ? 'hidden' : ''}><div class="row"><div><label>Desde</label><input id="d" type="date" value="${A.hoy()}"></div><div><label>Hasta</label><input id="h" type="date" value="${A.hoy()}"></div>
      <button class="btn" id="hoy7">Últimos 7 días</button><button class="btn" id="mes">Este mes</button><button class="btn" onclick="window.print()">Imprimir</button></div></div><div id="out"></div>`;
    const out = $('#out', root);
    const rango = () => ({ desde: $('#d', root).value, hasta: $('#h', root).value });
    const R = {
      async ventas() {
        const r = await api.get('/api/reportes/ventas' + A.qs(rango()));
        out.innerHTML = `<div class="grid g3"><div class="kpi"><div class="l">Ventas</div><div class="v">${usd(r.totales.total)}</div><div class="s">${r.totales.n} operaciones</div></div><div class="kpi"><div class="l">Ticket promedio</div><div class="v">${usd(r.totales.n ? r.totales.total / r.totales.n : 0)}</div></div><div class="kpi"><div class="l">Descuentos</div><div class="v">${usd(r.totales.descuentos)}</div></div></div>
          <div class="grid g2" style="margin-top:14px"><div class="card"><h2>Por día</h2>${A.tabla([{ h: 'Día', f: (x) => e(x.dia) }, { h: 'Ventas', n: 1, f: (x) => x.n }, { h: 'Total', n: 1, f: (x) => usd(x.total) }], r.por_dia)}</div>
          <div class="card"><h2>Por medio de pago</h2>${A.tabla([{ h: 'Medio', f: (x) => e(A.MEDIOS[x.medio]) }, { h: 'Moneda', f: (x) => e(x.moneda) }, { h: 'Monto', n: 1, f: (x) => mon(x.monto, x.moneda) }, { h: 'USD', n: 1, f: (x) => usd(x.usd) }], r.por_medio)}</div>
          <div class="card"><h2>Por cajero</h2>${A.tabla([{ h: 'Usuario', f: (x) => e(x.usuario) }, { h: 'Ventas', n: 1, f: (x) => x.n }, { h: 'Total', n: 1, f: (x) => usd(x.total) }], r.por_cajero)}</div>
          <div class="card"><h2>Por origen</h2>${A.tabla([{ h: 'Origen', f: (x) => e(x.origen === 'app' ? 'App de clientes' : 'Punto de venta') }, { h: 'Ventas', n: 1, f: (x) => x.n }, { h: 'Total', n: 1, f: (x) => usd(x.total) }], r.por_origen)}</div></div>`;
      },
      async utilidad() {
        const r = await api.get('/api/reportes/utilidad' + A.qs(rango()));
        const tv = r.filas.reduce((a, x) => a + x.venta, 0), tc = r.filas.reduce((a, x) => a + x.costo, 0);
        out.innerHTML = `<div class="grid g3"><div class="kpi"><div class="l">Venta neta</div><div class="v">${usd(tv)}</div></div><div class="kpi"><div class="l">Costo de ventas</div><div class="v">${usd(tc)}</div></div><div class="kpi"><div class="l">Utilidad bruta</div><div class="v ok">${usd(tv - tc)}</div><div class="s">${tv ? fm((tv - tc) / tv * 100, 1) : 0}% de margen</div></div></div>
          <div class="card" style="margin-top:14px"><div class="r no-print"><button class="btn sm" id="csv">Exportar CSV</button></div>${A.tabla([{ h: 'Producto', f: (x) => e(x.nombre) }, { h: 'Categoría', f: (x) => e(x.categoria || '') }, { h: 'Cant.', n: 1, f: (x) => fm(x.cantidad, 0) }, { h: 'Venta', n: 1, f: (x) => usd(x.venta) }, { h: 'Costo', n: 1, f: (x) => usd(x.costo) }, { h: 'Utilidad', n: 1, f: (x) => usd(x.utilidad) }, { h: 'Margen', n: 1, f: (x) => fm(x.margen_pct, 1) + '%' }], r.filas)}</div>`;
        const b = $('#csv', root); if (b) b.onclick = () => A.descargarCSV('utilidad.csv', [['codigo', 'producto', 'categoria', 'cantidad', 'venta', 'costo', 'utilidad', 'margen_pct'], ...r.filas.map((x) => [x.codigo, x.nombre, x.categoria, x.cantidad, x.venta, x.costo, x.utilidad, x.margen_pct])]);
      },
      async conteos() {
        const r = await api.get('/api/reportes/cumplimiento-conteos');
        out.innerHTML = `<div class="grid g3">${['A', 'B', 'C'].map((k) => { const c = r.por_clase[k]; const pct = c.productos ? c.contados / c.productos * 100 : 0; return `<div class="kpi"><div class="l">Clase ${k} — plan ${c.vueltas_plan} vueltas/año</div><div class="v">${c.contados} / ${c.productos}</div><div class="s">contados en 12 meses · ${c.conteos} conteos realizados</div><div class="barra" style="margin-top:8px"><i style="width:${pct}%"></i></div></div>`; }).join('')}</div>
          <div class="grid g2" style="margin-top:14px"><div class="card"><h2>Diferencias por producto (valor USD)</h2>${A.tabla([{ h: 'Producto', f: (x) => e(x.nombre) }, { h: 'Veces', n: 1, f: (x) => x.veces }, { h: 'Valor', n: 1, f: (x) => `<span class="${x.valor_usd < 0 ? 'bad' : ''}">${usd(x.valor_usd)}</span>` }], r.diferencias, { vacio: 'Sin diferencias registradas' })}</div>
          <div class="card"><h2>Pendientes de contar (${r.total_pendientes})</h2>${A.tabla([{ h: 'Código', f: (x) => e(x.codigo) }, { h: 'Producto', f: (x) => e(x.nombre) }, { h: 'Clase', f: (x) => x.clase }], r.pendientes, { vacio: 'Todo el inventario fue contado' })}</div></div>`;
      },
      async auditoria() {
        out.innerHTML = '<div class="card"><div class="row"><div><label>Acción contiene</label><input id="ac" placeholder="venta, precio, credito…"></div></div><div id="aud" style="margin-top:12px"></div></div>';
        const cargar = async () => { const r = await api.get('/api/auditoria' + A.qs({ accion: $('#ac', root).value })); $('#aud', root).innerHTML = A.tabla([{ h: 'Fecha', f: (x) => A.fecha(x.fecha) }, { h: 'Usuario', f: (x) => e(x.usuario || '') }, { h: 'Acción', f: (x) => e(x.accion) }, { h: 'Ref.', f: (x) => e((x.entidad || '') + ' ' + (x.ref || '')) }, { h: 'Detalle', f: (x) => `<span class="muted" style="font-size:11px">${e((x.detalle || '').slice(0, 160))}</span>` }], r); };
        $('#ac', root).oninput = A.debounce(cargar); cargar();
      }
    };
    const go = () => R[tab]().catch(A.fail);
    ['d', 'h'].forEach((id) => { const el = $('#' + id, root); if (el) el.onchange = go; });
    const s7 = $('#hoy7', root); if (s7) s7.onclick = () => { const d = new Date(Date.now() - 6 * 864e5); $('#d', root).value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; go(); };
    const sm = $('#mes', root); if (sm) sm.onclick = () => { $('#d', root).value = A.hoy().slice(0, 8) + '01'; go(); };
    go();
  };

  // ======================= PARÁMETROS =======================
  A.vistas.parametros = async (root, arg) => {
    const tab = arg || 'negocio';
    const tabs = [['negocio', 'Negocio'], ['operacion', 'Operación'], ['abc', 'Inventario cíclico ABC'], ['cuentas', 'Bancos y cajas'], ['medios', 'Pagos de la app'], ['lector', 'Lector de código de barras'], ['usuarios', 'Usuarios'], ['roles', 'Roles y permisos']];
    const edit = A.can('parametros.editar');
    root.innerHTML = `<h1>Parámetros</h1><div class="chips" style="margin-bottom:12px">${tabs.map(([k, l]) => ((k === 'usuarios' || k === 'roles') && !A.can('usuarios.editar') ? '' : `<a class="btn ${k === tab ? 'pri' : ''}" href="#/parametros/${k}">${l}</a>`)).join('')}</div><div id="out"></div>`;
    const out = $('#out', root);
    const dis = edit ? '' : 'disabled';
    const P = {
      async negocio() {
        const p = (await api.get('/api/parametros')).empresa;
        out.innerHTML = `<form class="card form" id="f"><fieldset style="display:contents" ${dis}>${[['nombre', 'Nombre o razón social'], ['rif', 'RIF'], ['telefono', 'Teléfono'], ['correo', 'Correo'], ['direccion', 'Dirección fiscal']].map(([k, l]) => `<div class="${k === 'direccion' ? 'full' : ''}"><label>${l}</label><input name="${k}" value="${e(p[k])}"></div>`).join('')}
          <div><label>Moneda base</label><input value="USD (dólares)" disabled></div></fieldset>${edit ? '<div class="full"><button class="btn pri">Guardar</button></div>' : ''}</form>`;
        out.insertAdjacentHTML('afterbegin', `<div class="card" id="logo-card" style="margin-bottom:14px"><h2>Logo de la empresa</h2>
          <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap"><div id="logo-vista" style="width:120px;height:120px;border:1px dashed var(--line,#ccc);border-radius:12px;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden">${p.logo ? `<img src="${p.logo}" alt="Logo" style="max-width:100%;max-height:100%">` : '<span class="muted" style="font-size:12px;text-align:center">Sin logo</span>'}</div>
          <div><p class="muted" style="margin:0 0 8px">Se muestra en el menú, en la app de clientes y en recibos, órdenes de compra y estados de cuenta. Sube una imagen cuadrada o apaisada (PNG con fondo transparente se ve mejor).</p>
          ${edit ? `<input type="file" id="logo-f" accept="image/png,image/jpeg,image/webp" hidden><button class="btn pri" id="logo-sub">${p.logo ? 'Cambiar logo' : 'Subir logo'}</button> ${p.logo ? '<button class="btn bad" id="logo-del">Quitar</button>' : ''}` : ''}</div></div></div>`);
        const guardarLogo = async (logo) => { try { await api.put('/api/parametros/empresa', { logo }); A.ok(logo ? 'Logo guardado' : 'Logo quitado'); await A.refrescarEstado(); A.render(); } catch (er) { A.fail(er); } };
        const sub = $('#logo-sub', root);
        if (sub) {
          sub.onclick = () => $('#logo-f', root).click();
          $('#logo-f', root).onchange = (ev) => {
            const file = ev.target.files[0]; if (!file) return;
            const img = new Image(), url = URL.createObjectURL(file);
            img.onload = () => {
              const k = Math.min(1, 320 / Math.max(img.width, img.height)), c = document.createElement('canvas');
              c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
              guardarLogo(c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9));
            };
            img.onerror = () => A.toast('No se pudo leer la imagen', 'bad'); img.src = url;
          };
        }
        const del = $('#logo-del', root); if (del) del.onclick = () => guardarLogo('');
        const lic = A.S.licencia || {}, rec = A.S.reconocimiento || {};
        out.insertAdjacentHTML('beforeend', `<div class="card"><h2>Plan, licencia y respaldo</h2><p>Código del abasto: <code>${e(A.S.empresa_codigo || '')}</code> · Plan <b>${e(lic.plan || '')}</b> · licencia ${e(lic.estado || '')} hasta <b>${e(lic.vence || '')}</b></p>
          <p>Reconocimiento por foto: ${rec.disponible ? `disponible (${rec.usados_mes} de ${rec.limite_mes} usados este mes)` : '<span class="muted">no está activado en este servidor</span>'}</p>
          <p>App de clientes: <a href="/tienda/${e(A.S.empresa_codigo || '')}/" target="_blank">/tienda/${e(A.S.empresa_codigo || '')}/</a></p>
          ${edit ? '<button class="btn" id="resp">Descargar respaldo de la base de datos</button><p class="muted" style="margin-top:8px">El servidor también guarda una copia automática cada día (se conservan las últimas 14).</p>' : ''}</div>`);
        const rb = $('#resp', root); if (rb) rb.onclick = () => A.descargar('/api/respaldo').then(() => A.ok('Respaldo descargado')).catch(A.fail);
        $('#f', root).onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; try { await api.put('/api/parametros/empresa', Object.fromEntries(['nombre', 'rif', 'telefono', 'correo', 'direccion'].map((k) => [k, f[k].value]))); A.ok('Guardado'); await A.refrescarEstado(); } catch (er) { A.fail(er); } };
      },
      async operacion() {
        const p = (await api.get('/api/parametros')).operacion;
        out.innerHTML = `<form class="card form" id="f"><fieldset style="display:contents" ${dis}>
          <div><label>Minutos de reserva de stock al confirmar un pedido</label><input name="reserva_minutos" type="number" min="1" value="${p.reserva_minutos}"></div>
          <div><label>Minutos de reserva tras reportar el pago</label><input name="reserva_extension_minutos" type="number" min="1" value="${p.reserva_extension_minutos}"></div>
          <div><label>Descuento máximo sin autorización (%)</label><input name="descuento_max_pct" type="number" min="0" step="any" value="${p.descuento_max_pct}"></div>
          <div><label>Margen por defecto en productos nuevos (%)</label><input name="margen_defecto" type="number" min="0" step="any" value="${p.margen_defecto}"></div>
          <div><label>Ciclo de compra (cada cuántos días haces pedidos)</label><input name="compra_ciclo_dias" type="number" min="1" max="90" value="${p.compra_ciclo_dias}"></div>
          <div><label>Cobertura máxima a comprar (días de venta)</label><input name="compra_cobertura_max_dias" type="number" min="7" max="365" value="${p.compra_cobertura_max_dias}"></div>
          <div class="full"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="stock_negativo" ${p.stock_negativo ? 'checked' : ''}> Permitir vender con existencia insuficiente (stock negativo)</label></div></fieldset>
          ${edit ? '<div class="full"><button class="btn pri">Guardar</button></div>' : ''}</form>`;
        $('#f', root).onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; try { await api.put('/api/parametros/operacion', { reserva_minutos: +f.reserva_minutos.value, reserva_extension_minutos: +f.reserva_extension_minutos.value, descuento_max_pct: +f.descuento_max_pct.value, margen_defecto: +f.margen_defecto.value, stock_negativo: f.stock_negativo.checked, compra_ciclo_dias: +f.compra_ciclo_dias.value, compra_cobertura_max_dias: +f.compra_cobertura_max_dias.value }); A.ok('Guardado'); } catch (er) { A.fail(er); } };
      },
      async abc() {
        const [pr, abc] = await Promise.all([api.get('/api/parametros'), api.get('/api/abc')]);
        const c = pr.abc;
        out.innerHTML = `<form class="card form" id="f"><fieldset style="display:contents" ${dis}>
          <div><label>Método</label><input value="ABC" disabled></div><div><label>Criterio de clasificación</label><select name="criterio">${[['valor', 'Valor de inventario'], ['movimiento', 'Movimiento (ventas 90 días)'], ['mixto', 'Movimiento + valor']].map(([k, l]) => `<option value="${k}" ${c.criterio === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>% acumulado A</label><input name="pctA" type="number" step="any" value="${c.pctA}"></div><div><label>Vueltas al año A</label><input name="vueltasA" type="number" step="any" value="${c.vueltasA}"></div>
          <div><label>% acumulado B</label><input name="pctB" type="number" step="any" value="${c.pctB}"></div><div><label>Vueltas al año B</label><input name="vueltasB" type="number" step="any" value="${c.vueltasB}"></div>
          <div><label>% acumulado C</label><input name="pctC" type="number" step="any" value="${c.pctC}"></div><div><label>Vueltas al año C</label><input name="vueltasC" type="number" step="any" value="${c.vueltasC}"></div>
          <div class="full"><label>Días operativos al año</label><input name="dias_operativos" type="number" min="1" value="${c.dias_operativos}" style="max-width:200px"></div></fieldset>
          <div class="full card" style="background:var(--brand-l)"><b>Resultado actual:</b> ${abc.total} productos activos → A: ${abc.conteo.A}, B: ${abc.conteo.B}, C: ${abc.conteo.C}. Ítems anuales = ${abc.items_anuales}. <b>Ítems diarios a contar: ${abc.items_diarios}</b> (redondeo hacia arriba de ítems anuales ÷ días operativos).</div>
          ${edit ? '<div class="full"><button class="btn pri">Guardar parámetros</button> <span class="muted">Los cambios quedan auditados. A + B + C debe sumar 100%.</span></div>' : ''}</form>`;
        $('#f', root).onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; try { await api.put('/api/parametros/abc', { criterio: f.criterio.value, ...Object.fromEntries(['pctA', 'pctB', 'pctC', 'vueltasA', 'vueltasB', 'vueltasC', 'dias_operativos'].map((k) => [k, +f[k].value])) }); A.ok('Guardado'); P.abc(); } catch (er) { A.fail(er); } };
      },
      async lector() {
        const c = (await api.get('/api/parametros')).lector;
        const L = A.lector;
        out.innerHTML = `<div class="grid g2" style="align-items:start">
          <form class="card form" id="f"><fieldset style="display:contents" ${dis}>
            <div class="full"><h2 style="margin:0">Lector de código de barras</h2><p class="muted" style="margin:4px 0 0">La mayoría de los lectores USB y Bluetooth funcionan como un teclado muy rápido: escriben el código y cierran con Enter o Tab. No necesitan instalación; solo ajustar estos datos.</p></div>
            <div class="full"><label>Tipo de equipo</label><select name="tipo"><option value="teclado" ${c.tipo === 'teclado' ? 'selected' : ''}>Lector USB / Bluetooth (funciona como teclado)</option><option value="serial" ${c.tipo === 'serial' ? 'selected' : ''}>Lector con puerto serial / COM (Chrome o Edge)</option><option value="camara" ${c.tipo === 'camara' ? 'selected' : ''}>Cámara del equipo o del teléfono</option></select></div>
            <div><label>El lector termina cada código con</label><select name="sufijo"><option value="Enter" ${c.sufijo === 'Enter' ? 'selected' : ''}>Enter (lo más común)</option><option value="Tab" ${c.sufijo === 'Tab' ? 'selected' : ''}>Tab</option><option value="ninguno" ${c.sufijo === 'ninguno' ? 'selected' : ''}>Nada (se detecta por velocidad)</option></select></div>
            <div><label>Prefijo que agrega el lector (se quita)</label><input name="prefijo" value="${e(c.prefijo)}" maxlength="5" placeholder="normalmente vacío"></div>
            <div><label>Largo mínimo del código</label><input name="largo_min" type="number" min="1" max="30" value="${c.largo_min}"></div>
            <div><label>Tiempo máximo entre teclas (ms)</label><input name="ms_entre_teclas" type="number" min="15" max="300" value="${c.ms_entre_teclas}"></div>
            <div><label>Velocidad del puerto serial (baudios)</label><select name="baudios">${[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => `<option ${b === c.baudios ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
            <div class="full"><label style="display:flex;gap:8px;align-items:center;margin:0 0 6px"><input type="checkbox" name="captura_global" ${c.captura_global ? 'checked' : ''}> Capturar el escaneo en el punto de venta aunque el cursor no esté en el buscador</label>
              <label style="display:flex;gap:8px;align-items:center;margin:0 0 6px"><input type="checkbox" name="sonido" ${c.sonido ? 'checked' : ''}> Pitido al leer un código (agudo = correcto, grave = error)</label>
              <label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" name="validar_digito" ${c.validar_digito ? 'checked' : ''}> Rechazar lecturas con dígito de control incorrecto (solo EAN/UPC; no uses esto si tienes códigos internos inventados)</label></div>
          </fieldset>${edit ? '<div class="full"><button class="btn pri">Guardar configuración</button></div>' : ''}</form>
          <div>
            <div class="card"><h2>Probar y detectar mi lector</h2>
              <p class="muted">Haz clic en el cuadro y escanea un código. El sistema mide la velocidad y detecta con qué tecla termina para sugerirte la configuración.</p>
              <input id="lt" placeholder="Haz clic aquí y escanea un código de barras" autocomplete="off" style="font-size:16px">
              <div id="lres" style="margin-top:12px"></div></div>
            <div class="card" id="lextra"></div></div></div>`;
        const f = $('#f', root);
        const guardar = async (ev) => { ev.preventDefault(); try {
          const v = { tipo: f.tipo.value, sufijo: f.sufijo.value, prefijo: f.prefijo.value, largo_min: +f.largo_min.value, ms_entre_teclas: +f.ms_entre_teclas.value, baudios: +f.baudios.value, captura_global: f.captura_global.checked, sonido: f.sonido.checked, validar_digito: f.validar_digito.checked };
          await api.put('/api/parametros/lector', v); A.ok('Configuración del lector guardada'); await A.refrescarEstado(); P.lector(); } catch (er) { A.fail(er); } };
        f.onsubmit = guardar;
        // ---- detección ----
        const eventos = []; let timer = null; let ultimo = null;
        const caja = $('#lt', root);
        caja.addEventListener('keydown', (ev) => {
          if (ev.ctrlKey || ev.altKey || ev.metaKey || ['Shift', 'CapsLock', 'Control', 'Alt'].includes(ev.key)) return;
          eventos.push({ k: ev.key, t: performance.now() });
          if (ev.key === 'Enter' || ev.key === 'Tab') ev.preventDefault();
          clearTimeout(timer); timer = setTimeout(analizar, 450);
        });
        function analizar() {
          const evs = eventos.splice(0); caja.value = '';
          const imprimibles = evs.filter((x) => x.k.length === 1);
          if (!imprimibles.length) return;
          const fin = evs.length && ['Enter', 'Tab'].includes(evs[evs.length - 1].k) ? evs[evs.length - 1].k : null;
          const gaps = []; for (let i = 1; i < imprimibles.length; i++) gaps.push(imprimibles[i].t - imprimibles[i - 1].t);
          const medio = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0, maximo = gaps.length ? Math.max(...gaps) : 0;
          const texto = imprimibles.map((x) => x.k).join('');
          const prefijo = /^[^0-9A-Za-z]/.test(texto) ? texto[0] : '';
          const codigo = prefijo ? texto.slice(1) : texto;
          const parecelector = imprimibles.length >= 4 && maximo <= 60;
          ultimo = { sufijo: fin || 'ninguno', prefijo, ms: Math.min(150, Math.max(40, Math.round(maximo * 2.5))), largo: Math.max(3, Math.min(6, codigo.length)) };
          $('#lres', root).innerHTML = `<div class="semaforo ${parecelector ? 'verde' : 'amarillo'}"><span class="luz"></span><span>${parecelector ? 'Se comporta como un lector de código de barras.' : 'Parece escritura manual: llegó demasiado lento para un lector (o es un código muy corto).'}</span></div>
            <table style="margin-top:8px"><tbody><tr><td>Código leído</td><td><b>${e(codigo)}</b></td></tr><tr><td>Largo</td><td>${codigo.length} caracteres</td></tr><tr><td>Tiempo medio entre teclas</td><td>${fm(medio, 0)} ms (máximo ${fm(maximo, 0)} ms)</td></tr>
            <tr><td>Carácter final</td><td>${fin ? `<b>${fin}</b>` : 'ninguno detectado'}</td></tr><tr><td>Prefijo</td><td>${prefijo ? `<b>${e(prefijo)}</b>` : 'ninguno'}</td></tr>
            <tr><td>Dígito de control (EAN/UPC)</td><td>${/^(\d{8}|\d{12,14})$/.test(codigo) ? (L.digitoOk(codigo) ? '<span class="ok">correcto</span>' : '<span class="bad">incorrecto</span>') : 'no aplica'}</td></tr></tbody></table>
            ${parecelector ? `<button class="btn pri" id="aplicar" style="margin-top:10px">Usar esta configuración</button><div class="muted" style="font-size:12px;margin-top:6px">Termina con ${ultimo.sufijo}${ultimo.prefijo ? ', prefijo ' + e(ultimo.prefijo) : ''}, tolerancia ${ultimo.ms} ms, largo mínimo ${ultimo.largo}. Luego pulsa “Guardar configuración”.</div>` : ''}`;
          L.pitar(parecelector);
          const ap = $('#aplicar', root); if (ap) ap.onclick = () => { f.sufijo.value = ultimo.sufijo; f.prefijo.value = ultimo.prefijo; f.ms_entre_teclas.value = ultimo.ms; f.largo_min.value = ultimo.largo; f.tipo.value = 'teclado'; A.toast('Aplicado al formulario: falta guardar', ''); f.scrollIntoView({ behavior: 'smooth' }); };
        }
        // ---- serial y cámara ----
        const extra = $('#lextra', root);
        const pintarExtra = () => {
          extra.innerHTML = `<h2>Otros equipos</h2>
            <div class="row" style="margin-bottom:10px"><div class="grow"><b>Lector serial / COM</b><div class="muted" style="font-size:12px">Estado: ${e(L.estadoSerial)}${'serial' in navigator ? '' : ' · este navegador no lo permite (usa Chrome o Edge)'}. Funciona sin probar con equipo real: si lo usas, avísame cómo se comporta.</div></div><button class="btn" id="bser" ${'serial' in navigator ? '' : 'disabled'}>Conectar</button></div>
            <div class="row"><div class="grow"><b>Cámara</b><div class="muted" style="font-size:12px">${'BarcodeDetector' in window ? 'Disponible en este navegador.' : 'Este navegador no puede leer códigos con la cámara.'} En un celular solo funciona con conexión segura (https).</div></div><button class="btn" id="bcam" ${'BarcodeDetector' in window ? '' : 'disabled'}>Probar cámara</button></div>`;
          const bs = $('#bser', extra); if (bs) bs.onclick = async () => { try { await L.conectarSerial(); A.ok('Lector serial conectado'); pintarExtra(); } catch (er) { A.fail(er); } };
          const bc = $('#bcam', extra); if (bc) bc.onclick = () => L.escanearCamara((cod) => { L.pitar(true); A.modal('Código leído', `<div class="c"><div style="font-size:30px;font-weight:800">${e(cod)}</div><p class="muted">La cámara funciona.</p></div>`); }).catch(A.fail);
        };
        pintarExtra();
      },
      async cuentas() {
        const [cs, cj] = await Promise.all([api.get('/api/cuentas'), api.get('/api/cajas')]);
        out.innerHTML = `<div class="card"><div class="topbar"><h2 style="margin:0">Bancos, cajas de efectivo y cuentas digitales</h2>${edit ? '<button class="btn pri" data-a="nueva">+ Nueva cuenta</button>' : ''}</div>
          ${A.tabla([{ h: 'Nombre', f: (r) => e(r.nombre) }, { h: 'Tipo', f: (r) => e(r.tipo) }, { h: 'Moneda', f: (r) => e(r.moneda) }, { h: 'N° cuenta', f: (r) => e(r.numero || '') }, { h: 'Saldo inicial', n: 1, f: (r) => mon(r.saldo_inicial, r.moneda) }, { h: 'Saldo actual', n: 1, f: (r) => mon(r.saldo, r.moneda) }, { h: 'Estado', f: (r) => A.estadoTag(r.activo ? 'activo' : 'inactivo') }, { h: '', f: (r, i) => edit ? `<button class="btn sm" data-a="ed" data-i="${i}">Editar</button>` : '' }], cs)}</div>
          <div class="card"><div class="topbar"><h2 style="margin:0">Cajas registradoras</h2>${edit ? '<button class="btn" data-a="nuevaCaja">+ Nueva caja</button>' : ''}</div>${A.tabla([{ h: 'Caja', f: (r) => e(r.nombre) }, { h: 'Turno abierto', f: (r) => r.turno ? e(r.turno.usuario) : '—' }], cj)}</div>`;
        const form = (c) => A.form(c ? 'Editar cuenta' : 'Nueva cuenta', [{ n: 'nombre', l: 'Nombre', req: true, full: true }, ...(c ? [] : [{ n: 'tipo', l: 'Tipo', t: 'select', o: [['banco', 'Banco'], ['caja', 'Caja de efectivo'], ['digital', 'Cuenta digital']] }, { n: 'moneda', l: 'Moneda', t: 'select', o: [['VES', 'Bs'], ['USD', 'USD'], ['EUR', 'EUR']] }]), { n: 'numero', l: 'N° de cuenta' },
          { n: 'saldo_inicial', l: 'Saldo inicial', t: 'number', ayuda: c ? 'Solo editable si no hay movimientos.' : 'Queda auditado.' }, ...(c ? [{ n: 'activo', l: 'Activa', t: 'checkbox' }] : [])], c || { tipo: 'banco', moneda: 'VES', saldo_inicial: 0 },
          async (v) => { if (c) await api.put('/api/cuentas/' + c.id, v); else await api.post('/api/cuentas', v); A.ok('Guardado'); P.cuentas(); });
        A.acciones(out, { nueva: () => form(null), ed: (el) => form(cs[+el.dataset.i]), nuevaCaja: () => A.form('Nueva caja', [{ n: 'nombre', l: 'Nombre', req: true }], {}, async (v) => { await api.post('/api/cajas', v); P.cuentas(); }) });
      },
      async medios() {
        const [ms, cs] = await Promise.all([api.get('/api/medios-app'), api.get('/api/cuentas')]);
        const ALRECIBIR = [{ nombre: 'Efectivo en dólares ($)', medio: 'efectivo', moneda: 'USD' }, { nombre: 'Efectivo en bolívares (Bs)', medio: 'efectivo', moneda: 'VES' }, { nombre: 'Efectivo en euros (€)', medio: 'efectivo', moneda: 'EUR' }, { nombre: 'Punto de venta inalámbrico (tarjeta)', medio: 'punto', moneda: 'VES' }];
        const existente = (o) => ms.find((m) => m.medio === o.medio && m.moneda === o.moneda);
        const cuentaPara = (o) => cs.find((c) => c.activo && c.moneda === o.moneda && (o.medio === 'efectivo' ? c.tipo === 'caja' : c.tipo !== 'caja'));
        out.innerHTML = `<div class="card"><div class="topbar"><div><h2 style="margin:0">Recepción de pagos electrónicos para la app</h2><p class="muted" style="margin:4px 0 0">Solo se muestran al cliente los medios en estado <b>publicado</b>. Cada uno apunta a la cuenta interna donde se validará el dinero.</p></div>${edit ? '<button class="btn pri" data-a="nuevo">+ Nuevo medio</button>' : ''}</div>
          ${A.tabla([{ h: 'Medio', f: (r) => e(A.MEDIOS[r.medio]) }, { h: 'Banco receptor', f: (r) => e(r.banco) }, { h: 'Datos', f: (r) => ['efectivo', 'punto'].includes(r.medio) ? `Se paga al recibir (${e(r.moneda)})${r.observacion ? ' · ' + e(r.observacion) : ''}` : r.medio === 'pago_movil' ? `${e(r.tipo_doc)}-${e(r.documento)} · ${e(r.telefono)}` : `${e(r.num_cuenta)} · ${e(r.titular)} (${e(r.documento)})` }, { h: 'Cuenta interna', f: (r) => e(r.cuenta) }, { h: 'Estado', f: (r) => A.estadoTag(r.estado === 'publicado' ? 'activo' : r.estado) + (r.estado === 'publicado' ? '' : '') }, { h: '', f: (r, i) => edit ? `<button class="btn sm" data-a="ed" data-i="${i}">Editar</button>` : '' }], ms, { vacio: 'No hay medios configurados: los clientes no podrán reportar pagos.' })}</div>
          <div class="card" style="margin-top:14px"><h2 style="margin:0">Pagos al recibir (efectivo y punto de venta)</h2>
            <p class="muted" style="margin:4px 0 10px">Tilda los que quieres ofrecer al cliente en la app. Se pagan cuando recibe su pedido, sin referencia ni comprobante. Al destildar uno deja de mostrarse.</p>
            <div id="alrecibir">${ALRECIBIR.map((o, i) => { const m = existente(o); return `<label class="row" style="gap:10px;padding:8px 0;border-top:1px solid var(--line,#e5e7eb);align-items:center;cursor:${edit ? 'pointer' : 'default'}"><input type="checkbox" data-pub="${i}" ${m && m.estado === 'publicado' ? 'checked' : ''} ${edit ? '' : 'disabled'} style="width:22px;height:22px"><span><b>${e(o.nombre)}</b><br><span class="muted" style="font-size:12px">${m ? 'Cuenta: ' + e(m.cuenta) : 'Cuenta: ' + e((cuentaPara(o) || {}).nombre || 'falta crear una cuenta en Bancos y cajas')}</span></span></label>`; }).join('')}</div></div>`;
        const form = (m) => A.form(m ? 'Editar medio de pago' : 'Nuevo medio de pago', [
          { n: 'medio', l: 'Medio', t: 'select', o: [['pago_movil', 'Pago móvil'], ['transferencia', 'Transferencia'], ['efectivo', 'Efectivo (se paga al recibir)'], ['punto', 'Punto de venta inalámbrico (se paga al recibir)']] }, { n: 'banco', l: 'Banco receptor (efectivo y punto: nombre que ve el cliente, opcional)' }, { n: 'cuenta_id', l: 'Cuenta interna destino: banco, o caja de efectivo si es efectivo', t: 'select', o: cs.filter((c) => c.activo).map((c) => [c.id, `${c.nombre} (${c.moneda}${c.tipo === 'caja' ? ', caja' : ''})`]) },
          { n: 'moneda', l: 'Moneda aceptada', t: 'select', o: [['VES', 'Bs'], ['USD', 'USD'], ['EUR', 'EUR']] }, { n: 'tipo_doc', l: 'Pago móvil: tipo de documento', t: 'select', o: [['V', 'V'], ['J', 'J'], ['G', 'G'], ['E', 'E']] }, { n: 'documento', l: 'Documento (cédula/RIF)' },
          { n: 'telefono', l: 'Pago móvil: teléfono' }, { n: 'titular', l: 'Transferencia: titular' }, { n: 'num_cuenta', l: 'Transferencia: N° de cuenta' }, { n: 'tipo_cuenta', l: 'Tipo de cuenta', t: 'select', o: [['corriente', 'Corriente'], ['ahorro', 'Ahorro']] },
          { n: 'observacion', l: 'Observación visible al cliente', full: true }, { n: 'estado', l: 'Estado', t: 'select', o: [['publicado', 'Publicado'], ['oculto', 'Oculto'], ['inactivo', 'Inactivo']] }], m || { medio: 'pago_movil', moneda: 'VES', tipo_doc: 'V', tipo_cuenta: 'corriente', estado: 'publicado' },
          async (v) => { const b = { ...v, cuenta_id: +v.cuenta_id }; if (m) await api.put('/api/medios-app/' + m.id, b); else await api.post('/api/medios-app', b); A.ok('Guardado'); P.medios(); }, { ancho: true });
        A.acciones(out, { nuevo: () => form(null), ed: (el) => form(ms[+el.dataset.i]) });
        out.querySelectorAll('[data-pub]').forEach((ch) => ch.onchange = async () => {
          const o = ALRECIBIR[+ch.dataset.pub], m = existente(o);
          try {
            if (m) await api.put('/api/medios-app/' + m.id, { ...m, estado: ch.checked ? 'publicado' : 'oculto' });
            else {
              const c = cuentaPara(o);
              if (!c) { ch.checked = false; return A.toast('Primero crea ' + (o.medio === 'efectivo' ? 'una caja de efectivo' : 'una cuenta de banco') + ' en ' + o.moneda + ' en Bancos y cajas', 'bad'); }
              await api.post('/api/medios-app', { medio: o.medio, moneda: o.moneda, cuenta_id: c.id, estado: 'publicado' });
            }
            A.ok(ch.checked ? 'Publicado en la app' : 'Ya no se muestra en la app'); P.medios();
          } catch (er) { ch.checked = !ch.checked; A.fail(er); }
        });
      },
      async roles() {
        const rr = await api.get('/api/roles');
        const grupos = rr.catalogo;
        const celda = (r, p) => { const marcado = r.permisos.includes(p); const bloqueado = r.codigo === 'admin'; return `<td class="c"><input type="checkbox" data-r="${e(r.codigo)}" data-p="${e(p)}" ${marcado ? 'checked' : ''} ${bloqueado ? 'disabled' : ''} style="width:18px;height:18px"></td>`; };
        out.innerHTML = `<div class="card"><div class="topbar"><div><h2 style="margin:0">Roles y permisos</h2><p class="muted" style="margin:4px 0 0">Marca a qué módulos entra cada rol y qué acciones puede hacer. Los cambios se guardan al marcar y aplican la próxima vez que esa persona abra el sistema. El administrador siempre tiene todo.</p></div><button class="btn pri" data-a="nuevo">+ Nuevo rol</button></div>
          <div style="overflow:auto;margin-top:12px"><table class="tabla"><thead><tr><th style="min-width:260px">Permiso</th>${rr.roles.map((r) => `<th class="c" style="min-width:96px">${e(r.nombre)}<div class="muted" style="font-weight:400;font-size:11px">${r.usuarios} usuario(s)</div>${r.sistema ? '' : `<button class="btn sm" data-a="del" data-r="${e(r.codigo)}" title="Eliminar rol">✕</button>`}</th>`).join('')}</tr></thead><tbody>
          ${grupos.map((g) => `<tr><td colspan="${rr.roles.length + 1}" style="background:var(--bg2,#f1f3f5);font-weight:700">${e(g.grupo)}</td></tr>${g.items.map(([p, l]) => `<tr><td>${e(l)}</td>${rr.roles.map((r) => celda(r, p)).join('')}</tr>`).join('')}`).join('')}</tbody></table></div></div>`;
        out.querySelectorAll('input[data-r]').forEach((ch) => ch.onchange = async () => {
          const cod = ch.dataset.r;
          const permisos = [...out.querySelectorAll(`input[data-r="${cod}"]:checked`)].map((x) => x.dataset.p);
          try { await api.put('/api/roles/' + cod, { permisos }); A.ok('Guardado'); } catch (er) { ch.checked = !ch.checked; A.fail(er); }
        });
        A.acciones(out, {
          nuevo: () => A.form('Nuevo rol', [{ n: 'nombre', l: 'Nombre del rol', req: true }, { n: 'copiar_de', l: 'Empezar con los permisos de', t: 'select', o: [['', 'Ninguno (en blanco)'], ...rr.roles.filter((r) => r.codigo !== 'admin').map((r) => [r.codigo, r.nombre])] }], {}, async (v) => { await api.post('/api/roles', v); A.ok('Rol creado'); P.roles(); }),
          del: async (el) => { if (await A.confirmar('Eliminar rol', '¿Eliminar este rol? Solo se puede si ningún usuario lo usa.', { ok: 'Eliminar', peligro: true })) { try { await api.del('/api/roles/' + el.dataset.r); A.ok('Rol eliminado'); P.roles(); } catch (er) { A.fail(er); } } }
        });
      },
      async usuarios() {
        const [us, rr] = await Promise.all([api.get('/api/usuarios'), api.get('/api/roles')]);
        const nombreRol = (c) => (rr.roles.find((x) => x.codigo === c) || { nombre: c }).nombre;
        out.innerHTML = `<div class="card"><div class="topbar"><h2 style="margin:0">Usuarios y roles</h2><button class="btn pri" data-a="nuevo">+ Nuevo usuario</button></div>${A.tabla([{ h: 'Nombre', f: (r) => e(r.nombre) }, { h: 'Usuario', f: (r) => e(r.usuario) }, { h: 'Rol', f: (r) => e(nombreRol(r.rol)) }, { h: 'Teléfono', f: (r) => e(r.telefono || '') }, { h: 'Estado', f: (r) => A.estadoTag(r.activo ? 'activo' : 'suspendido') }, { h: '', f: (r, i) => `<button class="btn sm" data-a="ed" data-i="${i}">Editar</button>` }], us)}
          <p class="muted" style="margin-top:10px">Qué módulos y acciones tiene cada rol se define en <a href="#/parametros/roles">Roles y permisos</a>. Un usuario de rol <b>Repartidor</b> solo entra a la app de reparto (<code>/reparto/</code>).</p></div>`;
        const roles = rr.roles.map((r) => [r.codigo, r.nombre]);
        A.acciones(out, { nuevo: () => A.form('Nuevo usuario', [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'usuario', l: 'Usuario', req: true }, { n: 'rol', l: 'Rol', t: 'select', o: roles }, { n: 'telefono', l: 'Teléfono (de un repartidor: lo ve el cliente)' }, { n: 'clave', l: 'Clave (mín. 6)', t: 'password', req: true }], { rol: 'cajero' }, async (v) => { await api.post('/api/usuarios', v); A.ok('Usuario creado'); P.usuarios(); }),
          ed: (el) => { const u = us[+el.dataset.i]; return A.form('Editar usuario', [{ n: 'nombre', l: 'Nombre', req: true }, { n: 'rol', l: 'Rol', t: 'select', o: roles }, { n: 'telefono', l: 'Teléfono' }, { n: 'activo', l: 'Activo', t: 'checkbox' }, { n: 'clave', l: 'Nueva clave (vacío = no cambiar)', t: 'password' }], u, async (v) => { if (!v.clave) delete v.clave; await api.put('/api/usuarios/' + u.id, v); A.ok('Guardado'); P.usuarios(); }); } });
      }
    };
    (P[tab] || P.negocio)().catch(A.fail);
  };
})();
