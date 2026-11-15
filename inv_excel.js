'use strict';
// Plantilla de Excel para cargar el inventario inicial y lectura del archivo ya llenado.
const { crearXlsx, leerXlsx } = require('./xlsx');

const UNIDADES = ['unidad', 'caja', 'paquete', 'docena', 'bolsa', 'saco', 'botella', 'lata', 'frasco', 'kg', 'gramo', 'litro', 'metro', 'par', 'juego', 'rollo'];
const FILAS_PLANTILLA = 2000; // filas con lista desplegable y formato

// k = clave que entiende el importador; h = encabezado visible; e = estilo de la columna; lista = 'cat' | 'prov' | 'uni' | 'sn'
const COLUMNAS = [
  { k: 'nombre', h: 'Nombre del producto *', ancho: 40, req: 1, e: 'texto', que: 'Cómo se llama el producto en la caja y en el inventario.', ej: 'Harina de maíz precocida 1 kg' },
  { k: 'codigo_barra', h: 'Código de barras', ancho: 18, e: 'texto', que: 'El del empaque, el que lee el escáner. Si tiene varios, pon el principal. Escríbelo tal cual, con todos sus dígitos.', ej: '7591234500011' },
  { k: 'codigo_interno', h: 'Código interno', ancho: 14, e: 'texto', que: 'Tu propio código. Si lo dejas vacío, el sistema asigna PROD-0001, PROD-0002…', ej: 'PROD-0001' },
  { k: 'categoria', h: 'Categoría', ancho: 18, lista: 'cat', que: 'Elige de la lista o escribe una nueva: se crea sola.', ej: 'Harinas' },
  { k: 'marca', h: 'Marca', ancho: 16, e: 'texto', que: 'Opcional.', ej: 'Marca' },
  { k: 'presentacion', h: 'Presentación', ancho: 14, e: 'texto', que: 'Tamaño o contenido.', ej: '1 kg' },
  { k: 'unidad_compra', h: 'Unidad de compra', ancho: 14, lista: 'uni', que: 'Cómo le compras al proveedor (caja, paquete, unidad…). Si la dejas vacía, «unidad».', ej: 'caja' },
  { k: 'unidad_venta', h: 'Unidad de venta', ancho: 14, lista: 'uni', que: 'Cómo lo vendes. Casi siempre «unidad»; «kg» si lo vendes por peso. Si la dejas vacía, «unidad».', ej: 'unidad' },
  { k: 'factor_conversion', h: 'Unidades por unidad de compra', ancho: 16, e: 'entero', que: 'Cuántas unidades de venta trae una unidad de compra: una caja de 20 es 20. Si lo dejas vacío, 1.', ej: 20 },
  { k: 'costo_usd', h: 'Costo por unidad de venta USD *', ancho: 17, req: 1, e: 'decimal', min: 0, que: 'Lo que te cuesta cada unidad, en dólares. Con este costo se valoriza tu inventario: no lo dejes vacío si tienes existencia.', ej: 0.95 },
  { k: 'precio_venta_usd', h: 'Precio de venta USD *', ancho: 15, req: 1, e: 'decimal', min: 0, que: 'Precio al público en dólares. Si no pones precio pero sí margen, el precio se calcula.', ej: 1.3 },
  { k: 'margen_utilidad', h: 'Margen % (opcional)', ancho: 12, e: 'decimal', min: 0, que: 'Porcentaje del precio de venta que queda como ganancia (precio = costo ÷ (1 − margen)). Solo se usa cuando no pones el precio.', ej: '' },
  { k: 'precio_fijo', h: 'Precio fijo (sí/no)', ancho: 12, lista: 'sn', que: '«sí»: el precio se mantiene aunque cambie el costo. «no»: se recalcula con el margen. Si lo dejas vacío, «sí».', ej: 'sí' },
  { k: 'stock_actual', h: 'Existencia inicial *', ancho: 14, req: 1, e: 'decimal', min: 0, que: 'Cuántas unidades de venta tienes hoy en el local, contadas. Si no tienes, escribe 0.', ej: 25 },
  { k: 'stock_minimo', h: 'Stock mínimo', ancho: 12, e: 'decimal', min: 0, que: 'Por debajo de esta cantidad el sistema te avisa que hay que reponer.', ej: 12 },
  { k: 'stock_maximo', h: 'Stock máximo', ancho: 12, e: 'decimal', min: 0, que: 'Lo máximo que quieres tener. Opcional.', ej: 60 },
  { k: 'proveedor_principal', h: 'Proveedor principal', ancho: 24, lista: 'prov', que: 'Elige de la lista o escribe uno nuevo. Se usa para las compras asistidas.', ej: 'Distribuidora Central' },
  { k: 'ubicacion', h: 'Ubicación', ancho: 14, e: 'texto', que: 'Pasillo, estante o nevera. Opcional.', ej: 'Pasillo 1' }
];

