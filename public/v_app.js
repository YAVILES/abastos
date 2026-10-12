'use strict';
// App de clientes (delivery): vista previa, enlace para compartir y lista de comprobación antes de abrirla al público.
(() => {
  const A = Abasto, { e, fm, api, S } = A;
  const $ = (s, r = document) => r.querySelector(s);

  A.vistas.reparto = async (root) => {
    const [reps, red, par] = await Promise.all([api.get('/api/repartidores').catch(() => []), api.get('/api/red'), api.get('/api/parametros')]);
    const ruta = `/reparto/${red.empresa}/`, enLinea = location.origin + ruta, puerto = location.port ? ':' + location.port : '';
    const enRed = red.ips.map((ip) => `${location.protocol}//${ip}${puerto}${ruta}`);
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">App del repartidor</h1><div class="chips"><a class="btn" href="#/pedidos/entregas">Órdenes de entrega</a></div></div>
      <div class="grid" style="grid-template-columns: 380px minmax(0,1fr); align-items: start">
        <div><div class="phone"><iframe id="vp" src="${ruta}" title="Vista previa de la app del repartidor"></iframe></div>
          <div class="c" style="margin-top:10px"><a class="btn sm" href="${ruta}" target="_blank">Abrir en otra pestaña</a></div></div>
        <div>
          <div class="card"><h2>Enlace para tus repartidores</h2>
            <div class="linkbox"><code>${e(enLinea)}</code><button class="btn sm" data-a="copiar" data-v="${e(enLinea)}">Copiar</button></div>
            ${enRed.map((u) => `<div class="linkbox" style="margin-top:6px"><code>${e(u)}</code><button class="btn sm" data-a="copiar" data-v="${e(u)}">Copiar</button></div>`).join('')}
            <p class="muted" style="margin-top:10px;font-size:12px">En el celular del repartidor: abrir el enlace, entrar con su usuario y clave y elegir <b>“Agregar a pantalla de inicio”</b>. Con el enlace de la red del local debe estar en el mismo wifi.</p></div>
          <div class="card"><h2>Repartidores</h2>${reps.length ? A.tabla([{ h: 'Nombre', f: (r) => e(r.nombre) }, { h: 'Usuario', f: (r) => e(r.usuario || '') }, { h: 'Teléfono', f: (r) => e(r.telefono || '—') },
              { h: '', f: (r) => r.telefono ? `<a class="btn sm" target="_blank" rel="noopener" href="${e(A.wa(r.telefono, `Hola ${r.nombre}, esta es la app para tus entregas de ${par.empresa.nombre}: ${enLinea} . Entra con tu usuario y clave.`))}">Enviarle el enlace por WhatsApp</a>` : '<span class="muted">Sin teléfono</span>' }], reps)
            : '<p class="muted">Aún no hay repartidores. Créalos en <a href="#/parametros/usuarios">Parámetros › Usuarios</a> con el rol Repartidor.</p>'}</div>
          <div class="card"><h2>Cómo funciona</h2><ol style="margin:0;padding-left:20px;line-height:1.7"><li>Un pedido con envío queda <b>listo</b> y a los repartidores les aparece en su app.</li><li>El repartidor lo toma, marca <b>en camino</b> y luego <b>entregado</b>.</li><li>También puedes asignarlo a uno concreto desde <a href="#/pedidos">Pedidos</a> y avisarle por WhatsApp.</li></ol></div>
        </div></div>`;
    A.acciones(root, { copiar: async (el) => { try { await navigator.clipboard.writeText(el.dataset.v); A.ok('Enlace copiado'); } catch { A.toast('Selecciona el enlace y cópialo con Ctrl+C', 'bad'); } } });
  };

  A.vistas.app = async (root) => {
    const reps = await api.get('/api/repartidores').catch(() => []);
    const [red, medios, pedidos, prods, par] = await Promise.all([api.get('/api/red'), api.get('/api/medios-app'), api.get('/api/pedidos'), api.get('/api/productos?activo=1'), api.get('/api/parametros')]);
    const ruta = `/tienda/${red.empresa}/`;
    const publico = !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    const enLinea = location.origin + ruta;
    const puerto = location.port ? ':' + location.port : '';
    const enRed = red.ips.map((ip) => `${location.protocol}//${ip}${puerto}${ruta}`);
    const publicados = medios.filter((m) => m.estado === 'publicado');
    const vendibles = prods.filter((p) => p.precio_usd > 0 && p.disponible > 0);
    const porValidar = pedidos.filter((p) => p.estado === 'pago_reportado').length;
    const abiertos = pedidos.filter((p) => ['pendiente', 'pago_reportado', 'pagado'].includes(p.estado)).length;
    const lic = S.licencia || {};
    const checks = [
      [publicados.length ? 'ok' : 'mal', publicados.length ? `${publicados.length} forma(s) de pago publicada(s) para la app` : 'No hay formas de pago publicadas: el cliente no podrá reportar su pago.', '#/parametros/medios', 'Configurar pagos'],
      [vendibles.length ? 'ok' : 'mal', vendibles.length ? `${vendibles.length} producto(s) con precio y existencia aparecen en el catálogo` : 'No hay productos con precio y existencia: el catálogo se verá vacío.', '#/productos', 'Ver productos'],
      [S.jornada ? 'ok' : 'ojo', S.jornada ? 'Día operativo abierto: ya puedes validar pagos y despachar.' : 'El día está cerrado. Los clientes pueden pedir, pero para validar pagos hay que abrir el día y tu caja.', '#/inicio', 'Abrir el día'],
      [par.empresa.telefono ? 'ok' : 'ojo', par.empresa.telefono ? 'Teléfono del negocio visible para el cliente.' : 'Falta el teléfono del negocio (el cliente lo ve si la app está cerrada).', '#/parametros/negocio', 'Completar datos'],
      [['activa', 'gracia'].includes(lic.estado) ? 'ok' : 'mal', ['activa', 'gracia'].includes(lic.estado) ? 'Licencia vigente.' : 'La licencia no está vigente: la app se muestra cerrada a los clientes.', null, null],
      [reps.length ? 'ok' : 'ojo', reps.length ? `${reps.length} repartidor(es) con usuario: ${reps.map((x) => x.nombre).join(', ')}.` : 'No hay repartidores creados: los pedidos con envío no tendrán quién los lleve.', '#/parametros/usuarios', reps.length ? 'Ver usuarios' : 'Crear repartidor'],
      [porValidar ? 'ojo' : 'ok', porValidar ? `${porValidar} pago(s) reportado(s) esperando validación.` : 'No hay pagos pendientes de validar.', porValidar ? '#/pedidos/validar' : null, 'Validar ahora']
    ];
    root.innerHTML = `<div class="topbar"><h1 style="margin:0">App de clientes (delivery)</h1><div class="chips"><a class="btn" href="#/pedidos">Pedidos de la app (${abiertos})</a><a class="btn" href="#/pedidos/entregas">Órdenes de entrega</a></div></div>
      <div class="grid" style="grid-template-columns: 380px minmax(0,1fr); align-items: start">
        <div><div class="phone"><iframe id="vp" src="${ruta}" title="Vista previa de la app del cliente"></iframe></div>
          <div class="c" style="margin-top:10px"><button class="btn sm" data-a="recargar">Recargar vista previa</button> <a class="btn sm" href="${ruta}" target="_blank">Abrir en otra pestaña</a></div>
          <p class="muted c" style="font-size:12px">Así la ve tu cliente. Puedes crear una cuenta de prueba y hacer un pedido para verlo llegar a <a href="#/pedidos">Pedidos</a>.</p></div>
        <div>
          <div class="card"><h2>Enlace para tus clientes</h2>
            <div class="linkbox"><code>${e(enLinea)}</code><button class="btn sm" data-a="copiar" data-v="${e(enLinea)}">Copiar</button></div>
            ${enRed.length ? `<p class="muted" style="margin:10px 0 4px">Dentro de la red del local (clientes conectados al mismo wifi):</p>${enRed.map((u) => `<div class="linkbox" style="margin-bottom:6px"><code>${e(u)}</code><button class="btn sm" data-a="copiar" data-v="${e(u)}">Copiar</button></div>`).join('')}` : ''}
            ${publico ? `<p style="margin-top:10px"><a class="btn pri" target="_blank" href="https://wa.me/?text=${encodeURIComponent(`Haz tu pedido en ${par.empresa.nombre}: ${enLinea}`)}">Compartir por WhatsApp</a></p>`
              : '<p class="muted" style="margin-top:10px;font-size:12px">Este enlace solo funciona en tu equipo o en tu red. Para que lo abra cualquiera desde su casa hay que publicar el sistema en internet (ver <b>DESPLIEGUE.md</b>).</p>'}
            <p class="muted" style="margin-top:10px;font-size:12px">En el celular, el cliente abre el enlace y elige <b>“Agregar a pantalla de inicio”</b>: queda como una app.</p></div>
          <div class="card"><h2>App del repartidor</h2>
            <p class="muted" style="margin:0 0 10px">Crea los repartidores en <a href="#/parametros/usuarios">Parámetros › Usuarios</a> (rol Repartidor). Cuando un pedido con envío queda <b>listo</b>, a cada repartidor le suena un aviso en su teléfono; uno lo toma, marca <b>en camino</b> y luego <b>entregado</b>. Tú y el cliente ven cada paso.</p>
            <div class="linkbox"><code>${e(location.origin + '/reparto/' + red.empresa + '/')}</code><button class="btn sm" data-a="copiar" data-v="${e(location.origin + '/reparto/' + red.empresa + '/')}">Copiar</button></div>
            ${red.ips.map((ip) => { const u = `${location.protocol}//${ip}${puerto}/reparto/${red.empresa}/`; return `<div class="linkbox" style="margin-top:6px"><code>${e(u)}</code><button class="btn sm" data-a="copiar" data-v="${e(u)}">Copiar</button></div>`; }).join('')}
          </div>
          <div class="card"><h2>¿Está lista para abrirla?</h2>${checks.map(([t, msg, href, acc]) => `<div class="check ${t}"><span class="pt"></span><div style="flex:1">${e(msg)}</div>${href ? `<a class="btn sm" href="${href}">${e(acc)}</a>` : ''}</div>`).join('')}</div>
          <div class="card"><h2>Cómo funciona para el cliente</h2><ol style="margin:0;padding-left:20px;line-height:1.7">
            <li>Crea su cuenta con teléfono y PIN y ve el catálogo con la <b>existencia real</b>.</li>
            <li>Arma el carrito y elige <b>retiro en tienda</b> o <b>envío</b> (contacto, zona, dirección y referencia).</li>
            <li>Al confirmar, la mercancía queda <b>reservada ${e(par.operacion.reserva_minutos)} minutos</b>.</li>
            <li>Ve los datos de pago publicados, paga y <b>reporta el pago</b> con banco, referencia y foto del comprobante.</li>
            <li>Tú validas en <a href="#/pedidos/validar">Pedidos › Por validar</a>: se crea la venta, se descuenta el inventario y nace la <b>orden de entrega</b>.</li>
            <li>El cliente sigue el <b>semáforo de su despacho</b>: pago en validación, preparación, listo o en camino, entregado.</li></ol></div>
        </div></div>`;
    A.acciones(root, {
      recargar: () => { $('#vp', root).src = ruta; },
      copiar: async (el) => { try { await navigator.clipboard.writeText(el.dataset.v); A.ok('Enlace copiado'); } catch { A.toast('Selecciona el enlace y cópialo con Ctrl+C', 'bad'); } }
    });
  };
})();
