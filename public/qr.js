'use strict';
// Generador de códigos QR (ISO/IEC 18004), modo byte, corrección de errores nivel M, versiones 1 a 10 (hasta 213 caracteres).
// Sin dependencias ni servicios externos: el enlace nunca sale del equipo.
(() => {
  const A = Abasto;
  const ECC_POR_BLOQUE_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const BLOQUES_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function modulosDeDatos(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  const capacidadDatos = (ver) => Math.floor(modulosDeDatos(ver) / 8) - ECC_POR_BLOQUE_M[ver] * BLOQUES_M[ver];

  // ---- Reed-Solomon sobre GF(256) ----
  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
  function divisor(grado) {
    const r = new Array(grado).fill(0); r[grado - 1] = 1; let raiz = 1;
    for (let i = 0; i < grado; i++) { for (let j = 0; j < grado; j++) { r[j] = gfMul(r[j], raiz); if (j + 1 < grado) r[j] ^= r[j + 1]; } raiz = gfMul(raiz, 2); }
    return r;
  }
  function resto(datos, div) {
    const r = new Array(div.length).fill(0);
    for (const b of datos) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
    return r;
  }

  function codificar(texto) {
    const bytes = Array.from(new TextEncoder().encode(String(texto)));
    let ver = 0;
    for (let v = 1; v <= 10; v++) { const bitsLong = v < 10 ? 8 : 16; if (4 + bitsLong + bytes.length * 8 <= capacidadDatos(v) * 8) { ver = v; break; } }
    if (!ver) throw new Error('El enlace es demasiado largo para el código QR (máximo 213 caracteres)');
    const bits = [];
    const poner = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    poner(0b0100, 4); poner(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => poner(b, 8));
    const cap = capacidadDatos(ver) * 8;
    poner(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const datos = [];
    for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; datos.length < capacidadDatos(ver); pad ^= 0xEC ^ 0x11) datos.push(pad);
    return { ver, datos };
  }

  function conCorreccion(ver, datos) {
    const nb = BLOQUES_M[ver], le = ECC_POR_BLOQUE_M[ver];
    const total = Math.floor(modulosDeDatos(ver) / 8), cortos = nb - (total % nb), largoCorto = Math.floor(total / nb);
    const div = divisor(le), bloques = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = datos.slice(k, k + largoCorto - le + (i < cortos ? 0 : 1)); k += dat.length;
      const ecc = resto(dat, div);
      if (i < cortos) dat.push(0);
      bloques.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < bloques[0].length; i++) bloques.forEach((b, j) => { if (i !== largoCorto - le || j >= cortos) out.push(b[i]); });
    return out;
  }

  function penalizacion(m, n) {
    let p = 0;
    const lineas = [];
    for (let y = 0; y < n; y++) { lineas.push(m[y]); }
    for (let x = 0; x < n; x++) lineas.push(m.map((fila) => fila[x]));
    for (const l of lineas) {
      let corrida = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && l[i] === l[i - 1]) corrida++;
        else { if (corrida >= 5) p += 3 + corrida - 5; corrida = 1; }
      }
      const s = l.map((v) => (v ? '1' : '0')).join('');
      for (const pat of ['10111010000', '00001011101']) { let i = -1; while ((i = s.indexOf(pat, i + 1)) !== -1) p += 40; }
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    const negros = m.reduce((a, f) => a + f.filter(Boolean).length, 0), tot = n * n;
    p += (Math.ceil(Math.abs(negros * 20 - tot * 10) / tot) - 1) * 10;
    return p;
  }

  // Devuelve { n, m: matriz de booleanos (true = módulo oscuro), mascara }. `mascara` solo se fuerza en las pruebas.
  function matriz(texto, mascaraForzada) {
    const { ver, datos } = codificar(texto);
    const n = ver * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fn = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (x, y, v) => { m[y][x] = v; fn[y][x] = true; };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const buscador = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4); } };
    buscador(3, 3); buscador(n - 4, 3); buscador(3, n - 4);
    let alin = [];
    if (ver > 1) { const na = Math.floor(ver / 7) + 2, paso = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2; alin = [6]; for (let pos = n - 7; alin.length < na; pos -= paso) alin.splice(1, 0, pos); }
    for (let i = 0; i < alin.length; i++) for (let j = 0; j < alin.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === alin.length - 1) || (i === alin.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(alin[i] + dx, alin[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const formato = (mask) => {
      const d = (0 << 3) | mask;                                   // nivel M = 0
      let rem = d; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((d << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
      set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(bits, i));
      set(8, n - 8, true);
    };
    formato(0);
    if (ver >= 7) {
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) { const b = bit(bits, i), a = n - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
    }
    const todo = conCorreccion(ver, datos);
    for (let i = 0, derecha = n - 1; derecha >= 1; derecha -= 2) {
      if (derecha === 6) derecha = 5;
      for (let v = 0; v < n; v++) for (let j = 0; j < 2; j++) {
        const x = derecha - j, arriba = ((derecha + 1) & 2) === 0, y = arriba ? n - 1 - v : v;
        if (!fn[y][x] && i < todo.length * 8) { m[y][x] = bit(todo[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
    const aplicar = (mask) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        (x * y) % 2 + (x * y) % 3 === 0, ((x * y) % 2 + (x * y) % 3) % 2 === 0, ((x + y) % 2 + (x * y) % 3) % 2 === 0][mask];
      if (!fn[y][x] && inv) m[y][x] = !m[y][x]; } };
    let mejor = mascaraForzada, minimo = Infinity;
    if (mejor == null) for (let mask = 0; mask < 8; mask++) {
      aplicar(mask); formato(mask);
      const p = penalizacion(m, n);
      if (p < minimo) { minimo = p; mejor = mask; }
      aplicar(mask);                                                // deshace la máscara
    }
    aplicar(mejor); formato(mejor);
    return { n, m, mascara: mejor, version: ver };
  }

  // SVG con zona de silencio de 4 módulos (la que exige la norma para que lo lean los celulares)
  function svg(texto, px = 240) {
    const { n, m } = matriz(texto), t = n + 8;
    let d = '';
    for (let y = 0; y < n; y++) { let x = 0; while (x < n) { if (m[y][x]) { let w = 1; while (x + w < n && m[y][x + w]) w++; d += `M${x + 4} ${y + 4}h${w}v1h-${w}z`; x += w; } else x++; } }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  function png(texto, px = 1024) {
    const { n, m } = matriz(texto), t = n + 8, esc = Math.max(1, Math.floor(px / t));
    const c = document.createElement('canvas'); c.width = c.height = t * esc;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) g.fillRect((x + 4) * esc, (y + 4) * esc, esc, esc);
    return c.toDataURL('image/png');
  }

  // Ventana con el QR de un enlace. tipo: 'tienda' (app de clientes) o 'reparto' (app del repartidor).
  function ventana(url, tipo) {
    const { e } = A;
    const T = tipo === 'reparto'
      ? { nombre: 'App del repartidor', cartel: 'App para repartidores', pista: 'Escanea el código con la cámara, entra con tu usuario y clave y elige «Agregar a pantalla de inicio».', archivo: 'qr-reparto.png' }
      : { nombre: 'App de clientes', cartel: 'Haz tu pedido desde tu celular', pista: 'Abre la cámara de tu celular y apunta al código. Elige tus productos, paga y sigue tu pedido.', archivo: 'qr-tienda.png' };
    let local = false; try { local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(new URL(url).hostname); } catch { /* enlace inválido: lo valida el generador */ }
    let dibujo;
    try { dibujo = svg(url, 300); } catch (er) { return A.fail(er); }
    A.modal('Código QR · ' + T.nombre, `<div class="c"><div style="max-width:300px;margin:0 auto">${dibujo}</div>
        <p class="muted" style="word-break:break-all;margin:10px 0 0">${e(url)}</p>
        ${local ? '<p class="warn" style="margin:8px 0 0">Este enlace solo funciona en tu equipo o en tu red wifi. Para que lo abra cualquiera hay que publicar el sistema en internet y generar el QR desde esa dirección.</p>' : ''}</div>`,
    { pie: '<button class="btn" data-copiar>Copiar enlace</button><button class="btn" data-png>Descargar PNG</button><button class="btn pri" data-imp>Imprimir cartel</button>', onMount: (v) => {
      v.querySelector('[data-copiar]').onclick = async () => { try { await navigator.clipboard.writeText(url); A.ok('Enlace copiado'); } catch { A.toast('Selecciona el enlace y cópialo con Ctrl+C', 'bad'); } };
      v.querySelector('[data-png]').onclick = () => { const a = document.createElement('a'); a.href = png(url, 1200); a.download = T.archivo; document.body.appendChild(a); a.click(); a.remove(); };
      v.querySelector('[data-imp]').onclick = () => {
        const emp = A.S.empresa || {};
        A.imprimirHtml(`<html><head><title>${e(T.cartel)}</title><style>@page{size:letter;margin:1.5cm}body{font-family:Arial,sans-serif;text-align:center;color:#111}h1{font-size:34px;margin:10px 0}h2{font-size:22px;margin:0;font-weight:600}.qr svg{width:13cm;height:13cm}p{font-size:16px;margin:8px 30px}code{font-size:14px;word-break:break-all}</style></head><body>
          ${emp.logo ? `<img src="${emp.logo}" style="max-height:2.5cm;max-width:8cm"><br>` : ''}<h2>${e(emp.nombre || '')}</h2><h1>${e(T.cartel)}</h1><div class="qr">${svg(url, 500)}</div><p>${e(T.pista)}</p><p><code>${e(url)}</code></p></body></html>`);
      };
    } });
  }

  A.qr = { matriz, svg, png, ventana };
  if (typeof module !== 'undefined') module.exports = A.qr;
})();
