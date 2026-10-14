# Abasto Cloud

Sistema para minis abastos: inventario, punto de venta con código de barras, compras, caja multimoneda
(USD, Bs, EUR), crédito de clientes, bancos, inventarios cíclicos ABC, app de pedidos para clientes,
reconocimiento de productos por foto y una plataforma multiempresa con licencias.
Sigue el diseño de la conversación de Codex (`..\conversacion_crear_sistema_de_inventarios.md`)
y los 18 documentos en `Documents\Codex\2026-07-03\n\outputs`.

## Arrancar

Requiere Node.js 22.13 o superior (usa `node:sqlite`). La única dependencia es el SDK de Anthropic (solo se usa para el
reconocimiento por foto):

```bash
npm install
node --no-warnings server.js
```

- Sistema administrativo: <http://localhost:3300>
- App de clientes (se instala como PWA en el celular): <http://localhost:3300/tienda/>
- App del repartidor (celular): <http://localhost:3300/reparto/> (o `/reparto/<codigo>/`)
- Panel de la plataforma (alta de abastos y licencias): <http://localhost:3300/plataforma/>
- Los datos viven en `data/`: una base SQLite por abasto en `data/empresas/<codigo>.db` y `data/plataforma.db`.
  Los respaldos diarios automáticos van a `data/respaldos/`.
- En el primer arranque se crean la empresa `principal` y dos accesos; las claves quedan en
  `data/PRIMER_ACCESO.txt` (usuario `admin`) y `data/PLATAFORMA_ACCESO.txt` (usuario `plataforma`).
  Cámbialas o define `ADMIN_PASSWORD` y `PLATAFORMA_CLAVE` antes del primer arranque.
- Datos de ejemplo (32 productos, proveedores, medios de pago): `npm run demo` (o `npm run demo -- <codigo>`).
- Para publicarlo en internet: ver `DESPLIEGUE.md`.

Con un solo abasto instalado, el login y la app de clientes no piden código. Al crear un segundo abasto,
cada uno entra con su código: `/?e=<codigo>` para el sistema y `/tienda/<codigo>/` para sus clientes.

## Flujo de un día

1. **Inicio › Abrir día**: se cargan las tasas USD/Bs y EUR/USD. Sin día abierto no se vende, compra ni cobra.
2. **Caja › Abrir caja** con el fondo inicial por moneda.
3. **Punto de venta**: escanear código de barras, buscar por nombre o tomar una foto del producto (📷 Foto).
   Cada venta del POS empieza identificando al cliente por cédula o RIF (si no existe, se crea en el momento; se puede desactivar en Parámetros › Operación). Al terminar, el botón principal es Imprimir ticket. F2 abre el cobro. Pago único o mixto (efectivo en cualquier moneda, pago móvil, transferencia, punto, crédito), con vuelto. Si hay vuelto, el cajero indica cómo lo entrega (efectivo $, Bs, €, pago móvil o transferencia, también repartido): queda registrado como pago tipo vuelto, descuenta la caja o el banco que corresponda, aparece en el resumen de caja, el recibo y el detalle de la venta. Si no indica nada, sale todo en efectivo $.
4. **Pedidos app**: el cliente pide desde `/tienda/`, la mercancía queda reservada, reporta el pago y un
   cajero lo valida: ahí se crea la venta, se descuenta el inventario y nace la orden de entrega.
5. **Caja › Cerrar**: se cuenta el efectivo por moneda; si hay diferencia el comentario es obligatorio.
6. **Inicio › Cerrar día**: resumen de ventas, cobros, compras y diferencias.

## Módulos

