'use strict';
// Núcleo del cliente administrativo: API, utilidades, modales, enrutador y estructura.
window.Abasto = (() => {
  const A = { S: { user: null, perms: new Set(), jornada: null, turno: null, empresa: {} }, vistas: {} };
  let token = null;
  try { token = localStorage.getItem('abasto_token'); } catch {}

  // ---------- utilidades ----------
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fm = (n, d = 2) => (n == null || n === '' || isNaN(n) ? '—' : Number(n).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const usd = (n) => '$ ' + fm(n);
  const ves = (n) => 'Bs ' + fm(n);
  const mon = (n, m) => (m === 'USD' ? usd(n) : m === 'VES' ? ves(n) : m === 'EUR' ? '€ ' + fm(n) : fm(n));
  const fecha = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const can = (p) => A.S.perms.has(p);
  const MEDIOS = { efectivo: 'Efectivo', pago_movil: 'Pago móvil', transferencia: 'Transferencia', punto: 'Punto de venta', credito: 'Crédito' };
  const tag = (txt, tipo = '') => `<span class="tag ${tipo}">${e(txt)}</span>`;
  const estadoTag = (s) => {
    const m = { completada: 'ok', pagada: 'ok', recibida: 'ok', cerrada: 'ok', cerrado: 'ok', validado: 'ok', abierta: 'info', pendiente: 'warn', abonada: 'warn', borrador: 'warn', pago_reportado: 'warn', anulada: 'bad', anulado: 'bad', rechazado: 'bad', cancelado: 'bad', vencido: 'bad', pagado: 'ok', entregado: 'ok', generado: 'info', cargado: 'warn', ajustado: 'ok', suspendido: 'bad', activo: 'ok' };
    return tag(String(s).replace(/_/g, ' '), m[s] || '');
  };
  A.e = e; A.fm = fm; A.usd = usd; A.ves = ves; A.mon = mon; A.fecha = fecha; A.hoy = hoy; A.can = can; A.MEDIOS = MEDIOS; A.tag = tag; A.estadoTag = estadoTag;

  // ---------- API ----------
  async function api(metodo, url, body) {
    let r;
    try {
      r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch { throw new Error('Sin conexión con el servidor'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token && !url.includes('/login')) { cerrarSesionLocal(); throw new Error(j.error || 'Sesión vencida'); }
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  A.api = { get: (u) => api('GET', u), post: (u, b) => api('POST', u, b || {}), put: (u, b) => api('PUT', u, b || {}), del: (u) => api('DELETE', u) };
  A.descargar = async (url) => {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Error ' + r.status); }
    const b = await r.blob();
    const nombre = ((r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'respaldo.db';
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  A.qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== '' && v != null && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // ---------- avisos y modales ----------
  function toast(msg, tipo = '') {
    const t = document.createElement('div'); t.className = 'toast ' + tipo; t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), tipo === 'bad' ? 6000 : 3200);
  }
  A.toast = toast;
  A.ok = (m) => toast(m, 'ok'); A.fail = (er) => toast(er.message || String(er), 'bad');

  function abrirModal(titulo, cuerpoHtml, { ancho = false, pie = '', onMount } = {}) {
    const v = document.createElement('div'); v.className = 'velo';
    v.innerHTML = `<div class="modal ${ancho ? 'ancho' : ''}" role="dialog" aria-modal="true"><header><span>${e(titulo)}</span><button class="btn sm" data-x>✕</button></header><div class="cuerpo">${cuerpoHtml}</div>${pie ? `<footer>${pie}</footer>` : ''}</div>`;
    document.body.appendChild(v);
    const cerrar = () => { v.remove(); document.removeEventListener('keydown', esc); };
    const esc = (ev) => { if (ev.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', esc);
    v.addEventListener('mousedown', (ev) => { if (ev.target === v) cerrar(); });
    v.querySelector('[data-x]').onclick = cerrar;
    const foco = v.querySelector('input:not([type=hidden]),select,textarea'); if (foco) foco.focus();
    if (onMount) onMount(v, cerrar);
    return { el: v, cerrar };
  }
  A.modal = abrirModal;

  function campoHtml(c, val) {
    const id = 'f_' + c.n, v = val ?? c.v ?? '';
    const req = c.req ? 'required' : '';
    let inp;
    if (c.t === 'select') inp = `<select id="${id}" name="${c.n}" ${req}>${(c.o || []).map(([k, l]) => `<option value="${e(k)}" ${String(k) === String(v) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`;
    else if (c.t === 'textarea') inp = `<textarea id="${id}" name="${c.n}" rows="3" ${req}>${e(v)}</textarea>`;
    else if (c.t === 'checkbox') inp = `<input id="${id}" name="${c.n}" type="checkbox" ${v ? 'checked' : ''}>`;
    else inp = `<input id="${id}" name="${c.n}" type="${c.t || 'text'}" value="${e(v)}" ${c.t === 'number' ? `step="${c.step || 'any'}"` : ''} ${c.min != null ? `min="${c.min}"` : ''} placeholder="${e(c.ph || '')}" ${req} ${c.ro ? 'readonly' : ''} autocomplete="off">`;
    return `<div class="${c.full ? 'full' : ''}"><label for="${id}">${e(c.l)}${c.req ? ' *' : ''}</label>${inp}${c.ayuda ? `<div class="muted" style="font-size:11px;margin-top:3px">${e(c.ayuda)}</div>` : ''}</div>`;
  }
  function leerForm(form, campos) {
    const o = {};
    for (const c of campos) {
      const el = form.elements[c.n]; if (!el) continue;
      o[c.n] = c.t === 'checkbox' ? el.checked : c.t === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    }
    return o;
  }
  // Modal con formulario generado a partir de campos
  A.form = (titulo, campos, valores = {}, onOk, { ok = 'Guardar', ancho = false, extra = '' } = {}) => new Promise((res) => {
    const html = `<form id="mf" class="form">${campos.map((c) => campoHtml(c, valores[c.n])).join('')}</form>${extra}<div id="mf-err" class="bad" style="margin-top:10px"></div>`;
    abrirModal(titulo, html, { ancho, pie: `<button class="btn" data-x2>Cancelar</button><button class="btn pri" id="mf-ok">${e(ok)}</button>`,
      onMount: (v, cerrar) => {
        const f = v.querySelector('#mf');
        v.querySelector('[data-x2]').onclick = cerrar;
        const enviar = async (ev) => {
          ev && ev.preventDefault();
          if (!f.reportValidity()) return;
          const btn = v.querySelector('#mf-ok'); btn.disabled = true;
          try { const r = await onOk(leerForm(f, campos), v); cerrar(); res(r === undefined ? true : r); }
          catch (er) { v.querySelector('#mf-err').textContent = er.message; btn.disabled = false; }
        };
        f.onsubmit = enviar; v.querySelector('#mf-ok').onclick = enviar;
      } });
  });
  A.confirmar = (titulo, msg, { ok = 'Confirmar', peligro = false } = {}) => new Promise((res) => {
    abrirModal(titulo, `<p>${msg}</p>`, { pie: `<button class="btn" data-n>Cancelar</button><button class="btn ${peligro ? 'bad' : 'pri'}" data-s>${e(ok)}</button>`,
      onMount: (v, c) => { v.querySelector('[data-n]').onclick = () => { c(); res(false); }; v.querySelector('[data-s]').onclick = () => { c(); res(true); }; } });
  });
  A.pedirMotivo = (titulo, etiqueta = 'Motivo') => new Promise((res) => {
    A.form(titulo, [{ n: 'motivo', l: etiqueta, t: 'textarea', req: true, full: true }], {}, (v) => { res(v.motivo); return v.motivo; }, { ok: 'Continuar' }).then((r) => { if (!r) res(null); });
  });

  // ---------- tablas ----------
  A.tabla = (cols, filas, { vacio = 'Sin registros', clic = false } = {}) => {
    if (!filas.length) return `<div class="empty">${e(vacio)}</div>`;
    return `<div class="scroll"><table><thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''}">${e(c.h)}</th>`).join('')}</tr></thead><tbody>${filas.map((r, i) =>
      `<tr ${clic ? `class="click" data-i="${i}"` : ''}>${cols.map((c) => `<td class="${c.n ? 'n' : ''}">${c.f(r, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  };
  // Delegación de eventos: acciones = { nombre: (el, ev) => ... } sobre elementos con data-a="nombre"
  A.acciones = (root, acciones) => {
    root.onclick = async (ev) => {
      const el = ev.target.closest('[data-a]');
      if (!el || !root.contains(el)) return;
      const fn = acciones[el.dataset.a];
      if (!fn) return;
      try { await fn(el, ev); } catch (er) { A.fail(er); }
    };
  };
  A.descargarCSV = (nombre, filas) => {
    const csv = filas.map((f) => f.map((c) => { const t = String(c ?? ''); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  A.debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- lector de códigos de barras ----------
  // Cubre los 3 tipos de equipo: teclado (USB/Bluetooth que "escribe" el código y cierra con Enter o Tab), serial (puerto COM virtual) y cámara.
  const LEC = A.lector = {
    handler: null, puerto: null, estadoSerial: 'sin conectar',
    cfg: () => A.S.lector || { tipo: 'teclado', sufijo: 'Enter', prefijo: '', largo_min: 6, ms_entre_teclas: 60, captura_global: true, sonido: true, validar_digito: false, baudios: 9600 },
    alLeer(fn) { LEC.handler = fn; },
    limpiar(raw) { let c = String(raw || '').trim(); const p = LEC.cfg().prefijo; if (p && c.startsWith(p)) c = c.slice(p.length); return c; },
    pareceCodigo(c) { return c.length >= LEC.cfg().largo_min && /^\S+$/.test(c) && /\d/.test(c); },
    // Dígito de control GTIN (EAN-8, UPC-A, EAN-13, GTIN-14); otros códigos no se validan
    digitoOk(c) {
      if (!/^(\d{8}|\d{12,14})$/.test(c)) return true;
      const d = c.split('').map(Number), ctrl = d.pop();
      let s = 0; d.reverse().forEach((n, i) => { s += n * (i % 2 === 0 ? 3 : 1); });
      return (10 - (s % 10)) % 10 === ctrl;
    },
    pitar(ok = true) {
      if (!LEC.cfg().sonido) return;
      try {
        const ac = LEC.ac || (LEC.ac = new (window.AudioContext || window.webkitAudioContext)());
        const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination);
        o.frequency.value = ok ? 1100 : 220; g.gain.value = 0.08; o.start(); o.stop(ac.currentTime + (ok ? 0.08 : 0.25));
      } catch { /* sin audio: no pasa nada */ }
    },
    emitir(raw) {
      const c = LEC.limpiar(raw);
      if (!c) return;
      if (LEC.cfg().validar_digito && !LEC.digitoOk(c)) { LEC.pitar(false); A.toast('Código leído con dígito de control incorrecto (' + c + '). Vuelve a escanearlo.', 'bad'); return; }
      if (LEC.handler) LEC.handler(c);
    },
    // --- cámara: detecta códigos con BarcodeDetector (Chrome/Edge/Android) ---
    async escanearCamara(alCodigo) {
      if (!('BarcodeDetector' in window)) throw new Error('Este navegador no puede leer códigos con la cámara. Usa Chrome o Edge, o un lector de mano.');
      const v = document.createElement('div'); v.className = 'velo';
      v.innerHTML = '<div class="modal"><header><span>Apunta al código de barras</span><button class="btn sm" data-x>✕</button></header><div class="cuerpo"><video playsinline muted style="width:100%;border-radius:8px;background:#000"></video><p class="muted c" style="margin:8px 0 0">Se cierra solo al leer un código.</p></div></div>';
      document.body.appendChild(v);
      let stream, vivo = true;
      const cerrar = () => { vivo = false; if (stream) stream.getTracks().forEach((t) => t.stop()); v.remove(); };
      v.querySelector('[data-x]').onclick = cerrar;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const vid = v.querySelector('video'); vid.srcObject = stream; await vid.play();
        const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
        while (vivo) {
          const r = await det.detect(vid).catch(() => []);
          if (r.length) { cerrar(); alCodigo(r[0].rawValue); return; }
          await new Promise((ok) => setTimeout(ok, 250));
        }
      } catch { cerrar(); throw new Error('No se pudo usar la cámara (revisa el permiso del navegador).'); }
    },
    // --- serial: lector con puerto COM virtual (Web Serial; Chrome/Edge) ---
    async abrirPuerto(port) {
      await port.open({ baudRate: LEC.cfg().baudios });
      LEC.puerto = port; LEC.estadoSerial = 'conectado';
      const dec = new TextDecoderStream();
      port.readable.pipeTo(dec.writable).catch(() => {});
      const reader = dec.readable.getReader();
      let acc = '';
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            acc += value;
            let i;
            while ((i = acc.search(/[\r\n]/)) >= 0) { const linea = acc.slice(0, i); acc = acc.slice(i + 1); if (linea.trim()) LEC.emitir(linea); }
          }
        } catch { /* puerto desconectado */ }
        LEC.puerto = null; LEC.estadoSerial = 'desconectado';
      })();
    },
    async conectarSerial() {
      if (!('serial' in navigator)) throw new Error('Este navegador no permite puertos seriales. Usa Chrome o Edge.');
      await LEC.abrirPuerto(await navigator.serial.requestPort());
    },
    async autoSerial() {
      if (LEC.puerto || !('serial' in navigator) || LEC.cfg().tipo !== 'serial') return;
      try { const [p] = await navigator.serial.getPorts(); if (p) await LEC.abrirPuerto(p); } catch { /* sin permiso previo */ }
    }
  };
  // --- teclado: se distingue un lector de una persona por la velocidad entre teclas ---
  (() => {
    let buf = '', tPrev = 0, espera = null;
    document.addEventListener('keydown', (ev) => {
      const c = LEC.cfg();
      if (!LEC.handler || c.tipo !== 'teclado' || !c.captura_global || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const t = performance.now();
      const esFin = (c.sufijo === 'Enter' && ev.key === 'Enter') || (c.sufijo === 'Tab' && ev.key === 'Tab');
      const consumir = (codigo) => {
        const el = document.activeElement;
        // las teclas del lector ya se escribieron en el campo enfocado: se quitan
        if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && typeof el.value === 'string' && el.value.endsWith(codigo)) el.value = el.value.slice(0, el.value.length - codigo.length);
        LEC.emitir(codigo);
      };
      if (esFin) {
        const codigo = buf; buf = '';
        if (codigo.length >= c.largo_min) { ev.preventDefault(); ev.stopImmediatePropagation(); consumir(codigo); }
        return;
      }
      if (ev.key.length !== 1) return;
      if (buf && t - tPrev > c.ms_entre_teclas) buf = '';
      buf += ev.key; tPrev = t;
      if (c.sufijo === 'ninguno') { // sin carácter final: se cierra la lectura al dejar de llegar teclas
        clearTimeout(espera);
        espera = setTimeout(() => { const codigo = buf; buf = ''; if (codigo.length >= c.largo_min) consumir(codigo); }, Math.max(80, c.ms_entre_teclas * 2));
      }
    }, true);
  })();

  // ---------- sesión ----------
  function cerrarSesionLocal() {
    token = null; try { localStorage.removeItem('abasto_token'); } catch {}
    A.S.user = null; render();
  }
  async function cargarYo() {
    const me = await A.api.get('/api/me');
    A.S.user = me.usuario; A.S.perms = new Set(me.permisos); A.S.jornada = me.jornada; A.S.turno = me.turno; A.S.empresa = me.empresa;
    A.S.licencia = me.licencia; A.S.empresa_codigo = me.empresa_codigo; A.S.reconocimiento = me.reconocimiento; A.S.lector = me.lector;
    A.lector.autoSerial();
  }
  A.refrescarEstado = async () => { await cargarYo(); pintarChips(); };

  // ---------- navegación ----------
  const NAV = [
    ['inicio', 'Inicio', null], ['pos', 'Punto de venta', 'mod.pos'], ['caja', 'Caja', 'mod.caja'], ['pedidos', 'Pedidos app', 'mod.pedidos'], ['app', 'App de clientes (delivery)', 'mod.app'], ['reparto', 'App del repartidor', 'mod.app'],
    ['-', 'Inventario', null], ['productos', 'Productos', 'mod.productos'], ['inventario', 'Existencias', 'mod.inventario'], ['conteos', 'Conteos cíclicos', 'mod.conteos'],
    ['-', 'Compras', null], ['compras', 'Compras', 'mod.compras'], ['proveedores', 'Proveedores', 'mod.proveedores'], ['cxp', 'Cuentas por pagar', 'mod.cxp'],
    ['-', 'Ventas y cobros', null], ['ventas', 'Ventas', 'mod.ventas'], ['clientes', 'Clientes y crédito', 'mod.clientes'], ['cxc', 'Cuentas por cobrar', 'mod.cxc'],
    ['-', 'Finanzas', null], ['cuentas', 'Bancos y cajas', 'mod.cuentas'], ['finanzas', 'Análisis financiero', 'mod.finanzas'], ['reportes', 'Reportes', 'mod.reportes'], ['parametros', 'Parámetros', 'mod.parametros']
  ];
  function ruta() { const h = location.hash.replace(/^#\/?/, '') || 'inicio'; const [v, ...r] = h.split('/'); return { v, arg: r.join('/') }; }
  A.ir = (h) => { location.hash = '#/' + h; };
  // Enlace de WhatsApp para un teléfono venezolano (0424… o +58424…) con el texto ya escrito
  A.wa = (tel, texto) => { let d = String(tel || '').replace(/[^0-9]/g, ''); if (d.startsWith('0')) d = '58' + d.slice(1); else if (d.length === 10) d = '58' + d; return d ? `https://wa.me/${d}?text=${encodeURIComponent(texto)}` : ''; };
  A.urlReparto = () => `${location.origin}/reparto/${localStorage.getItem('abasto_empresa') || ''}/`;

  function pintarChips() {
    const c = document.getElementById('chips'); if (!c) return;
    const j = A.S.jornada, t = A.S.turno;
    const lic = A.S.licencia || {};
    const chipLic = lic.estado === 'gracia' ? `<span class="chip warn">Licencia vencida: te quedan ${Math.max(0, 5 + lic.dias_restantes)} día(s) de gracia</span>`
      : lic.estado === 'vencida' ? '<span class="chip bad">Licencia vencida: solo lectura. Renueva tu plan</span>'
      : lic.estado === 'activa' && lic.dias_restantes <= 7 ? `<span class="chip warn">Tu licencia vence en ${lic.dias_restantes} día(s)</span>` : '';
    const viejo = j && j.fecha < hoy();
    c.innerHTML = `${chipLic}${viejo ? `<a class="chip bad" href="#/inicio" title="Cierra este día y abre el de hoy con su tasa">El día abierto es del ${e(j.fecha)}: falta la tasa de hoy</a>` : ''}${j ? `<span class="chip ${viejo ? 'warn' : 'ok'}">Día abierto ${e(j.fecha)}</span><span class="chip">$ = Bs ${fm(j.tasa_usd_ves, 2)}</span><span class="chip">€ = Bs ${fm(j.tasa_usd_ves * j.tasa_eur_usd, 2)}</span>` : `<a class="chip bad" href="#/inicio">Día cerrado — abrir con tasas</a>`}
      ${t ? `<span class="chip ok">Mi caja abierta</span>` : ''}`;
  }

  async function render() {
    const root = document.getElementById('root');
    if (!token || !A.S.user) {
      if (token) { try { await cargarYo(); } catch { token = null; } }
    }
    if (!token || !A.S.user) return login(root);
    const { v, arg } = ruta();
    const reqPerm = (NAV.find((x) => x[0] === v) || [])[2];
    const sinAcceso = reqPerm && !can(reqPerm);
    const vista = sinAcceso ? async (r) => { r.innerHTML = '<div class="card"><h2>Sin acceso a este módulo</h2><p class="muted">Tu rol (' + e(A.S.user.rol) + ') no incluye este módulo. Si lo necesitas, pídele al administrador que lo active en Parámetros › Roles y permisos.</p></div>'; } : (A.vistas[v] || A.vistas.inicio);
    root.innerHTML = `<div id="app"><nav id="nav"><div class="marca">${A.S.empresa.logo ? `<img src="${A.S.empresa.logo}" alt="" style="max-width:100%;max-height:56px;display:block;margin-bottom:6px">` : '🛒 '}${e(A.S.empresa.nombre || 'Abasto Cloud')}</div>${NAV.map(([k, l, p]) => k === '-' ? `<div class="sep">${e(l)}</div>` : (p && !can(p) ? '' : `<a href="#/${k}" class="${k === v ? 'act' : ''}">${e(l)}</a>`)).join('')}
      <div class="sep">Sesión</div><a href="#" data-salir>Salir (${e(A.S.user.usuario)})</a></nav>
      <div id="main"><div class="topbar"><button class="btn" id="menu-btn">☰</button><div class="chips" id="chips"></div><span class="muted">${e(A.S.user.nombre)} · ${e(A.S.user.rol)}</span></div><div id="vista"><div class="empty">Cargando…</div></div></div></div>`;
    pintarChips();
    document.getElementById('menu-btn').onclick = () => document.getElementById('nav').classList.toggle('abierto');
    root.querySelector('[data-salir]').onclick = async (ev) => { ev.preventDefault(); try { await A.api.post('/api/logout'); } catch {} cerrarSesionLocal(); };
    document.getElementById('nav').addEventListener('click', (ev) => { if (ev.target.tagName === 'A') document.getElementById('nav').classList.remove('abierto'); });
    try { await vista(document.getElementById('vista'), arg); }
    catch (er) { document.getElementById('vista').innerHTML = `<div class="card bad">${e(er.message)}</div>`; }
  }
  A.render = render;

  async function login(root) {
    let info = { unica: null, multi: false };
    try { info = await api('GET', '/api/plataforma/info'); } catch {}
    let emp = new URLSearchParams(location.search).get('e') || '';
    if (!emp) { try { emp = localStorage.getItem('abasto_empresa') || ''; } catch {} }
    const pedirEmpresa = !info.unica;
    root.innerHTML = `<div class="login"><form class="card" id="lf"><h1>🛒 Abasto Cloud</h1><p class="muted">Ingresa con tu usuario.</p>
      ${pedirEmpresa ? `<label>Código de tu abasto</label><input name="empresa" value="${e(emp)}" autocapitalize="none" autocomplete="organization" placeholder="ej. abasto-sur" required><div style="height:10px"></div>` : ''}
      <label>Usuario</label><input name="usuario" autocomplete="username" ${pedirEmpresa && emp ? 'autofocus' : pedirEmpresa ? '' : 'autofocus'} required><div style="height:10px"></div>
      <label>Clave</label><input name="clave" type="password" autocomplete="current-password" required><div id="le" class="bad" style="margin:10px 0"></div>
      <button class="btn pri lg" style="width:100%">Entrar</button><p class="muted" style="margin-top:14px;font-size:12px">¿Eres cliente? Haz tu pedido en <a href="/tienda/">/tienda</a></p></form></div>`;
    document.getElementById('lf').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      try {
        const empresa = f.empresa ? f.empresa.value.trim().toLowerCase() : undefined;
        const r = await api('POST', '/api/login', { empresa, usuario: f.usuario.value, clave: f.clave.value });
        token = r.token; try { localStorage.setItem('abasto_token', token); if (empresa) localStorage.setItem('abasto_empresa', empresa); } catch {}
        await cargarYo(); render();
      } catch (er) { document.getElementById('le').textContent = er.message; }
    };
  }

  A.iniciar = () => { window.addEventListener('hashchange', render); render(); };
  return A;
})();
