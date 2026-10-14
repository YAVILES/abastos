'use strict';
// App del repartidor: recibe el aviso de pedidos listos para repartir, los toma, marca "en camino" y "entregado".
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = (() => { const m = location.pathname.match(/^\/reparto\/([^/.]+)\/?/); return ((m && m[1]) || new URLSearchParams(location.search).get('e') || '').toLowerCase(); })();
  const K = (k) => 'reparto_' + (slug || 'x') + '_' + k;
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
  { const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/reparto/manifest.webmanifest' + (slug ? '?e=' + encodeURIComponent(slug) : ''); document.head.appendChild(l); }
  let token = ls.get(K('token')), datos = null, pestana = ls.get(K('pestana')) || 'buscar', timer = null, sinConexion = false, titulo0 = document.title, parpadeo = null;
  let sonido = ls.get(K('sonido')) !== '0';
  const vistos = new Set(JSON.parse(ls.get(K('vistos')) || '[]'));
  let primeraCarga = true;

  async function api(m, u, b) {
    let r;
    try { r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b ? JSON.stringify(b) : undefined }); }
    catch { throw Object.assign(new Error('Sin conexión'), { red: true }); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token && !u.includes('/login')) { salir(false); throw new Error('Tu sesión venció. Entra de nuevo.'); }
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  function toast(msg, t = '') { const d = document.createElement('div'); d.className = 'toast ' + t; d.textContent = msg; $('#toasts').appendChild(d); setTimeout(() => d.remove(), t === 'bad' ? 5000 : 3000); }
  const falla = (er) => toast(er.message, 'bad');

  // ---------- avisos: pitido + vibración + notificación + título ----------
  function pitar() {
    if (!sonido) return;
    try {
      const ac = pitar.ac || (pitar.ac = new (window.AudioContext || window.webkitAudioContext)());
      [0, 0.22, 0.44].forEach((d) => { const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.14); });
    } catch { /* sin audio */ }
  }
  function avisar(nuevos) {
    pitar();
    try { navigator.vibrate && navigator.vibrate([300, 120, 300, 120, 300]); } catch {}
    const asignado = nuevos.every((n) => n.repartidor_id);
    const titulo = nuevos.length === 1 ? (asignado ? 'Te asignaron el pedido ' : 'Nuevo pedido para repartir: ') + nuevos[0].pedido : `${nuevos.length} pedidos ${asignado ? 'asignados a ti' : 'nuevos para repartir'}`;
    toast(titulo, 'ok');
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(titulo, { body: nuevos.map((n) => `${n.pedido} · ${n.zona || ''}`).join('\n') }); } catch {}
    clearInterval(parpadeo); let on = false;
    parpadeo = setInterval(() => { document.title = on ? titulo0 : `(${nuevos.length}) ¡Nuevo pedido!`; on = !on; }, 900);
    setTimeout(() => { clearInterval(parpadeo); document.title = titulo0; }, 15000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(parpadeo); document.title = titulo0; cargar(); } });

  // ---------- sesión ----------
  function salir(render = true) { token = null; datos = null; ls.del(K('token')); clearInterval(timer); if (flujo) flujo.abort(); if (render) pintar(); }
  function pintarLogin(info = {}) {
    $('#r').innerHTML = `<div class="r-head"><b>🛵 Reparto</b></div><div class="r-wrap"><form class="card form" id="lf"><div class="full"><h1 style="margin:0">Entrar</h1><p class="muted" style="margin:4px 0 0">Con el usuario que te dio el abasto.</p></div>
      ${info.pedirCodigo ? `<div class="full"><label>Código del abasto</label><input name="empresa" value="${e(slug)}" autocapitalize="none" required></div>` : ''}
      <div class="full"><label>Usuario</label><input name="usuario" autocapitalize="none" autocomplete="username" required></div>
      <div class="full"><label>Clave</label><input name="clave" type="password" autocomplete="current-password" required></div><div id="le" class="bad full"></div>
      <div class="full"><button class="btn pri lg" style="width:100%">Entrar</button></div></form></div>`;
    $('#lf').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try {
        const r = await api('POST', '/api/login', { empresa: f.empresa ? f.empresa.value.trim().toLowerCase() : (slug || undefined), usuario: f.usuario.value, clave: f.clave.value });
        if (r.usuario.rol !== 'repartidor' && !['admin', 'supervisor'].includes(r.usuario.rol)) throw new Error('Este usuario no es de reparto');
        token = r.token; ls.set(K('token'), token); primeraCarga = true; pintar();
      } catch (er) { $('#le').textContent = er.message; }
    };
  }
  async function pintar() {
    if (!token) { let info = {}; try { info = { pedirCodigo: !slug && !(await api('GET', '/api/plataforma/info')).unica }; } catch {} return pintarLogin(info); }
    clearInterval(timer);
    await cargar();
    timer = setInterval(cargar, 10000); // respaldo: si la conexión directa se cae, igual se consulta cada pocos segundos
    conectarEventos();
  }
  // Conexión abierta con el servidor: cuando cambia algo (te asignan un pedido, uno queda listo, otro repartidor toma uno) llega al instante.
  let flujo = null;
  async function conectarEventos() {
    if (!token || flujo) return;
    const ctl = flujo = new AbortController();
    try {
      const r = await fetch('/api/reparto/eventos', { headers: { Authorization: 'Bearer ' + token }, signal: ctl.signal });
      if (!r.ok || !r.body) throw new Error('sin flujo');
      const lector = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { const bloque = buf.slice(0, i); buf = buf.slice(i + 2); if (/^data: /m.test(bloque)) cargar(); }
      }
    } catch { /* se reintenta abajo */ }
    flujo = null;
    if (token) setTimeout(conectarEventos, 3000);
  }

  // ---------- datos ----------
  async function cargar() {
    if (!token) return;
    try {
      datos = await api('GET', '/api/reparto/mis'); sinConexion = false;
      // se avisa de lo que no se había visto, incluido un pedido que te asignan aunque ya estuviera en la lista como disponible
      const porBuscar = [...datos.asignados, ...datos.disponibles, ...datos.proximos];
      const clave = (o) => o.id + '/' + (o.repartidor_id || '');
      const nuevos = porBuscar.filter((o) => !vistos.has(clave(o)));
      if (nuevos.length) { nuevos.forEach((o) => vistos.add(clave(o))); ls.set(K('vistos'), JSON.stringify([...vistos].slice(-300))); if (!primeraCarga) avisar(nuevos); }
      primeraCarga = false;
    } catch (er) { if (er.red) sinConexion = true; else if (token) falla(er); }
    dibujar();
  }
  const tel = (t) => String(t || '').replace(/\D/g, '');
  const wa = (t) => { const d = tel(t); return d.startsWith('0') ? '58' + d.slice(1) : d; };
  const mapa = (o) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([o.direccion, o.zona].filter(Boolean).join(', '));
  // Los tres estados que maneja el repartidor, con el que lleva el pedido marcado
  function pasosRep(o, tipo) {
    if (tipo === 'preparando') return '';
    const rechazada = o.estado === 'rechazada';
    const hechos = { lista_envio: 0, retirada: 1, enviada: 2, entregada: 3, rechazada: 2 }[o.estado] ?? 0;
    return `<div class="pasos-rep">${['Retirado de la tienda', 'En camino', rechazada ? 'Rechazado' : 'Entregado'].map((t, i) => (rechazada && i === 2 ? `<span class="mal">✖ ${t}</span>` : `<span class="${i < hechos ? 'hecho' : i === hechos ? 'actual' : ''}">${i < hechos ? '✔ ' : ''}${t}</span>`)).join('')}</div>`;
  }
  function tarjeta(o, tipo) {
    const contacto = o.contacto || o.cliente, t = o.tel_contacto || o.tel_cliente;
    const nuevo = tipo === 'buscar' && !o.visto;
    return `<div class="entrega ${nuevo ? '' : ''}"><div class="row" style="justify-content:space-between;align-items:center"><b>${e(o.pedido)} · ${e(o.orden)}</b>
        <span>${tipo === 'preparando' ? '<span class="tag info">Asignado a ti · se está preparando</span>' : tipo === 'buscar' ? (o.repartidor_id ? '<span class="tag info">Asignado a ti</span>' : '<span class="tag warn">Disponible</span>') : tipo === 'camino' ? (o.estado === 'retirada' ? '<span class="tag info">Retirado de la tienda</span>' : '<span class="tag ok">En camino</span>') : (o.estado === 'rechazada' ? '<span class="tag bad">Rechazado</span>' : '<span class="tag ok">Entregado</span>')}</span></div>
      <div class="dir">${e(o.direccion || 'Sin dirección')}${o.zona ? ' — ' + e(o.zona) : ''}</div>
      ${pasosRep(o, tipo)}
      ${cobro(o)}
      ${o.referencia_entrega ? `<div class="muted">Referencia: ${e(o.referencia_entrega)}</div>` : ''}
      <div style="margin-top:6px">${e(contacto)} · <b>${fmUn(o.unidades)}</b></div>${o.nota ? `<div class="muted">Nota: ${e(o.nota)}</div>` : ''}
      ${tipo === 'entregado' ? (o.estado === 'rechazada' ? `<div class="muted" style="margin-top:6px">Rechazado ${e((o.rechazado_en || '').slice(11, 16))} · ${e(o.motivo_rechazo || '')}</div>` : `<div class="muted" style="margin-top:6px">Entregado ${e((o.entregado_en || '').slice(11, 16))}${o.receptor ? ' a ' + e(o.receptor) : ''}</div>`) : ''}
      <div class="acc">${t ? `<a class="btn" href="tel:${tel(t)}">📞 Llamar</a><a class="btn" target="_blank" href="https://wa.me/${wa(t)}">WhatsApp</a>` : ''}<a class="btn" target="_blank" href="${mapa(o)}">🗺 Mapa</a></div>
      ${tipo === 'preparando' ? '<div class="muted" style="margin-top:6px">Aún no está listo: te avisaremos cuando puedas pasar a buscarlo.</div>' : ''}
      ${tipo === 'buscar' ? `<div class="acc">${o.repartidor_id ? '' : `<button class="btn" data-a="tomar" data-id="${o.id}">Tomar este pedido</button>`}<button class="btn pri" data-a="retirar" data-id="${o.id}">✔ Retirado de la tienda</button></div>` : ''}
      ${tipo === 'camino' ? `<div class="acc">${o.estado === 'retirada' ? `<button class="btn pri" data-a="salir" data-id="${o.id}">🛵 Salir en camino</button>` : `<button class="btn pri" data-a="entregar" data-id="${o.id}" data-p="${e(o.pedido)}">✔ Entregado</button><button class="btn bad" data-a="rechazar" data-id="${o.id}" data-p="${e(o.pedido)}">✖ Rechazado</button>`}</div>` : ''}</div>`;
  }
  const sim = { USD: '$', VES: 'Bs ', EUR: '€' };
  const din = (n, mo) => (sim[mo] || '') + Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function cobro(o) {
    let p = null; try { p = o.pago ? JSON.parse(o.pago) : null; } catch {}
    if (!p || !['efectivo', 'punto'].includes(p.medio)) return '';
    if (p.medio === 'punto') return `<div class="cobro">💳 <b>Cobrar con punto de venta:</b> ${din(p.monto, p.moneda)}</div>`;
    const vuelto = p.paga_con ? Math.max(0, p.paga_con - p.monto) : 0;
    return `<div class="cobro">💵 <b>Cobrar en efectivo:</b> ${din(p.monto, p.moneda)}${p.paga_con ? `<br>Paga con <b>${din(p.paga_con, p.moneda)}</b>${vuelto > 0.005 ? ` → <b>lleva vuelto: ${din(vuelto, p.moneda)}</b>` : ' (monto exacto)'}` : '<br><span class="muted">No indicó con cuánto paga: lleva cambio.</span>'}</div>`;
  }
  const fmUn = (n) => `${Number(n || 0).toLocaleString('es-VE', { maximumFractionDigits: 0 })} unidad${Number(n) === 1 ? '' : 'es'}`;
  function dibujar() {
    if (!datos) return;
    const buscar = [...datos.asignados, ...datos.disponibles];
    const tabs = [['buscar', 'Por buscar', buscar.length + datos.proximos.length], ['camino', 'Retirados y en camino', (datos.retirados || []).length + datos.en_camino.length], ['entregados', 'Terminados hoy', datos.entregados.length]];
    const lista = pestana === 'buscar' ? buscar : pestana === 'camino' ? [...(datos.retirados || []), ...datos.en_camino] : datos.entregados;
    const tipo = pestana === 'buscar' ? 'buscar' : pestana === 'camino' ? 'camino' : 'entregado';
    const notif = 'Notification' in window && Notification.permission === 'default';
    $('#r').innerHTML = `<div class="r-head"><b>🛵 ${e(datos.repartidor)}</b><button class="btn sm" data-a="sonido">${sonido ? '🔔 Aviso' : '🔕 Silencio'}</button><button class="btn sm" data-a="logout">Salir</button></div>
      <div class="r-wrap">${sinConexion ? '<div class="semaforo rojo" style="margin-bottom:12px"><span class="luz"></span><span>Sin conexión: reintentando…</span></div>' : ''}
        ${notif ? '<div class="semaforo amarillo" style="margin-bottom:12px"><span class="luz"></span><span style="flex:1">Activa los avisos para enterarte aunque la pantalla esté apagada.</span><button class="btn sm" data-a="notif">Activar</button></div>' : ''}
        <div class="r-tabs">${tabs.map(([k, t, n]) => `<button class="btn ${k === pestana ? 'pri' : ''}" data-a="pestana" data-k="${k}">${t} (${n})</button>`).join('')}</div>
        ${pestana === 'buscar' ? datos.proximos.map((o) => tarjeta(o, 'preparando')).join('') : ''}
        ${lista.length || (pestana === 'buscar' && datos.proximos.length) ? lista.map((o) => tarjeta(o, tipo)).join('') : `<div class="card empty">${pestana === 'buscar' ? 'No hay pedidos para buscar. Te avisaremos con un pitido cuando haya uno listo.' : pestana === 'camino' ? 'No llevas pedidos en camino.' : 'Aún no has entregado pedidos hoy.'}</div>`}
        <p class="muted c" style="font-size:12px">Actualizado ${e((datos.ahora || '').slice(11, 19))} · se actualiza al instante cuando hay cambios</p></div>`;
  }

  // ---------- acciones ----------
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.a === 'pestana') { pestana = b.dataset.k; ls.set(K('pestana'), pestana); dibujar(); }
      else if (b.dataset.a === 'sonido') { sonido = !sonido; ls.set(K('sonido'), sonido ? '1' : '0'); if (sonido) pitar(); dibujar(); }
      else if (b.dataset.a === 'logout') { try { await api('POST', '/api/logout'); } catch {} salir(); }
      else if (b.dataset.a === 'notif') { await Notification.requestPermission(); dibujar(); }
      else if (b.dataset.a === 'tomar') { b.disabled = true; await api('POST', `/api/reparto/ordenes/${id}/tomar`); toast('Pedido tomado: es tuyo', 'ok'); await cargar(); }
      else if (b.dataset.a === 'retirar') {
        b.disabled = true; await api('POST', `/api/reparto/ordenes/${id}/retirar`); toast('Retirado de la tienda. Cuando salgas, márcalo en camino.', 'ok'); pestana = 'camino'; ls.set(K('pestana'), pestana); await cargar();
      } else if (b.dataset.a === 'salir') {
        b.disabled = true; await api('POST', `/api/reparto/ordenes/${id}/salir`); toast('En camino. ¡Buen viaje!', 'ok'); pestana = 'camino'; ls.set(K('pestana'), pestana); await cargar();
      } else if (b.dataset.a === 'entregar') entregar(id, b.dataset.p);
      else if (b.dataset.a === 'rechazar') rechazar(id, b.dataset.p);
    } catch (er) { falla(er); b.disabled = false; await cargar(); }
  });
  // El cliente no recibió el pedido: se marca rechazado con el motivo y el negocio decide qué hacer
  function rechazar(id, pedido) {
    const v = document.createElement('div'); v.className = 'velo';
    const motivos = ['El cliente no quiso el pedido', 'No había nadie para recibirlo', 'Dirección incorrecta o no se pudo ubicar', 'El producto no era lo que esperaba', 'No tenía el dinero para pagar', 'Otro motivo'];
    v.innerHTML = `<div class="modal"><header><span>Rechazado ${e(pedido)}</span><button class="btn sm" data-x>✕</button></header><div class="cuerpo"><form id="rf" class="form"><div class="full"><label>¿Por qué no se entregó? *</label><select name="motivo" required>${motivos.map((m) => `<option>${e(m)}</option>`).join('')}</select></div><div class="full"><label>Detalle (opcional)</label><input name="nota" placeholder="Ej. dice que lo pidió otra persona" autocomplete="off"></div><div class="muted full" style="font-size:12px">Llévate el pedido de vuelta. El negocio decidirá si lo reprograma o lo cancela.</div><div id="re" class="bad full"></div><div class="full"><button class="btn bad lg" style="width:100%">Confirmar: pedido rechazado</button></div></form></div></div>`;
    document.body.appendChild(v);
    v.querySelector('[data-x]').onclick = () => v.remove();
    v.querySelector('#rf').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', `/api/reparto/ordenes/${id}/rechazar`, { motivo: f.motivo.value, nota: f.nota.value }); v.remove(); toast('Marcado como rechazado. Devuelve el pedido a la tienda.', 'ok'); pestana = 'entregados'; ls.set(K('pestana'), pestana); await cargar(); }
      catch (er) { v.querySelector('#re').textContent = er.message; }
    };
  }
  function entregar(id, pedido) {
    const v = document.createElement('div'); v.className = 'velo';
    v.innerHTML = `<div class="modal"><header><span>Entregar ${e(pedido)}</span><button class="btn sm" data-x>✕</button></header><div class="cuerpo"><form id="ef" class="form"><div class="full"><label>¿Quién recibió? (opcional)</label><input name="receptor" autocomplete="off"></div><div class="full"><label>Nota (opcional)</label><input name="nota" placeholder="Ej. se dejó con el vigilante" autocomplete="off"></div><div id="ee" class="bad full"></div><div class="full"><button class="btn pri lg" style="width:100%">Confirmar entrega</button></div></form></div></div>`;
    document.body.appendChild(v);
    v.querySelector('[data-x]').onclick = () => v.remove();
    v.querySelector('#ef').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try { await api('POST', `/api/reparto/ordenes/${id}/entregar`, { receptor: f.receptor.value, nota: f.nota.value }); v.remove(); toast('Entrega registrada. ¡Gracias!', 'ok'); pestana = 'entregados'; ls.set(K('pestana'), pestana); await cargar(); }
      catch (er) { v.querySelector('#ee').textContent = er.message; }
    };
  }
  pintar();
})();
