'use strict';
// App de clientes (PWA): catálogo con stock real, carrito, pedido con reserva, reporte de pago y semáforo.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fm = (n, d = 2) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  // Código del abasto: /tienda/<codigo>/ o ?e=<codigo>. Con un solo abasto instalado no hace falta.
  const slug = (() => { const m = location.pathname.match(/^\/tienda\/([^/.]+)\/?/); return ((m && m[1]) || new URLSearchParams(location.search).get('e') || '').toLowerCase(); })();
  const K = (k) => 'tienda_' + (slug || 'x') + '_' + k;
  { const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/tienda/manifest.webmanifest' + (slug ? '?e=' + encodeURIComponent(slug) : ''); document.head.appendChild(l); }
  let token = ls.get(K('token')), cliente = JSON.parse(ls.get(K('cliente')) || 'null');
  let cfg = null, catalogo = { categorias: [], productos: [] }, medios = [];
  let carrito = JSON.parse(ls.get(K('carrito')) || '[]');
  let timer = null, cdTimer = null;

  async function api(m, u, b) {
    let r;
    try { r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json', ...(slug ? { 'X-Empresa': slug } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); }
    catch { throw new Error('Sin conexión'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token && !u.includes('/login') && !u.includes('/registro')) { salir(false); throw new Error('Tu sesión venció. Inicia sesión de nuevo.'); }
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  function toast(msg, t = '') { const d = document.createElement('div'); d.className = 'toast ' + t; d.textContent = msg; $('#toasts').appendChild(d); setTimeout(() => d.remove(), t === 'bad' ? 5000 : 2800); }
  const falla = (er) => toast(er.message, 'bad');
  const guardarCarro = () => ls.set(K('carrito'), JSON.stringify(carrito));
  const usdFmt = (n) => '$ ' + fm(n);
  const vesFmt = (n) => (cfg && cfg.tasa_usd_ves ? 'Bs ' + fm(n * cfg.tasa_usd_ves) : '');
  const totalCarro = () => carrito.reduce((a, i) => a + i.cantidad * i.precio_usd, 0);
  const salir = (render = true) => { token = null; cliente = null; ls.del(K('token')); ls.del(K('cliente')); clearInterval(timer); if (render) ir(); };

  // ---------- estructura ----------
  function marco(titulo, cuerpo, { atras } = {}) {
    $('#t').innerHTML = `<div class="t-head">${atras ? `<button class="btn sm" data-atras>←</button>` : ''}${!titulo && cfg && cfg.empresa.logo ? `<img src="${cfg.empresa.logo}" alt="" style="height:30px;border-radius:6px;background:#fff">` : ''}<b>${e(titulo || (cfg ? cfg.empresa.nombre : 'Abasto'))}</b>${cliente ? `<button class="btn sm" data-p>Mis pedidos</button><button class="btn sm" data-s>Salir</button>` : ''}</div><div class="t-wrap">${cuerpo}</div>`;
    const a = $('[data-atras]'); if (a) a.onclick = () => atras();
    const p = $('[data-p]'); if (p) p.onclick = () => (location.hash = '#/pedidos');
    const s = $('[data-s]'); if (s) s.onclick = () => salir();
  }
  const ruta = () => { const h = location.hash.replace(/^#\/?/, ''); const [v, a] = h.split('/'); return { v: v || 'catalogo', a }; };
  async function ir() {
    clearInterval(timer); clearInterval(cdTimer);
    if (!cfg) {
      try { cfg = await api('GET', '/api/app/config'); }
      catch (er) { return /código de la empresa|No existe una empresa/.test(er.message) ? vistaCodigo(er.message) : marco('Abasto', `<div class="card bad">${e(er.message)}</div>`); }
    }
    if (cfg.cerrado) return marco('', `<div class="card c"><h1>Cerrado por ahora</h1><p class="muted">${e(cfg.empresa.nombre)} no está recibiendo pedidos por la app en este momento.${cfg.empresa.telefono ? ' Escríbele al ' + e(cfg.empresa.telefono) + '.' : ''}</p></div>`);
    const { v, a } = ruta();
    if (!token && v !== 'acceso') { location.hash = '#/acceso'; return; }
    try {
      if (v === 'acceso') return vistaAcceso();
      if (v === 'carrito') return vistaCarrito();
      if (v === 'pedidos') return await vistaPedidos();
      if (v === 'pedido') return await vistaPedido(a);
      return await vistaCatalogo();
    } catch (er) { falla(er); }
  }

  // ---------- código del abasto ----------
  function vistaCodigo(aviso) {
    marco('Pedidos al abasto', `<div class="card"><h1>¿A qué abasto vas a pedir?</h1><p class="muted">Escribe el código que te dio tu abasto${aviso ? '' : ' (aparece en su enlace o en su cartel)'}.</p>
      <form id="cf" class="form"><div class="full"><label>Código del abasto</label><input name="c" autocapitalize="none" placeholder="ej. abasto-sur" required></div>${aviso ? `<div class="full bad">${e(aviso)}</div>` : ''}
      <div class="full"><button class="btn pri lg" style="width:100%">Continuar</button></div></form></div>`);
    $('#cf').onsubmit = (ev) => { ev.preventDefault(); const c = ev.target.c.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, ''); if (c) location.href = '/tienda/' + c + '/'; };
  }

  // ---------- acceso ----------
  function vistaAcceso(modo = 'login') {
    marco('', `<div class="card"><h1>${modo === 'login' ? 'Entrar' : 'Crear cuenta'}</h1><p class="muted">Pide a tu abasto de confianza, ${modo === 'login' ? 'con tu teléfono y PIN.' : 'solo necesitas tu nombre, teléfono y un PIN de 4 a 8 dígitos.'}</p>
      <form id="af" class="form">${modo === 'registro' ? '<div class="full"><label>Nombre completo</label><input name="nombre" required autocomplete="name"></div>' : ''}
      <div class="full"><label>Teléfono</label><input name="telefono" inputmode="tel" required autocomplete="tel" placeholder="0414 1234567"></div>
      <div class="full"><label>PIN (4 a 8 dígitos)</label><input name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" required autocomplete="${modo === 'login' ? 'current-password' : 'new-password'}"></div>
      <div class="full"><button class="btn pri lg" style="width:100%">${modo === 'login' ? 'Entrar' : 'Crear mi cuenta'}</button></div></form>
      <p class="c" style="margin-top:14px"><a href="#" id="alt">${modo === 'login' ? '¿Primera vez? Crear cuenta' : 'Ya tengo cuenta'}</a></p></div>`);
    $('#alt').onclick = (ev) => { ev.preventDefault(); vistaAcceso(modo === 'login' ? 'registro' : 'login'); };
    $('#af').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try {
        const r = await api('POST', modo === 'login' ? '/api/app/login' : '/api/app/registro', { nombre: f.nombre && f.nombre.value, telefono: f.telefono.value, pin: f.pin.value });
        token = r.token; cliente = r.cliente; ls.set(K('token'), token); ls.set(K('cliente'), JSON.stringify(cliente)); location.hash = '#/catalogo'; ir();
      } catch (er) { falla(er); }
    };
  }

  // ---------- catálogo ----------
  let filtro = { q: '', cat: '' };
  async function vistaCatalogo() {
    marco('', `<div class="row"><div class="grow"><input id="q" type="search" placeholder="Buscar productos…" value="${e(filtro.q)}"></div>${'BarcodeDetector' in window ? '<button class="btn" id="scan" title="Escanear código de barras">📷</button>' : ''}</div>
      ${cfg.abierto ? '' : '<div class="semaforo amarillo" style="margin-top:10px"><span class="luz"></span>El abasto aún no abrió hoy: puedes pedir, pero la validación puede tardar.</div>'}
      <div class="cats" id="cats"></div><div class="prods" id="lista"></div>
      ${carrito.length ? `<div class="barra-carro"><a class="btn pri lg" href="#/carrito">Ver carrito · ${carrito.reduce((a, i) => a + i.cantidad, 0)} ítems · ${usdFmt(totalCarro())}</a></div>` : ''}`);
    async function cargar() {
      catalogo = await api('GET', '/api/app/catalogo' + (filtro.q || filtro.cat ? '?' + new URLSearchParams({ ...(filtro.q ? { q: filtro.q } : {}), ...(filtro.cat ? { categoria_id: filtro.cat } : {}) }) : ''));
      $('#cats').innerHTML = `<button class="btn sm ${!filtro.cat ? 'pri' : ''}" data-c="">Todo</button>` + catalogo.categorias.map((c) => `<button class="btn sm ${String(filtro.cat) === String(c.id) ? 'pri' : ''}" data-c="${c.id}">${e(c.nombre)}</button>`).join('');
      $('#cats').querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { filtro.cat = b.dataset.c; cargar().catch(falla); });
      $('#lista').innerHTML = catalogo.productos.map((p) => {
        const en = carrito.find((i) => i.id === p.id);
        return `<div class="prod"><div class="n">${e(p.nombre)}</div><div class="muted" style="font-size:12px">${e([p.marca, p.presentacion].filter(Boolean).join(' · '))}</div><div class="p">${usdFmt(p.precio_usd)}</div><div class="muted" style="font-size:12px">${vesFmt(p.precio_usd)}</div>
          <div class="muted" style="font-size:11px">${p.disponible <= 5 ? `<span class="warn">Quedan ${fm(p.disponible, 0)}</span>` : 'Disponible'}</div>
          ${en ? `<div class="qty" style="margin-top:6px"><button class="btn sm" data-m="${p.id}">−</button><b style="min-width:26px;text-align:center">${en.cantidad}</b><button class="btn sm" data-a="${p.id}">+</button></div>` : `<button class="btn pri sm" style="margin-top:6px" data-a="${p.id}">Agregar</button>`}</div>`;
      }).join('') || '<div class="empty" style="grid-column:1/-1">No encontramos productos disponibles.</div>';
      $('#lista').querySelectorAll('[data-a]').forEach((b) => b.onclick = () => cambiar(+b.dataset.a, 1));
      $('#lista').querySelectorAll('[data-m]').forEach((b) => b.onclick = () => cambiar(+b.dataset.m, -1));
    }
    function cambiar(id, d) {
      const p = catalogo.productos.find((x) => x.id === id); let it = carrito.find((i) => i.id === id);
      if (!it && d > 0) carrito.push(it = { id, nombre: p.nombre, precio_usd: p.precio_usd, cantidad: 0 });
      if (d > 0 && it.cantidad + 1 > p.disponible) return toast('No hay más unidades disponibles', 'bad');
      it.cantidad += d; if (it.cantidad <= 0) carrito = carrito.filter((i) => i.id !== id);
      guardarCarro(); vistaCatalogo();
    }
    let t; $('#q').oninput = (ev) => { clearTimeout(t); t = setTimeout(() => { filtro.q = ev.target.value; cargar().catch(falla); }, 250); };
    const sc = $('#scan'); if (sc) sc.onclick = escanear;
    await cargar();
  }
  async function escanear() {
    const v = document.createElement('div'); v.className = 'velo';
    v.innerHTML = '<div class="modal"><header><span>Apunta al código de barras</span><button class="btn sm" data-x>✕</button></header><div class="cuerpo"><video playsinline muted style="width:100%;border-radius:8px"></video></div></div>';
    document.body.appendChild(v);
    let stream, vivo = true;
    const cerrar = () => { vivo = false; if (stream) stream.getTracks().forEach((t) => t.stop()); v.remove(); };
    v.querySelector('[data-x]').onclick = cerrar;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const vid = v.querySelector('video'); vid.srcObject = stream; await vid.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      while (vivo) {
        const r = await det.detect(vid).catch(() => []);
        if (r.length) { filtro.q = r[0].rawValue; cerrar(); return vistaCatalogo(); }
        await new Promise((ok) => setTimeout(ok, 300));
      }
    } catch { cerrar(); toast('No se pudo usar la cámara', 'bad'); }
  }

  // ---------- carrito ----------
  function vistaCarrito() {
    if (!carrito.length) return marco('Mi carrito', '<div class="card empty">Tu carrito está vacío.<br><br><a class="btn pri" href="#/catalogo">Ir al catálogo</a></div>', { atras: () => (location.hash = '#/catalogo') });
    marco('Mi carrito', `<div class="card">${carrito.map((i) => `<div class="row" style="justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:8px 0"><div style="flex:1"><b>${e(i.nombre)}</b><div class="muted">${usdFmt(i.precio_usd)} · ${vesFmt(i.precio_usd)}</div></div>
        <div class="qty"><button class="btn sm" data-m="${i.id}">−</button><b style="min-width:26px;text-align:center">${i.cantidad}</b><button class="btn sm" data-a="${i.id}">+</button></div><b style="min-width:70px;text-align:right">${usdFmt(i.cantidad * i.precio_usd)}</b></div>`).join('')}
      <div class="r" style="margin-top:12px"><div class="muted">Total</div><div style="font-size:28px;font-weight:800">${usdFmt(totalCarro())}</div><div class="muted">${vesFmt(totalCarro())}</div></div></div>
      <div class="card"><h2>¿Cómo lo recibes?</h2><div class="row"><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="radio" name="ent" value="retiro" checked> Retiro en tienda</label><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="radio" name="ent" value="envio"> Envío a domicilio</label></div>
      <div id="env" class="form" style="margin-top:12px" hidden><div><label>Nombre de quien recibe</label><input id="c1" value="${e(cliente.nombre)}"></div><div><label>Teléfono</label><input id="c2" inputmode="tel" value="${e(cliente.telefono || '')}"></div><div><label>Zona</label><input id="c3"></div><div><label>Dirección</label><input id="c4"></div><div class="full"><label>Punto de referencia</label><input id="c5"></div></div>
      <div style="margin-top:12px"><label>Nota para el abasto (opcional)</label><input id="nota"></div></div>
      <p class="muted">Al confirmar reservamos tu mercancía por ${cfg.reserva_minutos} minutos. Luego te mostramos cómo pagar.</p>
      <button class="btn pri lg" style="width:100%" id="conf">Confirmar pedido</button>`, { atras: () => (location.hash = '#/catalogo') });
    document.querySelectorAll('[name=ent]').forEach((r) => r.onchange = () => { $('#env').hidden = document.querySelector('[name=ent]:checked').value !== 'envio'; });
    document.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => { carrito.find((i) => i.id === +b.dataset.a).cantidad++; guardarCarro(); vistaCarrito(); });
    document.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { const i = carrito.find((x) => x.id === +b.dataset.m); i.cantidad--; if (i.cantidad <= 0) carrito = carrito.filter((x) => x !== i); guardarCarro(); vistaCarrito(); });
    $('#conf').onclick = async () => {
      $('#conf').disabled = true;
      try {
        const r = await api('POST', '/api/app/pedidos', { items: carrito.map((i) => ({ producto_id: i.id, cantidad: i.cantidad })), entrega: document.querySelector('[name=ent]:checked').value,
          contacto: $('#c1').value, telefono: $('#c2').value, zona: $('#c3').value, direccion: $('#c4').value, referencia_entrega: $('#c5').value, nota: $('#nota').value });
        carrito = []; guardarCarro(); location.hash = '#/pedido/' + r.id;
      } catch (er) { falla(er); $('#conf').disabled = false; }
    };
  }

  // ---------- pedidos ----------
  const luz = (s) => `<div class="semaforo ${s.color}"><span class="luz"></span><span>${e(s.mensaje)}</span></div>`;
  async function vistaPedidos() {
    const rows = await api('GET', '/api/app/pedidos');
    marco('Mis pedidos', rows.length ? rows.map((p) => `<a href="#/pedido/${p.id}" style="text-decoration:none;color:inherit"><div class="card"><div class="row" style="justify-content:space-between"><b>${e(p.numero)}</b><b>${usdFmt(p.total_usd)}</b></div><div class="muted" style="margin:4px 0 8px">${e(p.creado.slice(0, 16))}</div>${luz(p.semaforo)}${p.estado === 'entregado' ? (p.calificacion ? `<div style="margin-top:8px">${estrellasFijas(p.calificacion)}</div>` : '<div style="margin-top:8px"><span class="tag warn">Califica el servicio</span></div>') : ''}</div></a>`).join('') : '<div class="card empty">Aún no has hecho pedidos.</div>', { atras: () => (location.hash = '#/catalogo') });
  }
  // Cada pedido se actualiza solo mientras está en pantalla. Al mostrar otro, o al volver a dibujar, se apagan los temporizadores del anterior.
  const enPantalla = (id) => ruta().v === 'pedido' && String(ruta().a) === String(id);
  async function vistaPedido(id) {
    clearInterval(timer); clearInterval(cdTimer);
    const p = await api('GET', '/api/app/pedidos/' + id);
    if (!medios.length) medios = await api('GET', '/api/app/medios-pago');
    if (!enPantalla(id)) return; // mientras se pedían los datos, la persona pasó a otro pedido
    const puedePagar = ['pendiente', 'pago_reportado'].includes(p.estado);
    const pendiente = p.pagos.find((x) => x.estado === 'pendiente');
    marco('Pedido ' + p.numero, `${luz(p.semaforo)}
      <ul class="pasos">${p.semaforo.pasos.map((n, i) => `<li class="${i < p.semaforo.paso ? 'hecho' : i === p.semaforo.paso ? 'actual' : ''}">${e(n)}</li>`).join('')}</ul>
      ${p.orden && p.orden.repartidor && ['lista_envio', 'retirada', 'enviada', 'entregada'].includes(p.orden.estado) ? `<div class="card" style="margin-top:12px"><b>${p.orden.estado === 'enviada' ? '🛵 Tu pedido va en camino' : p.orden.estado === 'retirada' ? '🛵 El repartidor ya retiró tu pedido' : p.orden.estado === 'entregada' ? '✔ Entregado' : '🛵 Ya tiene repartidor'}</b><div>Repartidor: ${e(p.orden.repartidor)}${p.orden.estado !== 'entregada' && p.orden.repartidor_tel ? ` · <a href="tel:${e(p.orden.repartidor_tel)}">Llamar</a>` : ''}</div>${p.orden.salida_en ? `<div class="muted">Salió a las ${e(p.orden.salida_en.slice(11, 16))}</div>` : ''}${p.orden.entregado_en ? `<div class="muted">Entregado a las ${e(p.orden.entregado_en.slice(11, 16))}${p.orden.receptor ? ' · recibió ' + e(p.orden.receptor) : ''}</div>` : ''}</div>` : ''}
      ${p.expira && ['pendiente', 'pago_reportado'].includes(p.estado) ? `<p class="warn" id="cd"></p>` : ''}
      <div class="card" style="margin-top:12px"><h2>Tu pedido</h2>${p.items.map((i) => `<div class="row" style="justify-content:space-between"><span>${fm(i.cantidad, 0)} × ${e(i.nombre)}</span><span>${usdFmt(i.cantidad * i.precio_usd)}</span></div>`).join('')}
        <div class="r" style="margin-top:8px"><b style="font-size:22px">${usdFmt(p.total_usd)}</b><div class="muted">${vesFmt(p.total_usd)}</div></div>
        <p class="muted">${p.entrega === 'envio' ? `Envío a ${e(p.contacto)} — ${e(p.zona)}, ${e(p.direccion)}` : 'Retiro en tienda'}</p></div>
      ${puedePagar && !pendiente ? seccionPago(p) : ''}
      ${pendiente ? (['efectivo', 'punto'].includes(pendiente.medio) ? '<div class="card"><b>Pagarás al recibir tu pedido.</b> Lo estamos confirmando; esta pantalla se actualiza sola.</div>' : '<div class="card"><b>Pago enviado.</b> Estamos validándolo; esta pantalla se actualiza sola.</div>') : ''}
      ${p.estado === 'entregado' ? seccionCalificar(p) : ''}
      ${p.estado === 'pendiente' ? '<button class="btn bad" id="canc">Cancelar pedido</button>' : ''}`, { atras: () => (location.hash = '#/pedidos') });
    if (p.expira) {
      const fin = new Date(p.expira.replace(' ', 'T')).getTime();
      const tick = () => { const el = $('#cd'); if (!el) return; const s = Math.max(0, Math.round((fin - Date.now()) / 1000)); el.textContent = s ? `⏱ Tu mercancía está reservada ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min` : 'La reserva venció.'; };
      tick(); clearInterval(cdTimer); cdTimer = setInterval(tick, 1000);
    }
    if (p.estado === 'entregado' && !p.calificacion) conectarCalificar(p);
    const c = $('#canc'); if (c) c.onclick = async () => { try { await api('POST', `/api/app/pedidos/${id}/cancelar`); toast('Pedido cancelado'); location.hash = '#/pedidos'; } catch (er) { falla(er); } };
    if (puedePagar && !pendiente) conectarPago(p);
    const miTimer = timer = setInterval(async () => { if (!enPantalla(id)) return clearInterval(miTimer); try { const n = await api('GET', '/api/app/pedidos/' + id); if (!enPantalla(id)) return; if (n.estado !== p.estado || n.semaforo.paso !== p.semaforo.paso || (n.pagos.length !== p.pagos.length)) vistaPedido(id); } catch {} }, 12000);
  }
  // ---------- calificación del servicio ----------
  const TXT_ESTRELLAS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'];
  const estrellasFijas = (n) => '<span class="est" aria-label="' + n + ' de 5 estrellas">' + '★'.repeat(n) + '<span class="est-off">' + '★'.repeat(5 - n) + '</span></span>';
  function seccionCalificar(p) {
    if (p.calificacion) return `<div class="card" style="margin-top:12px"><h2>Tu calificación</h2><div class="est-grande">${estrellasFijas(p.calificacion)}</div><b>${TXT_ESTRELLAS[p.calificacion]}</b>${p.calificacion_nota ? `<p class="muted" style="margin:8px 0 0">«${e(p.calificacion_nota)}»</p>` : ''}<p class="muted" style="margin:8px 0 0">¡Gracias por contarnos cómo te fue!</p></div>`;
    return `<div class="card cal" style="margin-top:12px"><h2>¿Cómo fue el servicio?</h2><p class="muted" style="margin-top:-6px">Toca las estrellas para calificar tu pedido.</p>
      <div class="estrellas" role="radiogroup" aria-label="Calificación">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="estrella" data-n="${n}" role="radio" aria-checked="false" aria-label="${n} ${n === 1 ? 'estrella' : 'estrellas'}">★</button>`).join('')}</div>
      <div class="cal-txt" id="cal-txt">&nbsp;</div>
      <label for="cal-nota" style="margin-top:10px">Observación (opcional)</label><textarea id="cal-nota" rows="3" maxlength="500" placeholder="Cuéntanos qué salió bien o qué podemos mejorar"></textarea>
      <button class="btn pri lg" id="cal-env" style="width:100%;margin-top:12px" disabled>Enviar calificación</button></div>`;
  }
  function conectarCalificar(p) {
    let sel = 0;
    const btns = [...document.querySelectorAll('.estrella')];
    const pintar = (n) => { btns.forEach((b) => { b.classList.toggle('on', +b.dataset.n <= n); b.setAttribute('aria-checked', String(+b.dataset.n === sel)); }); $('#cal-txt').textContent = n ? TXT_ESTRELLAS[n] : ' '; };
    btns.forEach((b) => { b.onclick = () => { sel = +b.dataset.n; pintar(sel); $('#cal-env').disabled = false; }; });
    $('#cal-env').onclick = async () => {
      if (!sel) return;
      const bt = $('#cal-env'); bt.disabled = true;
      try { await api('POST', `/api/app/pedidos/${p.id}/calificar`, { estrellas: sel, nota: $('#cal-nota').value }); toast('¡Gracias por tu calificación!'); vistaPedido(p.id); }
      catch (er) { bt.disabled = false; falla(er); }
    };
  }
  const BANCOS = ['Banco de Venezuela', 'Banesco', 'Mercantil', 'Provincial (BBVA)', 'BNC', 'Bancamiga', 'Banco del Tesoro', 'Bicentenario', 'Banco Exterior', 'Banplus', 'Banco Plaza', 'Sofitasa', 'Banco Activo', 'Bancaribe', 'Banco Caroní', '100% Banco', 'Fondo Común', 'Delsur', 'Bancrecer', 'Banco Agrícola'];
  const montoDe = (m, p) => (m.moneda === 'USD' ? p.total_usd : m.moneda === 'VES' ? p.total_usd * cfg.tasa_usd_ves : p.total_usd / cfg.tasa_eur_usd);
  const montoTxt = (m, p) => (m.moneda === 'USD' ? usdFmt(p.total_usd) : m.moneda === 'VES' ? vesFmt(p.total_usd) : fm(montoDe(m, p)) + ' €');
  const alRecibir = (m) => m.medio === 'efectivo' || m.medio === 'punto';
  const nombreMedio = (m) => (m.medio === 'pago_movil' ? 'Pago móvil — ' + m.banco : m.medio === 'transferencia' ? 'Transferencia — ' + m.banco : m.medio === 'efectivo' ? 'Efectivo al recibir (' + (m.moneda === 'USD' ? 'dólares' : m.moneda === 'EUR' ? 'euros' : 'bolívares') + ')' : 'Punto de venta inalámbrico al recibir');
  function seccionPago(p) {
    if (!medios.length) return '<div class="card bad">El abasto aún no configuró sus medios de pago. Escríbele para coordinar.</div>';
    const unico = medios.length === 1;
    return `<div class="card"><h2>¿Cómo vas a pagar?</h2>
      <p class="muted">Elige una forma de pago. Si es transferencia o pago móvil, paga desde tu banco y reporta aquí lo que pagaste. Si es efectivo o punto de venta, pagas cuando recibas tu pedido.</p>
      <div id="lm">${medios.map((m) => `<label class="medio ${unico ? 'sel' : ''}" for="m${m.id}"><div style="display:flex;gap:10px;align-items:flex-start"><input type="radio" name="mid" id="m${m.id}" value="${m.id}" ${unico ? 'checked' : ''} style="width:22px;height:22px;margin-top:2px;flex:none">
        <div style="min-width:0"><b>${e(nombreMedio(m))}</b><div class="muted" style="font-size:13px">${alRecibir(m) ? (m.medio === 'punto' ? 'Pagas con tu tarjeta en el punto de venta del repartidor o de la tienda.' : 'Pagas en efectivo al retirar o cuando llegue el repartidor.') + (m.observacion ? '<br>' + e(m.observacion) : '') : m.medio === 'pago_movil'
          ? `Documento <code>${e(m.tipo_doc)}-${e(m.documento)}</code> · Teléfono <code>${e(m.telefono)}</code>` : `Cuenta <code>${e(m.num_cuenta)}</code> (${e(m.tipo_cuenta || '')})<br>Titular: ${e(m.titular)} · <code>${e(m.documento)}</code>`}${m.observacion ? `<br>${e(m.observacion)}` : ''}</div>
          <div style="margin-top:6px"><b>Monto a pagar: ${montoTxt(m, p)}</b></div></div></div></label>`).join('')}</div>
      <form id="pf" class="form" style="margin-top:10px">
        <div class="full" id="pcon" hidden><label id="pconl">¿Con qué denominación vas a pagar? *</label><input name="paga_con" type="number" step="any" min="0" inputmode="decimal" placeholder="Billete o monto que entregarás">
          <div id="pcon-s" class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap"></div>
          <div class="muted" style="font-size:12px;margin-top:4px">Escribe el billete o el monto que le entregarás al repartidor. Así llevamos el vuelto listo. Si pagas justo, escribe el mismo monto del pedido.</div></div>
        <div class="full sol-elec"><label>¿Desde qué banco pagaste? *</label><select name="banco" required><option value="">Selecciona tu banco…</option>${BANCOS.map((b) => `<option>${e(b)}</option>`).join('')}<option value="__otro">Otro banco…</option></select></div>
        <div class="full sol-elec" id="otrob" hidden><label>Escribe el nombre de tu banco *</label><input name="banco_otro" autocomplete="off"></div>
        <div><label>Monto pagado *</label><input name="monto" type="number" step="any" min="0" required value="${unico ? montoDe(medios[0], p).toFixed(2) : ''}"></div>
        <div class="sol-elec"><label>N° de referencia *</label><input name="ref" inputmode="numeric" required autocomplete="off"></div>
        <div class="full sol-elec"><label>Foto del comprobante (opcional)</label><input name="img" type="file" accept="image/*"></div>
        <div class="full"><button class="btn pri lg" style="width:100%" id="bpago">Enviar reporte de pago</button></div></form></div>`;
  }
  function conectarPago(p) {
    const f = $('#pf'); if (!f) return;
    const lista = $('#lm');
    const ajustar = (m) => {
      const rec = alRecibir(m);
      f.querySelectorAll('.sol-elec').forEach((x) => { x.hidden = rec || (x.id === 'otrob' && f.banco.value !== '__otro'); });
      f.banco.required = !rec; f.ref.required = !rec;
      const pc = $('#pcon'); pc.hidden = m.medio !== 'efectivo'; f.paga_con.required = m.medio === 'efectivo';
      if (m.medio === 'efectivo') {
        const total = Math.round(montoDe(m, p) * 100) / 100, sim = m.moneda === 'USD' ? '$ ' : m.moneda === 'EUR' ? '€ ' : 'Bs ';
        f.paga_con.value = ''; f.paga_con.min = total;
        $('#pconl').textContent = '¿Con qué denominación vas a pagar en ' + (m.moneda === 'USD' ? 'dólares' : m.moneda === 'EUR' ? 'euros' : 'bolívares') + '? *';
        const billetes = m.moneda === 'VES' ? [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000] : [1, 2, 5, 10, 20, 50, 100, 200];
        let opc = billetes.filter((b) => b >= total).slice(0, 4);
        if (!opc.length) opc = [Math.ceil(total / 100) * 100];
        $('#pcon-s').innerHTML = [total, ...opc.filter((b) => b > total)].map((v, i) => `<button type="button" class="btn sm" data-den="${v}">${i === 0 ? 'Justo ' : ''}${sim}${v.toLocaleString('es-VE', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}</button>`).join('');
        $('#pcon-s').querySelectorAll('[data-den]').forEach((b) => b.onclick = () => { f.paga_con.value = b.dataset.den; });
      }
      $('#bpago').textContent = rec ? 'Confirmar: pagaré al recibir' : 'Enviar reporte de pago';
    };
    const ya = lista.querySelector('input[name=mid]:checked'); if (ya) ajustar(medios.find((x) => x.id === +ya.value));
    lista.addEventListener('change', (ev) => {
      if (ev.target.name !== 'mid') return;
      lista.querySelectorAll('.medio').forEach((x) => x.classList.remove('sel', 'alerta'));
      ev.target.closest('.medio').classList.add('sel');
      const m = medios.find((x) => x.id === +ev.target.value);
      f.monto.value = montoDe(m, p).toFixed(2);
      ajustar(m);
    });
    f.banco.onchange = () => { $('#otrob').hidden = f.banco.value !== '__otro'; if (f.banco.value === '__otro') f.banco_otro.focus(); };
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const sel = lista.querySelector('input[name=mid]:checked');
      if (!sel) { lista.querySelectorAll('.medio').forEach((x) => x.classList.add('alerta')); lista.scrollIntoView({ behavior: 'smooth', block: 'center' }); return toast('Primero elige la cuenta a la que pagaste', 'bad'); }
      const mSel = medios.find((x) => x.id === +sel.value);
      const emisor = alRecibir(mSel) ? '' : f.banco.value === '__otro' ? f.banco_otro.value.trim() : f.banco.value;
      if (!alRecibir(mSel) && !emisor) return toast('Indica desde qué banco pagaste', 'bad');
      if (mSel.medio === 'efectivo') {
        const total = Math.round(montoDe(mSel, p) * 100) / 100;
        if (!f.paga_con.value) { f.paga_con.focus(); return toast('Indica con qué denominación vas a pagar para preparar tu vuelto', 'bad'); }
        if (+f.paga_con.value < total - 0.005) { f.paga_con.focus(); return toast('Con ese monto no alcanza para el total del pedido', 'bad'); }
      }
      const btn = f.querySelector('button[type=submit], #bpago'); btn.disabled = true;
      try {
        let comprobante = null;
        if (!alRecibir(mSel) && f.img.files[0]) comprobante = await reducir(f.img.files[0]);
        await api('POST', `/api/app/pedidos/${p.id}/pago`, { medio_app_id: +sel.value, monto: +f.monto.value, banco_emisor: emisor, referencia: f.ref.value, comprobante, paga_con: mSel.medio === 'efectivo' && f.paga_con.value ? +f.paga_con.value : undefined });
        toast(alRecibir(mSel) ? 'Listo. Pagarás al recibir tu pedido.' : 'Pago reportado. Lo estamos validando.', 'ok'); vistaPedido(p.id);
      } catch (er) { falla(er); btn.disabled = false; }
    };
  }
  function reducir(file) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, 1000 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.7)); };
      img.onerror = () => rej(new Error('No se pudo leer la imagen')); img.src = url;
    });
  }

  window.addEventListener('hashchange', ir);
  ir();
})();
