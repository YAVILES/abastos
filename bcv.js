'use strict';
// Tasa oficial del BCV: se lee de la portada de https://www.bcv.org.ve/ (bloques #dolar y #euro)
// y se registra sola en cada empresa que tenga activada la actualización automática.
//
// Reglas para no pisar el trabajo de las personas:
//  - La tasa de una fecha escrita a mano nunca se reemplaza sola; solo se reemplazan las que puso este módulo.
//  - Un día operativo abierto solo cambia de tasa si se vendía con la que puso este módulo.
//  - Se descarta una lectura que se aleje demasiado de la última tasa conocida (página alterada o cambio de formato).
const https = require('node:https');
const D = require('./db');
const L = require('./lib');
const P = require('./plataforma');

const URL_BCV = 'https://www.bcv.org.ve/';
const FUENTE_AUTO = 'BCV (automática)';
const FUENTE_BOTON = 'BCV (consulta manual)';
const VIGENCIA_MS = 15 * 60 * 1000;      // no se vuelve a consultar al BCV antes de este tiempo
const SALTO_MAX = 0.30;                  // variación máxima aceptada frente a la última tasa reciente

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

let cache = null;           // { en: ms, datos: { usd, eur, fechaValor } }
let ultimoError = null;
let ultimaConsulta = null;  // ISO de la última lectura exitosa

// El certificado del BCV suele llegar con la cadena incompleta, por eso solo en esta petición
// (un host fijo, solo lectura de un dato público) se desactiva la verificación de la cadena.
// La defensa frente a una respuesta alterada es la validación de coherencia de más abajo.
function descargar(url = URL_BCV, redirecciones = 0) {
  return new Promise((resolve, reject) => {
    if (redirecciones > 3) return reject(new Error('Demasiadas redirecciones'));
    const req = https.get(url, { rejectUnauthorized: false, timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AbastoCloud/1.0)', 'Accept-Language': 'es' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const destino = new URL(res.headers.location, url);
        if (destino.hostname !== new URL(URL_BCV).hostname) return reject(new Error('El BCV redirigió a otro sitio'));
        return resolve(descargar(destino.href, redirecciones + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`El BCV respondió HTTP ${res.statusCode}`)); }
      let html = ''; res.setEncoding('utf8');
      res.on('data', (c) => { html += c; if (html.length > 3_000_000) req.destroy(new Error('Respuesta demasiado grande')); });
      res.on('end', () => resolve(html));
    });
    req.on('timeout', () => req.destroy(new Error('Se agotó el tiempo esperando al BCV')));
    req.on('error', reject);
  });
}