const norm = (h) => String(h == null ? '' : h).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// Encabezados aceptados → clave. Incluye los nombres de la plantilla CSV anterior para que ambos formatos se entiendan.
const ALIAS = {};
for (const c of COLUMNAS) ALIAS[norm(c.h)] = c.k;
Object.assign(ALIAS, {
  nombre: 'nombre', producto: 'nombre', codigo_de_barra: 'codigo_barra', codigo_barras: 'codigo_barra', codigo_barra: 'codigo_barra', codigo: 'codigo_interno', unidad_de_compra: 'unidad_compra', unidad_de_venta: 'unidad_venta',
  factor: 'factor_conversion', unidades_por_caja: 'factor_conversion', costo: 'costo_usd', costo_usd: 'costo_usd', precio: 'precio_venta_usd', precio_usd: 'precio_venta_usd', precio_venta_usd: 'precio_venta_usd',
  margen: 'margen_utilidad', margen_utilidad: 'margen_utilidad', precio_fijo: 'precio_fijo', existencia: 'stock_actual', existencia_inicial: 'stock_actual', stock: 'stock_actual', stock_actual: 'stock_actual',
  stock_minimo: 'stock_minimo', minimo: 'stock_minimo', stock_maximo: 'stock_maximo', maximo: 'stock_maximo', proveedor: 'proveedor_principal', proveedor_principal: 'proveedor_principal', ubicacion: 'ubicacion'
});

const PASOS = [
  'Llena la hoja «Inventario»: una fila por producto. Las columnas con asterisco (*) son las que no pueden faltar.',
  'Las dos filas de ejemplo (las que empiezan con «(Ejemplo)») puedes borrarlas o dejarlas: el sistema las ignora.',
  'Los códigos de barras y los códigos internos van como texto, con todos sus dígitos. Las columnas ya están listas para eso.',
  'Costos y precios van en dólares (USD), con punto o coma decimal. El costo es por unidad de venta.',
  'Escribe la existencia que contaste hoy en el local. Con ella y el costo se valoriza tu inventario inicial.',
  'Guarda el archivo como Libro de Excel (.xlsx), vuelve al sistema (Productos › Inventario inicial) y súbelo. Antes de cargar nada, el sistema revisa fila por fila y te muestra los errores para que los corrijas.'
];
const REGLAS = [
  'Si una categoría o un proveedor no existe, se crea sola.',
  'Si un producto ya existe (mismo código interno o mismo código de barras), se actualizan sus datos en lugar de duplicarlo.',
  'La existencia inicial se carga una sola vez por producto. Si un producto ya tiene movimientos de inventario, sus datos se actualizan pero su existencia no se toca: para eso está el ajuste de inventario.',
  'Si un código de barras ya pertenece a otro producto, esa fila queda con error.',
  'Una fila con error no se carga; el resto sí, si decides cargar solo las filas correctas.',
  'Tu plan limita la cantidad de productos: si el archivo la supera, las filas sobrantes quedan con error.'
];

