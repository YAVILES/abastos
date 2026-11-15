'use strict';
// Lectura y escritura mínima de archivos .xlsx sin dependencias externas (un .xlsx es un zip de archivos XML).
// Lee: hojas con textos (compartidos o en línea), números y booleanos. Escribe: hojas con estilos, anchos, panel congelado,
// filtro, celdas combinadas y listas desplegables. Suficiente para plantillas de carga y para leerlas de vuelta.
const zlib = require('node:zlib');

// ====================================================== zip ======================================================
function crearZip(archivos) {
  const locales = [], central = []; let offset = 0;
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, 'utf8'), datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(a.datos, 'utf8');
    const comp = zlib.deflateRawSync(datos), crc = zlib.crc32(datos) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(nombre.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(nombre.length, 28);
    ch.writeUInt32LE(offset, 42);
    locales.push(lh, nombre, comp); central.push(ch, nombre);
    offset += 30 + nombre.length + comp.length;
  }
  const cd = Buffer.concat(central), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, cd, fin]);
}

const MAX_DESCOMPRIMIDO = 60 * 1024 * 1024; // contra archivos zip maliciosos
function leerZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('El archivo no es un Excel válido (.xlsx). Guárdalo desde Excel como «Libro de Excel (*.xlsx)».');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('El archivo Excel está dañado.');
    const metodo = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + nl);
    const ini = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), dat = buf.subarray(ini, ini + csize);
    out.set(nombre, () => (metodo === 0 ? dat : zlib.inflateRawSync(dat, { maxOutputLength: MAX_DESCOMPRIMIDO })));
    p += 46 + nl + el + cl;
  }
  return out;
}

// ====================================================== xml ======================================================
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const desesc = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textos = (xml) => { let t = ''; xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, x) => { t += desesc(x); return ''; }); return t; };
const colANum = (letras) => letras.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const numACol = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// ==================================================== lectura ====================================================
// Devuelve { hojas: [{ nombre, filas: [{ fila: 12, celdas: ['a', '1.5', ...] }] }] }; las celdas vacías son ''.
function leerXlsx(buf) {
  const z = leerZip(buf);
  const txt = (ruta) => (z.has(ruta) ? z.get(ruta)().toString('utf8') : null);
  const wb = txt('xl/workbook.xml'); if (!wb) throw new Error('El archivo no parece un libro de Excel (.xlsx).');
  const rels = txt('xl/_rels/workbook.xml.rels') || '';
  const destino = {}; rels.replace(/<Relationship\b([^>]*?)\/?>/g, (_, a) => { const id = (a.match(/\bId="([^"]*)"/) || [])[1], t = (a.match(/\bTarget="([^"]*)"/) || [])[1]; if (id && t) destino[id] = t; return ''; });
  const compartidas = []; const ss = txt('xl/sharedStrings.xml');
  if (ss) ss.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (_, x) => { compartidas.push(textos(x)); return ''; });
  const hojas = [];
  wb.replace(/<sheet\b([^>]*?)\/?>/g, (_, a) => {
    const nombre = desesc((a.match(/\bname="([^"]*)"/) || [])[1] || ''), rid = (a.match(/\br:id="([^"]*)"/) || [])[1];
    let t = destino[rid] || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const xml = txt(t); if (xml == null) return '';
    const filas = [];
    xml.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (_f, fa, cuerpo) => {
      if (!cuerpo) return '';
      let nFila = +((fa.match(/\br="(\d+)"/) || [])[1] || filas.length + 1); const celdas = []; let max = -1;
      cuerpo.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (_c, ca, cc) => {
        const ref = (ca.match(/\br="([A-Z]+)(\d+)"/) || []); if (!ref[1]) return '';
        const col = colANum(ref[1]); nFila = +ref[2]; const tipo = (ca.match(/\bt="([^"]*)"/) || [])[1] || 'n';
        let val = '';
        if (cc) {
          const v = (cc.match(/<v\b[^>]*>([\s\S]*?)<\/v>/) || [])[1];
          if (tipo === 's') val = compartidas[+v] ?? '';
          else if (tipo === 'inlineStr') val = textos(cc);
          else if (tipo === 'str') val = desesc(v || '');
          else if (tipo === 'b') val = v === '1' ? 'sí' : 'no';
          else if (tipo === 'e') val = '';
          else if (v != null && v !== '') { const n = Number(v); val = Number.isFinite(n) ? String(n) : desesc(v); }
        }
        celdas[col] = val; if (col > max) max = col; return '';
      });
      for (let i = 0; i <= max; i++) if (celdas[i] === undefined) celdas[i] = '';
      if (max >= 0) filas.push({ fila: nFila, celdas });
      return '';
    });
    hojas.push({ nombre, filas }); return '';
  });
  return { hojas };
}

