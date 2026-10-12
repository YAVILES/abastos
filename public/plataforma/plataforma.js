'use strict';
// Panel de la plataforma: abastos (empresas), licencias, pagos y uso.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fm = (n, d = 2) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
  let token = null; try { token = sessionStorage.getItem('plat_token'); } catch {}
  let empresas = [];

  async function api(m, u, b) {
    let r;
    try { r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined }); }
    catch { throw new Error('Sin conexión con el servidor'); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token && !u.includes('/login')) { token = null; try { sessionStorage.removeItem('plat_token'); } catch {} pintar(); throw new Error(j.error || 'Sesión vencida'); }
    if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
    return j;
  }
  const toast = (msg, t = '') => { const d = document.createElement('div'); d.className = 'toast ' + t; d.textContent = msg; $('#toasts').appendChild(d); setTimeout(() => d.remove(), t === 'bad' ? 6000 : 3000); };
  const falla = (er) => toast(er.message, 'bad');

  function modal(titulo, cuerpo, pie = '', onMount) {
    const v = document.createElement('div'); v.className = 'velo';
    v.innerHTML = `<div class="modal"><header><span>${e(titulo)}</span><button class="btn sm" data-x>✕</button></header><div class="cuerpo">${cuerpo}</div>${pie ? `<footer>${pie}</footer>` : ''}</div>`;
    document.body.appendChild(v);
    const cerrar = () => v.remove();
    v.querySelector('[data-x]').onclick = cerrar; v.addEventListener('mousedown', (ev) => { if (ev.target === v) cerrar(); });
    if (onMount) onMount(v, cerrar);
    return v;
  }
  const campo = (n, l, v = '', t = 'text', extra = '') => `<div><label>${e(l)}</label><input name="${n}" type="${t}" value="${e(v)}" ${extra}></div>`;
  const leer = (f) => Object.fromEntries([...new FormData(f).entries()]);

  const ETQ = { activa: ['ok', 'Activa'], gracia: ['warn', 'En gracia'], vencida: ['bad', 'Vencida'], suspendida: ['bad', 'Suspendida'] };

  function pintarLogin() {
    $('#p').innerHTML = `<div class="login"><form class="card" id="lf"><h1>Plataforma Abasto Cloud</h1><p class="muted">Acceso del operador.</p>
      <label>Usuario</label><input name="usuario" autofocus required><div style="height:10px"></div><label>Clave</label><input name="clave" type="password" required>
      <div id="le" class="bad" style="margin:10px 0"></div><button class="btn pri lg" style="width:100%">Entrar</button></form></div>`;
    $('#lf').onsubmit = async (ev) => {
      ev.preventDefault();
      try { const r = await api('POST', '/api/plataforma/login', { usuario: ev.target.usuario.value, clave: ev.target.clave.value }); token = r.token; try { sessionStorage.setItem('plat_token', token); } catch {} pintar(); }
      catch (er) { $('#le').textContent = er.message; }
    };
  }

  async function pintar() {
    if (!token) return pintarLogin();
    let res;
    try { [res, empresas] = await Promise.all([api('GET', '/api/plataforma/resumen'), api('GET', '/api/plataforma/empresas')]); } catch (er) { if (token) falla(er); return; }
    $('#p').innerHTML = `<div class="topbar"><h1 style="margin:0">Plataforma Abasto Cloud</h1><div class="chips"><button class="btn pri" data-a="nueva">+ Nuevo abasto</button><button class="btn" data-a="bitacora">Bitácora</button><button class="btn" data-a="salir">Salir</button></div></div>
      <div class="grid g4" style="margin-bottom:14px">
        <div class="kpi"><div class="l">Abastos activos</div><div class="v">${res.activas}</div><div class="s">de ${res.empresas} registrados</div></div>
        <div class="kpi"><div class="l">Ingreso mensual recurrente</div><div class="v">$ ${fm(res.mrr_usd)}</div><div class="s">suma de planes activos</div></div>
        <div class="kpi"><div class="l">Cobrado este mes</div><div class="v">$ ${fm(res.cobrado_mes_usd)}</div></div>
        <div class="kpi"><div class="l">Por atender</div><div class="v ${res.vencidas ? 'bad' : ''}">${res.vencidas}</div><div class="s">${res.por_vencer} vencen en 7 días o menos</div></div></div>
      <div class="card"><div class="scroll"><table><thead><tr><th>Abasto</th><th>Código</th><th>Plan</th><th class="n">USD/mes</th><th>Licencia</th><th>Vence</th><th class="n">Usuarios</th><th class="n">Productos</th><th class="n">Foto IA (mes)</th><th></th></tr></thead><tbody>
      ${empresas.map((x, i) => { const [cl, tx] = ETQ[x.licencia.estado] || ['', x.licencia.estado]; return `<tr><td><b>${e(x.nombre)}</b><div class="muted" style="font-size:11px">${e(x.contacto || '')} ${e(x.telefono || '')}</div></td><td><code>${e(x.slug)}</code></td><td>${e(x.plan)}</td><td class="n">${fm(x.precio_usd)}</td>
        <td><span class="tag ${cl}">${tx}</span></td><td>${e(x.licencia_vence)}<div class="muted" style="font-size:11px">${x.licencia.dias_restantes >= 0 ? 'en ' + x.licencia.dias_restantes + ' días' : 'hace ' + (-x.licencia.dias_restantes) + ' días'}</div></td>
        <td class="n">${x.usuarios ?? '—'} / ${x.max_usuarios}</td><td class="n">${x.productos ?? '—'} / ${fm(x.max_productos, 0)}</td><td class="n">${x.reconocimientos_mes} / ${fm(x.max_reconocimientos, 0)}</td>
        <td style="white-space:nowrap"><button class="btn sm pri" data-a="pago" data-i="${i}">Registrar pago</button> <button class="btn sm" data-a="editar" data-i="${i}">Editar</button> <button class="btn sm" data-a="acceso" data-i="${i}">Acceso</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">Aún no hay abastos</td></tr>'}</tbody></table></div></div>`;
    $('#p').onclick = async (ev) => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      const x = empresas[+b.dataset.i];
      try { await ({ nueva, salir, bitacora, pago: () => pago(x), editar: () => editar(x), acceso: () => acceso(x) })[b.dataset.a](); } catch (er) { falla(er); }
    };
  }

  function salir() { api('POST', '/api/plataforma/logout').catch(() => {}); token = null; try { sessionStorage.removeItem('plat_token'); } catch {} pintar(); }

  function enlaces(slug) {
    const o = location.origin;
    return `<p>Sistema del abasto: <a href="${o}/?e=${e(slug)}" target="_blank">${o}/?e=${e(slug)}</a><br>App de clientes: <a href="${o}/tienda/${e(slug)}/" target="_blank">${o}/tienda/${e(slug)}/</a></p>`;
  }
  function nueva() {
    modal('Nuevo abasto', `<form id="f" class="form">${campo('nombre', 'Nombre del abasto *', '', 'text', 'required')}${campo('slug', 'Código (para el enlace) *', '', 'text', 'required pattern="[a-z0-9][a-z0-9-]{1,30}" placeholder="abasto-sur"')}
      ${campo('contacto', 'Contacto')}${campo('telefono', 'Teléfono')}${campo('dias_prueba', 'Días de prueba', '30', 'number')}${campo('precio_usd', 'Precio USD al mes', '20', 'number', 'step="any"')}
      ${campo('max_usuarios', 'Máx. usuarios', '5', 'number')}${campo('max_productos', 'Máx. productos', '1000', 'number')}${campo('max_reconocimientos', 'Fotos con IA por mes', '200', 'number')}${campo('admin_clave', 'Clave del admin (vacío = generar)')}</form><div id="er" class="bad" style="margin-top:8px"></div>`,
      '<button class="btn pri" id="ok">Crear abasto</button>', (v, cerrar) => {
        $('#ok', v).onclick = async () => {
          const f = $('#f', v); if (!f.reportValidity()) return;
          try {
            const r = await api('POST', '/api/plataforma/empresas', leer(f)); cerrar(); pintar();
            modal('Abasto creado', `<p>Entrega estos datos al dueño. <b>La clave no se vuelve a mostrar.</b></p><div class="card"><p>Código: <code>${e(r.slug)}</code><br>Usuario: <code>admin</code><br>Clave: <code style="user-select:all">${e(r.admin_clave || '(la que indicaste)')}</code><br>Licencia de prueba hasta: ${e(r.licencia_vence)}</p></div>${enlaces(r.slug)}`);
          } catch (er) { $('#er', v).textContent = er.message; }
        };
      });
  }
  function acceso(x) {
    modal('Acceso — ' + x.nombre, `${enlaces(x.slug)}<hr style="border:0;border-top:1px solid var(--line)"><h3>Restablecer la clave del admin</h3><form id="f" class="row"><div class="grow"><input name="clave" type="text" placeholder="Nueva clave (mín. 6)" minlength="6" required></div><button class="btn">Restablecer</button></form><p class="muted">Cierra todas las sesiones de ese abasto.</p>`, '', (v, cerrar) => {
      $('#f', v).onsubmit = async (ev) => { ev.preventDefault(); try { await api('POST', `/api/plataforma/empresas/${x.id}/clave-admin`, { clave: ev.target.clave.value }); toast('Clave restablecida', 'ok'); cerrar(); } catch (er) { falla(er); } };
    });
  }
  async function pago(x) {
    const hist = await api('GET', `/api/plataforma/empresas/${x.id}/pagos`);
    modal('Registrar pago — ' + x.nombre, `<p>Licencia vigente hasta <b>${e(x.licencia_vence)}</b> (${e((ETQ[x.licencia.estado] || [0, x.licencia.estado])[1])}). El pago se suma desde esa fecha, o desde hoy si ya venció.</p>
      <form id="f" class="form">${campo('meses', 'Meses pagados', '1', 'number', 'min="1" max="36" required')}${campo('monto_usd', 'Monto USD', Number(x.precio_usd).toFixed(2), 'number', 'step="any" min="0" required')}
      <div><label>Método</label><select name="metodo"><option>Pago móvil</option><option>Transferencia</option><option>Efectivo USD</option><option>Zelle</option><option>Otro</option></select></div>${campo('referencia', 'Referencia')}</form>
      ${hist.length ? `<h3 style="margin-top:14px">Pagos anteriores</h3>${hist.slice(0, 6).map((p) => `<div class="muted" style="font-size:12px">${e(p.fecha.slice(0, 10))} · $ ${fm(p.monto_usd)} · ${p.meses} mes(es) → hasta ${e(p.vence_nuevo)} · ${e(p.metodo || '')} ${e(p.referencia || '')}</div>`).join('')}` : ''}
      <div id="er" class="bad" style="margin-top:8px"></div>`, '<button class="btn pri" id="ok">Registrar pago y renovar</button>', (v, cerrar) => {
      $('#ok', v).onclick = async () => { const f = $('#f', v); if (!f.reportValidity()) return;
        try { const r = await api('POST', `/api/plataforma/empresas/${x.id}/pago`, leer(f)); toast('Licencia renovada hasta ' + r.licencia_vence, 'ok'); cerrar(); pintar(); } catch (er) { $('#er', v).textContent = er.message; } };
    });
  }
  function editar(x) {
    modal('Editar — ' + x.nombre, `<form id="f" class="form">${campo('nombre', 'Nombre', x.nombre)}${campo('plan', 'Plan', x.plan)}${campo('precio_usd', 'Precio USD al mes', x.precio_usd, 'number', 'step="any"')}
      <div><label>Estado</label><select name="estado"><option value="activa" ${x.estado === 'activa' ? 'selected' : ''}>Activa</option><option value="suspendida" ${x.estado === 'suspendida' ? 'selected' : ''}>Suspendida (bloquea el acceso)</option></select></div>
      ${campo('max_usuarios', 'Máx. usuarios', x.max_usuarios, 'number')}${campo('max_productos', 'Máx. productos', x.max_productos, 'number')}${campo('max_reconocimientos', 'Fotos con IA por mes', x.max_reconocimientos, 'number')}
      ${campo('contacto', 'Contacto', x.contacto || '')}${campo('telefono', 'Teléfono', x.telefono || '')}<div class="full"><label>Notas</label><textarea name="notas" rows="2">${e(x.notas || '')}</textarea></div></form><div id="er" class="bad" style="margin-top:8px"></div>`,
      '<button class="btn pri" id="ok">Guardar</button>', (v, cerrar) => {
        $('#ok', v).onclick = async () => { try { await api('PUT', '/api/plataforma/empresas/' + x.id, leer($('#f', v))); toast('Guardado', 'ok'); cerrar(); pintar(); } catch (er) { $('#er', v).textContent = er.message; } };
      });
  }
  async function bitacora() {
    const r = await api('GET', '/api/plataforma/bitacora');
    modal('Bitácora de la plataforma', r.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Operador</th><th>Acción</th><th>Empresa</th><th>Detalle</th></tr></thead><tbody>${r.map((x) => `<tr><td>${e(x.fecha.slice(0, 16))}</td><td>${e(x.operador || '')}</td><td>${e(x.accion)}</td><td>${e(x.empresa || '')}</td><td class="muted" style="font-size:11px">${e((x.detalle || '').slice(0, 120))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Sin eventos</div>');
    document.querySelector('.modal').classList.add('ancho');
  }

  pintar();
})();
