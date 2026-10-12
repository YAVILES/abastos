'use strict';
// Respaldo diario automático: una copia consistente (VACUUM INTO) por empresa y de la base de la plataforma.
const path = require('node:path');
const fs = require('node:fs');
const D = require('./db');
const P = require('./plataforma');

const RAIZ = () => process.env.RESPALDOS_DIR || path.join(D.DATA_DIR, 'respaldos');
const CONSERVAR = () => Math.max(1, Number(process.env.RESPALDOS_CONSERVAR) || 14);
const q = (ruta) => `'${ruta.replace(/'/g, "''")}'`;

function podar(dir) {
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  for (const f of archivos.slice(0, Math.max(0, archivos.length - CONSERVAR()))) fs.unlinkSync(path.join(dir, f));
}
function respaldarTodo() {
  const hoy = D.hoy();
  let hechos = 0;
  const destinos = P.listaSlugs().map((slug) => ({ slug, dir: path.join(RAIZ(), slug) })).concat([{ slug: null, dir: path.join(RAIZ(), '_plataforma') }]);
  for (const { slug, dir } of destinos) {
    const destino = path.join(dir, hoy + '.db');
    if (fs.existsSync(destino)) continue;
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (slug) D.conEmpresa(slug, () => D.run(`VACUUM INTO ${q(destino)}`));
      else P.pdb.exec(`VACUUM INTO ${q(destino)}`);
      podar(dir); hechos++;
    } catch (e) { console.error('Respaldo falló para', slug || 'plataforma', e.message); try { fs.unlinkSync(destino); } catch {} }
  }
  return hechos;
}
module.exports = { respaldarTodo, RAIZ };