// =================================================== escritura ===================================================
// Estilos fijos (índice → uso); las plantillas los eligen por nombre.
const ESTILO = { normal: 0, cabecera: 1, requerido: 2, texto: 3, decimal: 4, entero: 5, ejTexto: 6, ejDecimal: 7, titulo: 8, nota: 9, negrita: 10, seccion: 11, celdaTxt: 12, crema: 13, celda: 14 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="18"/><color rgb="FF12284A"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="11"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF12284A"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF374151"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF12284A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF5B301"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FB"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0A7A5A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3CF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD5D9E0"/></left><right style="thin"><color rgb="FFD5D9E0"/></right><top style="thin"><color rgb="FFD5D9E0"/></top><bottom style="thin"><color rgb="FFD5D9E0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="49" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="2" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="6" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// celda: texto, número, o { v, e: 'estilo' }. null/'' = vacía (si lleva estilo, se dibuja).
function xmlHoja(h) {
  const filas = h.filas || [], anchos = h.anchos || [];
  const cols = anchos.length ? `<cols>${anchos.map((a, i) => { const w = typeof a === 'object' ? a.w : a, st = typeof a === 'object' && a.e ? ` style="${ESTILO[a.e]}"` : ''; return `<col min="${i + 1}" max="${i + 1}" width="${w}"${st} customWidth="1"/>`; }).join('')}</cols>` : '';
  const data = filas.map((fila, r) => {
    const celdas = Array.isArray(fila) ? fila : fila.celdas, alto = !Array.isArray(fila) && fila.alto ? ` ht="${fila.alto}" customHeight="1"` : '';
    const xs = celdas.map((c, i) => {
      if (c == null) return '';
      const o = typeof c === 'object' ? c : { v: c }; const st = o.e ? ` s="${ESTILO[o.e]}"` : '';
      const ref = numACol(i) + (r + 1);
      if (o.v === '' || o.v == null) return o.e ? `<c r="${ref}"${st}/>` : '';
      if (typeof o.v === 'number') return `<c r="${ref}"${st}><v>${o.v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
    }).join('');
    return xs || alto ? `<row r="${r + 1}"${alto}>${xs}</row>` : '';
  }).join('');
  const congelar = h.congelar ? `<pane ySplit="${h.congelar}" topLeftCell="A${h.congelar + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>` : '';
  const vistas = `<sheetViews><sheetView workbookViewId="0"${h.sinCuadricula ? ' showGridLines="0"' : ''}${h.activa ? ' tabSelected="1"' : ''}>${congelar}</sheetView></sheetViews>`;
  const filtro = h.autofiltro ? `<autoFilter ref="${h.autofiltro}"/>` : '';
  const comb = (h.combinadas || []).length ? `<mergeCells count="${h.combinadas.length}">${h.combinadas.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const vals = (h.validaciones || []).map((v) => {
    const f = v.lista ? `<formula1>${esc(v.lista)}</formula1>` : `<formula1>${esc(v.minimo ?? 0)}</formula1>`;
    const tipo = v.lista ? 'list' : 'decimal', op = v.lista ? '' : ' operator="greaterThanOrEqual"';
    const estilo = v.aviso ? ' errorStyle="warning"' : '';
    return `<dataValidation type="${tipo}"${op}${estilo} allowBlank="1" showInputMessage="${v.mensaje ? 1 : 0}" showErrorMessage="1" errorTitle="${esc(v.titulo || 'Dato')}" error="${esc(v.error || 'Valor no válido')}"${v.mensaje ? ` promptTitle="${esc(v.titulo || 'Ayuda')}" prompt="${esc(v.mensaje)}"` : ''} sqref="${v.rango}">${f}</dataValidation>`;
  }).join('');
  const dv = vals ? `<dataValidations count="${(h.validaciones || []).length}">${vals}</dataValidations>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${vistas}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${filtro}${comb}${dv}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>`;
}

function crearXlsx({ hojas }) {
  const n = hojas.length;
  const archivos = [
    { nombre: '[Content_Types].xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { nombre: '_rels/.rels', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { nombre: 'xl/workbook.xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${Math.max(0, hojas.findIndex((h) => h.activa))}"/></bookViews><sheets>${hojas.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: 'xl/styles.xml', datos: STYLES },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: xmlHoja(h) }))
  ];
  return crearZip(archivos);
}

module.exports = { leerXlsx, crearXlsx, ESTILO, numACol };
