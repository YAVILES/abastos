'use strict';
// Reconocimiento de productos por imagen con la API de Claude (visión).
// Envía la foto y el catálogo de la empresa; devuelve hasta 3 candidatos que el cajero confirma.
// Requiere ANTHROPIC_API_KEY. El modelo se puede cambiar con RECONOCER_MODELO.
const Anthropic = require('@anthropic-ai/sdk');

const MODELO = () => process.env.RECONOCER_MODELO || 'claude-opus-5-5';
const MAX_CATALOGO = 600;
const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

class ErrorReconocer extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const SISTEMA = `Eres el asistente de caja de un abasto. Te llega la foto de un producto que el cajero no puede escanear.
Debes decir cuál de los productos del catálogo es, usando lo que se vea: marca, tipo de producto, tamaño o presentación, colores del empaque y texto visible.
Reglas:
- Responde SOLO con un objeto JSON, sin texto antes ni después ni bloques de código.
- Formato: {"descripcion": "qué se ve en la foto, en una frase", "candidatos": [{"id": <número del catálogo>, "confianza": <0 a 1>}]}
- Máximo 3 candidatos, del más probable al menos probable. Usa únicamente ids que existan en el catálogo.
- Distingue presentaciones: un refresco de 2 L no es uno de 355 ml aunque sea la misma marca.
- Si la foto no muestra un producto, o ninguno del catálogo encaja con seguridad, devuelve "candidatos": [].`;

let cliente = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
    throw new ErrorReconocer(501, 'El reconocimiento por imagen no está configurado en este servidor (falta ANTHROPIC_API_KEY).');
  if (!cliente) cliente = new Anthropic({ maxRetries: 1, timeout: 40000 });
  return cliente;
}
const reiniciarCliente = () => { cliente = null; };

function analizarImagen(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || !TIPOS.has(m[1])) throw new ErrorReconocer(400, 'La imagen debe ser JPEG, PNG o WebP.');
  if (m[2].length > 2_400_000) throw new ErrorReconocer(413, 'La imagen es demasiado grande.');
  return { media_type: m[1], data: m[2] };
}

function extraerJSON(texto) {
  const i = texto.indexOf('{'), j = texto.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(texto.slice(i, j + 1)); } catch { return null; }
}

// productos: [{id, nombre, marca, presentacion}]
async function reconocer(imagen, productos) {
  const img = analizarImagen(imagen);
  if (!productos.length) throw new ErrorReconocer(409, 'No hay productos activos en el catálogo.');
  const ids = new Set(productos.map((p) => p.id));
  const catalogo = productos.slice(0, MAX_CATALOGO)
    .map((p) => `${p.id}: ${p.nombre}${p.marca ? ' (' + p.marca + ')' : ''}${p.presentacion ? ' ' + p.presentacion : ''}`).join('\n');
  const c = obtenerCliente();
  let resp;
  try {
    resp = await c.messages.create({
      model: MODELO(),
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: SISTEMA },
        { type: 'text', text: 'CATÁLOGO (id: nombre):\n' + catalogo, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } },
        { type: 'text', text: 'Identifica el producto de la foto.' }
      ] }]
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) { console.error('Reconocimiento: credencial inválida'); throw new ErrorReconocer(502, 'El servicio de reconocimiento rechazó la credencial del servidor.'); }
    if (e instanceof Anthropic.RateLimitError) throw new ErrorReconocer(503, 'El servicio de reconocimiento está saturado. Intenta de nuevo en unos segundos.');
    if (e instanceof Anthropic.APIError) { console.error('Reconocimiento: error de API', e.status, e.message); throw new ErrorReconocer(502, 'El servicio de reconocimiento no respondió bien. Busca el producto por nombre.'); }
    console.error('Reconocimiento:', e.message);
    throw new ErrorReconocer(502, 'No se pudo contactar el servicio de reconocimiento.');
  }
  if (resp.stop_reason === 'refusal') return { descripcion: '', candidatos: [], mensaje: 'El servicio no pudo analizar esta foto.' };
  const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const j = extraerJSON(texto);
  if (!j) throw new ErrorReconocer(502, 'No se entendió la respuesta del reconocimiento. Intenta con otra foto.');
  const vistos = new Set();
  const candidatos = (Array.isArray(j.candidatos) ? j.candidatos : [])
    .map((x) => ({ id: Number(x && x.id), confianza: Math.max(0, Math.min(1, Number(x && x.confianza) || 0)) }))
    .filter((x) => ids.has(x.id) && !vistos.has(x.id) && vistos.add(x.id))
    .slice(0, 3);
  return { descripcion: String(j.descripcion || '').slice(0, 200), candidatos, uso: { entrada: resp.usage.input_tokens, salida: resp.usage.output_tokens, cache_leido: resp.usage.cache_read_input_tokens || 0 } };
}

module.exports = { reconocer, ErrorReconocer, reiniciarCliente, MODELO };