function plantilla({ empresa = '', categorias = [], proveedores = [] } = {}) {
  const ult = FILAS_PLANTILLA + 1;
  const rangoCol = (k) => { const i = COLUMNAS.findIndex((c) => c.k === k); const L = require('./xlsx').numACol(i); return `${L}2:${L}${ult}`; };
  const listaRef = { cat: `Listas!$A$2:$A$${Math.max(2, categorias.length + 1)}`, prov: `Listas!$B$2:$B$${Math.max(2, proveedores.length + 1)}`, uni: `Listas!$C$2:$C$${UNIDADES.length + 1}`, sn: 'Listas!$D$2:$D$3' };
  const validaciones = [];
  for (const c of COLUMNAS) {
    if (c.lista) validaciones.push({ rango: rangoCol(c.k), lista: listaRef[c.lista], aviso: c.lista === 'cat' || c.lista === 'prov' || c.lista === 'uni', titulo: c.h.replace(/ \*/, ''), error: c.lista === 'sn' ? 'Escribe sí o no.' : 'Ese valor no está en la lista. Si es nuevo, se creará al cargar el archivo.' });
    else if (c.e === 'decimal' || c.e === 'entero') validaciones.push({ rango: rangoCol(c.k), minimo: 0, titulo: c.h.replace(/ \*/, ''), error: 'Escribe un número mayor o igual a 0.' });
  }
  const ejemplos = [
    ['(Ejemplo) Harina de maíz precocida 1 kg', '7591234500011', 'PROD-0001', 'Harinas', 'Marca', '1 kg', 'caja', 'unidad', 20, 0.95, 1.3, '', 'sí', 25, 12, 60, 'Distribuidora Central', 'Pasillo 1'],
    ['(Ejemplo) Refresco 2 L', '7591234500028', '', 'Bebidas', 'Marca', '2 L', 'caja', 'unidad', 6, 1.1, 1.6, '', 'sí', 30, 18, 90, 'Distribuidora Central', 'Nevera 1']
  ];
  const filaCab = { alto: 44, celdas: COLUMNAS.map((c) => ({ v: c.h, e: c.req ? 'requerido' : 'cabecera' })) };
  const filasEj = ejemplos.map((f) => ({ celdas: f.map((v, i) => ({ v, e: COLUMNAS[i].e === 'decimal' || COLUMNAS[i].e === 'entero' ? 'ejDecimal' : 'ejTexto' })) }));
  const inventario = { nombre: 'Inventario', filas: [filaCab, ...filasEj], anchos: COLUMNAS.map((c) => ({ w: c.ancho, e: c.e || 'texto' })), congelar: 1, autofiltro: `A1:${require('./xlsx').numACol(COLUMNAS.length - 1)}1`, validaciones };

  const instrucciones = {
    nombre: 'Instrucciones', activa: true, sinCuadricula: true, anchos: [118],
    filas: [
      [{ v: 'Carga de inventario inicial', e: 'titulo' }],
      [{ v: `${empresa ? empresa + ' · ' : ''}Plantilla generada por Abasto Cloud`, e: 'nota' }],
      [],
      [{ v: 'Cómo llenarla', e: 'seccion' }],
      ...PASOS.map((p, i) => [{ v: `${i + 1}.  ${p}`, e: 'nota' }]),
      [],
      [{ v: 'Qué hace el sistema al cargarla', e: 'seccion' }],
      ...REGLAS.map((r) => [{ v: '•  ' + r, e: 'nota' }]),
      [],
      [{ v: 'Las hojas «Columnas» y «Listas» explican cada columna y traen las listas desplegables. No las borres ni cambies el nombre de las columnas de «Inventario».', e: 'crema' }]
    ]
  };
  const columnas = {
    nombre: 'Columnas', anchos: [30, 13, 74, 28], congelar: 1,
    filas: [
      { alto: 30, celdas: ['Columna', '¿Obligatoria?', 'Qué poner', 'Ejemplo'].map((v) => ({ v, e: 'cabecera' })) },
      ...COLUMNAS.map((c) => [{ v: c.h.replace(/ \*/, ''), e: 'celdaTxt' }, { v: c.req ? 'Sí' : 'No', e: 'celdaTxt' }, { v: c.que, e: 'celdaTxt' }, { v: c.ej === '' ? '' : (typeof c.ej === 'number' ? c.ej : String(c.ej)), e: 'celdaTxt' }])
    ]
  };
  const n = Math.max(categorias.length, proveedores.length, UNIDADES.length, 2);
  const listas = {
    nombre: 'Listas', anchos: [28, 32, 16, 12],
    filas: [
      { celdas: ['Categorías', 'Proveedores', 'Unidades', 'Precio fijo'].map((v) => ({ v, e: 'cabecera' })) },
      ...Array.from({ length: n }, (_, i) => [categorias[i] ? { v: categorias[i], e: 'celda' } : null, proveedores[i] ? { v: proveedores[i], e: 'celda' } : null, UNIDADES[i] ? { v: UNIDADES[i], e: 'celda' } : null, i < 2 ? { v: ['sí', 'no'][i], e: 'celda' } : null])
    ]
  };
  return crearXlsx({ hojas: [instrucciones, inventario, columnas, listas] });
}

// Lee el libro llenado. Devuelve { filas: [{ fila: 5, v: { nombre, costo_usd, … } }], columnas: [claves reconocidas], ignoradas: [encabezados sin uso] }.
function filasDeExcel(buf) {
  const libro = leerXlsx(buf);
  const orden = [...libro.hojas].sort((a, b) => (norm(b.nombre) === 'inventario') - (norm(a.nombre) === 'inventario'));
  for (const hoja of orden) {
    const idx = hoja.filas.slice(0, 20).findIndex((f) => f.celdas.some((c) => ALIAS[norm(c)] === 'nombre'));
    if (idx < 0) continue;
    const mapa = hoja.filas[idx].celdas.map((c) => ALIAS[norm(c)] || null);
    const ignoradas = hoja.filas[idx].celdas.filter((c, i) => c.trim() && !mapa[i]);
    const filas = [];
    for (const f of hoja.filas.slice(idx + 1)) {
      const v = {};
      f.celdas.forEach((c, i) => { if (mapa[i] && v[mapa[i]] === undefined) v[mapa[i]] = String(c).trim(); });
      if (Object.values(v).some((x) => x !== '')) filas.push({ fila: f.fila, v });
    }
    return { hoja: hoja.nombre, filas, columnas: [...new Set(mapa.filter(Boolean))], ignoradas };
  }
  throw new Error('No encontré la hoja «Inventario» con la columna «Nombre del producto». Usa la plantilla que descargas desde el sistema y no cambies los encabezados.');
}

module.exports = { plantilla, filasDeExcel, COLUMNAS, UNIDADES };