| Módulo | Qué hace |
|---|---|
| Productos | Maestro con categorías, varios códigos de barras, costo, precio fijo o por margen, mínimos y máximos, importación/exportación CSV |
| Existencias | Stock, reservado por la app, disponible, valor, ajustes y mermas con motivo. **Kardex valorizado al costo promedio móvil**: cada movimiento muestra su costo, el saldo, el costo promedio y el valor. Las compras recalculan el promedio; ventas, mermas, consumos y ajustes se valoran al promedio vigente en ese momento; un cambio manual del costo queda como revalorización |
| Compras | Orden de compra en borrador → **enviada al proveedor** (queda registrado quién, cuándo y por qué medio; las cantidades pedidas ya no cambian) → recibida. Al recibir se ajustan las cantidades y el costo de cada línea según lo que llegó y la factura (N° y fecha de factura, nota); la orden conserva lo pedido y marca las diferencias. Lo que no llegó no entra al inventario. Recepción en USD/Bs/EUR, contado (sale de banco o caja) o crédito (genera cuenta por pagar), costo promedio ponderado |
| Sugerencias de compra | Análisis por producto: ventas por día (mezcla de 7, 30 y 90 días) y tendencia, días que alcanza la existencia, plazo de entrega del proveedor, margen de seguridad según la irregularidad de las ventas y la clase ABC, punto de pedido, objetivo de stock, pedidos ya en borrador y reservas de la app. Clasifica en agotado, crítico, reponer, planificar, sobrestock y sin movimiento; sugiere cajas completas por proveedor con el motivo de cada fila, y crea las órdenes en borrador. El mínimo y el máximo del producto siguen funcionando como piso y techo |
| Cuentas por pagar y estado de cuenta del proveedor | Deuda por proveedor (vencida, próximo vencimiento, último pago) y facturas con lo pagado y el saldo. El **estado de cuenta** de cada proveedor muestra la deuda actual, la antigüedad (vigente, 1-30, 31-60, más de 60 días), las facturas con cada pago aplicado (fecha, monto, tasa, cuenta y referencia) y los movimientos con saldo acumulado; se puede pagar desde ahí, imprimir y exportar a CSV. Las compras de contado figuran como referencia sin afectar el saldo |
| Clientes y crédito | Límite, días, suspensión, deuda vencida, abonos con cualquier medio. **Estado de cuenta por cliente**: deuda, antigüedad, cada factura a crédito con sus cobros y el historial de movimientos con saldo corriente (también imprime y exporta a CSV). **Recordatorios de saldos vencidos**: lista de clientes vencidos, mensaje armado con las facturas y el monto (editable), se abre en WhatsApp y queda registrado cuándo y quién lo envió |
| Bancos y cajas | Saldos por moneda desde movimientos, transferencias internas, saldo inicial auditado |
| Conteos cíclicos ABC | Clasificación por valor, movimiento o mixto y vueltas por clase. **La cantidad diaria sale del plan** (⌈(A×vueltas + B×vueltas + C×vueltas) ÷ días operativos⌉) y se reparte entre las clases en proporción a su carga anual; solo los productos se sortean al azar dentro de cada clase. **Conteo a ciegas:** la hoja impresa y la pantalla de quien cuenta no muestran la cantidad del sistema, las diferencias, la clase ni el motivo de selección; solo quien autoriza ajustes los ve. Documento `IC-AAAAMMDD-NNN`, carga, comparativo y ajuste autorizado |
| Pedidos app | Reserva con vencimiento, pago reportado con comprobante, semáforo, una ficha por etapa (por pagar, por validar, por preparar, en preparación, listos, entregados, cerrados), órdenes de entrega (retiro o envío) |
| Preparación con verificación | Al empezar a preparar se arma la lista del pedido y el lector verifica cada producto; avisa si falta, sobra o no es del pedido; no deja terminar hasta completar; marcar a mano exige motivo y queda registrado |
| Lector de código de barras | Parametrizable en Parámetros: lector USB/Bluetooth (teclado), serial/COM o cámara; carácter final, prefijo, largo mínimo, velocidad, pitido y validación del dígito de control. Incluye un cuadro para probar el lector y detectar su configuración |
| App del repartidor (`/reparto/`) | Usuario con rol Repartidor. Recibe el pedido al instante (pitido, vibración y notificación) y maneja sus estados con botones siempre a la vista: **Retirado de la tienda → En camino → Entregado**, o **Rechazado** si el cliente no lo recibe (con motivo). Puede marcarlos en orden o saltar directo al que corresponde (los intermedios quedan con la misma hora), y gestiona un pedido preparado en cuanto se le asigna, sin esperar el «listo para envío». El cliente ve cada paso; el negocio ve quién y a qué hora, y resuelve una entrega rechazada reprogramándola o cancelando el pedido (se anula la venta y el stock vuelve). Incluye cuánto cobrar y el vuelto que debe llevar |
| Reconocimiento por foto | Foto del producto → hasta 3 candidatos del catálogo con su coincidencia → el cajero confirma |
| Análisis financiero | Resumen con indicadores (márgenes, rotación, días de cobro y pago, razón corriente, punto de equilibrio) y alertas, estado de resultados, balance general, flujo de caja y registro de gastos por categoría. Período a elegir; se imprime o guarda en PDF |
| Reportes | Ventas, utilidad por producto, cumplimiento de conteos, auditoría |
| Tasas de cambio por fecha | Cada tasa pertenece a una fecha: al abrir el día se registra la de hoy (hay que escribirla cada día), se pueden cargar tasas de fechas futuras (hasta 7 días) o corregir una anterior con motivo, y el sistema avisa si el día abierto es de una fecha pasada o si hay fechas sin tasa |
| Parámetros | Negocio, operación, ABC, bancos y cajas, datos de pago electrónico que ve la app, usuarios y roles, respaldo |
| Plataforma | Alta de abastos, precio y límites por plan, pagos de licencia, suspensión, uso de fotos, bitácora |