function numeroDe(html, id) {
  const m = html.match(new RegExp(`id="${id}"[\\s\\S]{0,900}?<strong[^>]*>\\s*([\\d.,]+)\\s*</strong>`, 'i'));
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Fecha valor: la que publica el BCV como vigencia de la tasa (normalmente el próximo día hábil).
function fechaValorDe(html) {
  const a = html.match(/class="date-display-single"[^>]*content="(\d{4}-\d{2}-\d{2})/i);
  if (a) return a[1];
  const b = html.match(/class="date-display-single"[^>]*>([^<]+)</i);
  const t = b && b[1].match(/(\d{1,2})\s+(?:de\s+)?([A-Za-zñÑ]+)\s+(?:de\s+)?(\d{4})/);
  const mes = t && MESES[t[2].toLowerCase()];
  return mes ? `${t[3]}-${String(mes).padStart(2, '0')}-${String(t[1]).padStart(2, '0')}` : null;
}

function leerPagina(html) {
  const usd = numeroDe(html, 'dolar'), eur = numeroDe(html, 'euro');
  if (!usd || !eur) throw new Error('No se pudieron leer las tasas en la página del BCV (¿cambió su formato?)');
  if (usd < 0.01 || usd > 100000 || eur < 0.01 || eur > 100000) throw new Error('El BCV publicó valores fuera de rango');
  const coherencia = eur / usd;
  if (coherencia < 0.3 || coherencia > 3) throw new Error('Las tasas leídas del BCV no son coherentes entre sí');
  return { usd, eur, fechaValor: fechaValorDe(html) };
}

async function consultar({ forzar = false } = {}) {
  if (!forzar && cache && Date.now() - cache.en < VIGENCIA_MS) return cache.datos;
  try {
    const datos = leerPagina(await descargar());
    cache = { en: Date.now(), datos };
    ultimoError = null; ultimaConsulta = new Date().toISOString();
    return datos;
  } catch (e) {
    ultimoError = e.message;
    throw e;
  }
}

const cerca = (a, b) => Math.abs(a - b) < 1e-6;
const esAuto = (f) => f === FUENTE_AUTO || f === FUENTE_BOTON;

// Registra la lectura en la empresa activa (se llama dentro de D.conEmpresa). Devuelve qué hizo.
//   tasa = { usd, eur (Bs por 1 EUR), fechaValor }   opts = { forzar, usuario }
function aplicar(tasa, { forzar = false, usuario = 'sistema' } = {}) {
  const hoy = D.hoy();
  const fv = tasa.fechaValor && /^\d{4}-\d{2}-\d{2}$/.test(tasa.fechaValor) ? tasa.fechaValor : hoy;
  const fecha = fv > hoy ? fv : hoy;          // una tasa futura va a su fecha; una vigente se registra para hoy
  if (fecha > D.sumarDias(7)) return { aplicada: false, motivo: 'La fecha valor del BCV es demasiado lejana' };
  const ves = tasa.usd, eurUsd = Math.round((tasa.eur / tasa.usd) * 1e6) / 1e6;
  const fuente = forzar ? FUENTE_BOTON : FUENTE_AUTO;

  const previa = D.get('SELECT * FROM tasas_cambio WHERE fecha<? ORDER BY fecha DESC LIMIT 1', fecha);
  if (previa && D.sumarDias(10, previa.fecha) >= fecha && Math.abs(ves / previa.tasa_usd_ves - 1) > SALTO_MAX)
    return { aplicada: false, motivo: `Se descartó la lectura del BCV (Bs ${ves}): se aleja más de ${Math.round(SALTO_MAX * 100)}% de la tasa del ${previa.fecha}` };

  const existente = D.get('SELECT * FROM tasas_cambio WHERE fecha=?', fecha);
  if (existente && !forzar && !esAuto(existente.fuente)) return { aplicada: false, fecha, motivo: 'La tasa de esa fecha fue escrita a mano y se respeta' };
  if (existente && cerca(existente.tasa_usd_ves, ves) && cerca(existente.tasa_eur_usd, eurUsd)) return { aplicada: false, fecha, sinCambio: true, motivo: 'Ya estaba registrada igual' };

  D.tx(() => {
    if (existente) D.run('UPDATE tasas_cambio SET tasa_usd_ves=?, tasa_eur_usd=?, fuente=?, usuario=?, actualizada_en=? WHERE fecha=?', ves, eurUsd, fuente, usuario, D.ahora(), fecha);
    else D.run('INSERT INTO tasas_cambio(fecha,tasa_usd_ves,tasa_eur_usd,fuente,usuario,registrada_en) VALUES(?,?,?,?,?,?)', fecha, ves, eurUsd, fuente, usuario, D.ahora());
    const j = L.jornadaAbierta();
    // Al día abierto solo se le cambia la tasa si se vendía con la automática anterior (o si la persona lo pidió con el botón).
    const toca = !!(j && j.fecha === fecha && (forzar || (existente && esAuto(existente.fuente) && cerca(j.tasa_usd_ves, existente.tasa_usd_ves))));
    if (toca) D.run('UPDATE jornadas SET tasa_usd_ves=?, tasa_eur_usd=?, fuente=? WHERE id=?', ves, eurUsd, fuente, j.id);
    D.insert('INSERT INTO tasas_log(jornada_id,fecha,usuario,tasa_usd_ves,tasa_eur_usd,fuente,motivo) VALUES(?,?,?,?,?,?,?)',
      toca ? j.id : null, D.ahora(), usuario, ves, eurUsd, fuente, `[${fecha}] ${forzar ? 'Consulta manual al BCV' : 'Actualización automática desde el BCV'}`);
    L.audit(usuario, 'tasa_bcv', 'tasa', fecha, { antes: existente ? [existente.tasa_usd_ves, existente.tasa_eur_usd] : null, despues: [ves, eurUsd], fecha_valor: tasa.fechaValor || null });
  });
  return { aplicada: true, fecha, usd: ves, eur_ves: tasa.eur, actualizada: !!existente };
}

// Recorre las empresas con la opción activa. Nunca lanza: un error de red o de una empresa no detiene el servidor.
async function ciclo(motivo = 'programado') {
  let datos;
  try { datos = await consultar(); } catch (e) { console.error(`[BCV] No se pudo consultar (${motivo}): ${e.message}`); return { error: e.message }; }
  const resultado = {};
  for (const slug of P.listaSlugs()) {
    try {
      if (['inexistente', 'suspendida'].includes(P.licencia(slug).estado)) continue;
      resultado[slug] = D.conEmpresa(slug, () => (D.param('tasas').auto_bcv ? aplicar(datos) : { aplicada: false, motivo: 'Desactivada' }));
      const r = resultado[slug];
      if (r.aplicada) console.log(`[BCV] ${slug}: tasa del ${r.fecha} = Bs ${r.usd} por $ (${motivo})`);
      else if (!r.sinCambio && r.motivo && r.motivo !== 'Desactivada') console.log(`[BCV] ${slug}: ${r.motivo}`);
    } catch (e) { resultado[slug] = { aplicada: false, motivo: e.message }; console.error(`[BCV] ${slug}:`, e.message); }
  }
  return resultado;
}

function estado() {
  return { ultima_consulta: ultimaConsulta, error: ultimoError, bcv: cache ? { ...cache.datos } : null };
}

function iniciar() {
  setTimeout(() => ciclo('arranque'), 5000).unref();
  setInterval(() => ciclo('programado'), 30 * 60 * 1000).unref();
}

module.exports = { leerPagina, fechaValorDe, consultar, aplicar, ciclo, estado, iniciar, FUENTE_AUTO, FUENTE_BOTON };