Roles: los de base (admin, supervisor, cajero, compras, almacén, vendedor y repartidor) más los que cree el administrador en Parámetros › Roles y permisos, donde marca qué módulos y acciones tiene cada uno. Cambios de precio, costo, crédito, tasas,
saldos y ajustes de inventario quedan en la auditoría.

## Multiempresa y licencias

- Cada abasto tiene su propia base de datos. No comparten tablas, usuarios, clientes ni sesiones; el token de
  sesión lleva el código de la empresa y solo vale dentro de su base.
- Licencia: vencida → 5 días de gracia con aviso → solo lectura → suspendida (bloqueo total).
  Registrar un pago en el panel renueva desde el vencimiento (o desde hoy si ya venció).
- Límites por plan, editables por abasto: usuarios, productos y fotos con IA por mes.

## Reconocimiento por foto

`POST /api/reconocer` envía la imagen y el catálogo del abasto a la API de Claude y devuelve candidatos que el cajero
confirma; nunca agrega nada solo. Requiere `ANTHROPIC_API_KEY` en el servidor; sin ella el botón no aparece.
Modelo por defecto `claude-opus-5-5` (cambiable con `RECONOCER_MODELO`). Detalles de costo y privacidad en `DESPLIEGUE.md`.

## Pruebas

```bash
npm test
```

Recorre 22 escenarios de punta a punta con bases temporales: permisos, día y caja, compra en bolívares,
venta mixta con vuelto, crédito y cobro, anulaciones, pedido por app con reserva y validación, rechazo,
vencimiento de reserva, conteo cíclico, cierre de caja y del día, importación CSV, reconocimiento por foto contra un
servicio simulado, aislamiento entre empresas, límites de plan, licencias y respaldos.

## Lo que falta

- **Avisos al repartidor:** funcionan mientras la app de reparto está abierta en el teléfono (consulta cada 10 segundos y avisa con pitido, vibración y, si lo permite, notificación). Con la pantalla bloqueada o la app cerrada el navegador pausa la página y no llega el aviso: eso requiere notificaciones push reales, que necesitan HTTPS (o sea, el sistema publicado) y no están hechas. Hasta entonces, la alternativa es avisarle por WhatsApp.
- **App del repartidor:** el flujo se probó con teléfono simulado, no con un repartidor real. No incluye seguimiento por GPS ni mapa en vivo; el botón "Mapa" abre la dirección en Google Maps.

- **Lector de código de barras:** la detección y la captura del tipo teclado se probaron simulando teclas rápidas, no con un lector físico. El modo serial (Web Serial) y la cámara tampoco se probaron con equipo real. Si tu lector no cierra con Enter o Tab, hay que programarlo con el código de configuración de su manual (“agregar Enter al final”).

- **El reconocimiento por foto no se probó contra la API real de Claude**, solo contra un servicio simulado que
  imita su respuesta. Hace falta una credencial y fotos de productos reales para medir la precisión.
  La captura con la cámara del navegador tampoco pudo probarse en el entorno de desarrollo (subir una imagen sí).
- Esa llamada no usa los reintentos de modelo alterno ante rechazos de seguridad (`fallbacks`): una foto de un producto
  rara vez los dispara; si ocurre, el sistema responde "no se pudo analizar" y el cajero busca por nombre.
- **Publicación en internet**: está todo preparado (`Dockerfile`, `fly.toml`, `DESPLIEGUE.md`) pero no se desplegó:
  requiere tu cuenta de hosting.
- El cobro de las licencias es manual: el operador registra los pagos en el panel. No hay pasarela de pago.
- Factura fiscal: fuera del alcance de la etapa 1, según lo acordado. Los recibos son comprobantes internos.
- No hay envío de notificaciones al cliente (WhatsApp, correo).
- Pasar a varias máquinas o a alta disponibilidad exigiría cambiar SQLite por otra base.
