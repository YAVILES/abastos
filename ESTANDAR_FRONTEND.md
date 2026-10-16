# Estándar de frontend

Guía de diseño para todas las aplicaciones de Carlos. Nació en Abasto Cloud y los valores de este documento son los que están en `public/styles.css` y `public/app-movil.css`. Si una app nueva sigue esta guía, se ve y se comporta como la familia.

**Carácter:** elegante y atrevido. Mucho aire, superficies blancas suaves sobre un fondo azulado, un menú azul marino profundo, acentos fuertes (esmeralda, azul, dorado) y números grandes. Los colores plenos se usan para lo que importa: totales, alertas, el botón principal.

---

## 1. Principios

1. **Una sola acción principal por pantalla.** Se pinta en dorado o esmeralda pleno. Lo demás es secundario (blanco con borde).
2. **Cada zona con su color.** El que mira debe distinguir de un vistazo dónde escanea, dónde ve el carrito, dónde está el cliente y dónde está el total.
3. **El número manda.** Totales, saldos y cifras clave van grandes, en negrita y con cifras tabulares.
4. **El color nunca va solo.** Todo estado de color lleva también texto o un punto indicador (ver §6.5).
5. **Cómodo para el pulgar en teléfono.** Zona táctil mínima de 48 px, acciones principales abajo.
6. **Todo sale de variables.** Ningún componente lleva un color escrito a mano. Se cambia la marca tocando la sección de tokens.

---

## 2. Tokens de diseño

Se definen una vez en `:root`. Los componentes solo usan estas variables.

### 2.1 Paleta

**Neutros**

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#f6f7f9` | Fondo de la página |
| `--panel` | `#ffffff` | Tarjetas, campos, ventanas |
| `--ink` | `#111827` | Texto principal |
| `--ink-2` | `#374151` | Texto secundario, etiquetas |
| `--muted` | `#6b7280` | Ayudas, fechas, texto apagado |
| `--line` | `#e7e9ee` | Divisores y bordes suaves |
| `--line-2` | `#d5d9e0` | Bordes de campos y botones |

**Marca**

| Token | Valor | Uso |
|---|---|---|
| `--navy` | `#0b1b34` | Menú lateral, bandas de título, total a pagar |
| `--navy-2` | `#12284a` | Cabecera de tablas, títulos de tarjeta, degradados |
| `--brand` | `#0a7a5a` | Esmeralda: botón principal, estado «correcto» |
| `--brand-d` | `#07654a` | Esmeralda oscuro (al pasar el cursor) |
| `--brand-l` | `#e6f5ef` | Esmeralda muy claro (fondos, opción activa) |
| `--mint` | `#34c398` | Acento brillante sobre fondo oscuro (barra del menú, iconos activos) |
| `--azul` | `#1556c0` | Azul intenso: escaneo, categorías activas, bordes de tarjeta |
| `--azul-d` | `#0f3f93` | Azul oscuro (degradados) |
| `--oro` | `#f5b301` | Dorado: acción principal de cobro, estrellas, atención |
| `--crema` | `#fff3cf` | Bloque cálido: cliente, cobro y vuelto |
| `--crema-b` | `#f2dc9a` | Borde del bloque crema |

**Estados** (cada uno con su versión clara para fondos)

| Estado | Pleno | Claro |
|---|---|---|
| Correcto | `--ok #17803f` | `--ok-l #e5f6ec` |
| Atención | `--warn #a15c07` | `--warn-l #fff5dc` |
| Error / alerta | `--bad #c23a2e` | `--bad-l #fdeceb` |
| Información | `--info #2459a8` | `--info-l #e8f0fb` |

**Fondo de página:** degradado azulado que se desvanece hacia `--bg`.
`linear-gradient(180deg, #e3eefc 0, #eef3fb 320px, var(--bg) 700px) fixed`

**Cuatro colores de cifras** (tarjetas KPI, en este orden y repitiéndose): marino → azul → esmeralda → dorado.

### 2.2 Tipografía

- **Familia:** `Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`. Sin descargar fuentes: funciona sin internet.
- **Base:** 14 px en escritorio, 16 px en teléfono (con menos de 16 px el teléfono hace zoom al escribir).
- **Interlineado:** 1,5 en texto corrido.

| Rol | Tamaño | Peso | Nota |
|---|---|---|---|
| Título de pantalla (`h1`) | 26–28 px | 800 | Interletrado `-0.03em` |
| Título de tarjeta (`h2`) | 16–18 px | 700 | Color `--navy-2` |
| Subtítulo (`h3`) | 14 px | 650 | |
| Cifra grande (KPI) | 30–32 px | 800 | `font-variant-numeric: tabular-nums` |
| Total a pagar | 40–48 px | 800 | Color blanco sobre marino |
| Etiqueta de campo | 12–13 px | 600 | Color `--ink-2` |
| Encabezado de tabla | 11 px | 650 | Mayúscula, `letter-spacing .06em` |
| Título de sección del menú | 11–12 px | 650 | Mayúscula, `letter-spacing .08em` |
| Ayuda / texto apagado | 12 px | 400 | `--muted` |

Las cifras de dinero, cantidades y totales siempre llevan `font-variant-numeric: tabular-nums` para que las columnas no bailen.

### 2.3 Espacio

Escala de 4: **4, 8, 12, 16, 20, 24, 32, 48**.

- Separación entre tarjetas: 20 px.
- Relleno interior de tarjeta: 24 px (20 px en teléfono).
- Relleno de la página: 24 px arriba y 32 px a los lados (16 px en teléfono).
- Separación entre campos de un formulario: 16 px.

### 2.4 Radios

| Token | Valor | Uso |
|---|---|---|
| `--r1` | 8 px | Campos de escritorio, botones, chips cuadrados |
| `--r2` | 12 px | Resultados de búsqueda, KPI pequeños, botones grandes |
| `--r3` | 16 px | Tarjetas |
| 18–20 px | | Banda de título, ventanas emergentes, tarjetas de teléfono |
| 999 px | | Píldoras (chips, etiquetas, categorías) |

### 2.5 Sombras (una por nivel)

```css
--sh1: 0 1px 2px rgba(17,24,39,.04);                                  /* botones */
--sh2: 0 1px 2px rgba(17,24,39,.04), 0 6px 20px rgba(17,24,39,.05);   /* tarjetas */
--sh3: 0 24px 64px rgba(17,24,39,.28);                                /* ventanas, avisos */
```

Las tarjetas de color pleno llevan sombra del mismo color (por ejemplo, el botón dorado: `0 10px 24px rgba(245,179,1,.4)`).

### 2.6 Movimiento

- Transición base: `160ms cubic-bezier(.2,.7,.3,1)`. Solo color, borde, sombra y `transform`.
- Entrada de ventanas: 200 ms, sube 8 px con desvanecido. En teléfono, sube desde abajo como hoja.
- Al presionar un botón: `translateY(1px)` o `scale(.97)`.
- Respetar siempre `prefers-reduced-motion: reduce` (se apagan animaciones y transiciones).

### 2.7 Iconos

- Una sola familia: **iconos de línea, 24×24, trazo 1,75, extremos redondeados** (estilo Lucide), incrustados como SVG en línea. Sin librerías ni emojis como iconos de interfaz.
- Tamaño: 18–20 px en el menú, 32 px en mosaicos, 34 px en la insignia de marca.
- Color: `currentColor`, para que hereden el estado.
- Todo botón que lleve solo icono lleva `aria-label`.

---

## 3. Estructura de pantalla (escritorio)

```
┌─────────────┬──────────────────────────────────────────────┐
│ Menú lateral│  Barra superior: avisos (píldoras) + usuario │
│ 276 px      ├──────────────────────────────────────────────┤
│ marino      │  Banda de título (marino)      [Acciones]    │
│             │  Contenido: tarjetas y tablas                │
└─────────────┴──────────────────────────────────────────────┘
```

- Cuadrícula: `grid-template-columns: 276px 1fr`. Contenido con `max-width: 1480px`.
- Puntos de corte: **1100 px** (menú 252 px; KPI de 4 a 2 columnas), **900 px** (menú pasa a panel deslizable), **560 px** (todo a una columna).

### 3.1 Menú lateral

- Fondo degradado marino `#0b1b34 → #08132a`, texto `#b9c6dc`, sin borde derecho.
- **Cabecera de marca:** tarjeta redondeada (18 px) con degradado marino y un brillo esmeralda en la esquina. El logo va sobre una base blanca redondeada con aro esmeralda y sombra (máx. 76 px de alto). Debajo, el nombre en blanco, 20 px, 800, y una línea corta de acento verde→dorado.
- **Opción:** icono 20 px + texto 15,5 px, alto mínimo 44 px, radio 8 px.
  - Reposo: texto `#b9c6dc`, icono `#6f84a8`.
  - Cursor encima: fondo blanco al 7 %, texto blanco.
  - **Activa:** degradado esmeralda al 28 % → 8 %, texto blanco, icono `--mint`, y una barra de 3 px a la izquierda (`inset 3px 0 0 #34c398`).
- **Títulos de sección:** mayúscula, 12 px, color `#5f7599`.
- **Comportamiento obligatorio:** el menú conserva su posición de desplazamiento al cambiar de pantalla y trae a la vista la opción activa si quedó fuera. En teléfono se cierra al tocar cualquier parte de una opción.

### 3.2 Barra superior

- Izquierda: avisos de estado como píldoras de color pleno (ver §6.5). Derecha: nombre y rol del usuario, en `--navy-2`, 600.
- Separada del contenido con una línea de 1 px (`--line`).

### 3.3 Banda de título

El `h1` de cada pantalla es una banda marino:

- Degradado `120deg, #0b1b34 → #12284a 60% → #1a3d73`, texto blanco, radio 18 px, relleno 20×26 px.
- Barra de 6 px en esmeralda a la izquierda y un brillo esmeralda en la esquina superior derecha.
- Si el título comparte fila con botones, se muestra **en línea** (radio 14 px, 22 px, barra de 5 px) y los botones van a su lado.

---

## 4. Componentes

### 4.1 Botones

| Tipo | Clase | Aspecto |
|---|---|---|
| Secundario | `.btn` | Blanco, borde 2 px `#cfdcf2`, texto en negrita. Cursor encima: borde azul y fondo `#eef4ff` |
| Principal | `.btn.pri` | Degradado esmeralda `#12926d → --brand`, texto blanco |
| Cobrar / acción clave | `.btn-cobrar` | Degradado dorado `#ffc82e → --oro`, texto `#3a2a00`, 20 px, 800, alto 60 px |
| Peligro | `.btn.bad` | Texto `--bad`, borde rojo suave; cursor encima: fondo `--bad-l` |
| Pequeño | `.btn.sm` | Alto 30 px (44 px en teléfono) |
| Grande | `.btn.lg` | Alto 48 px, 16 px, radio 12 px (58 px en teléfono) |

- Alto mínimo 40 px en escritorio, **48 px en teléfono**.
- Estado desactivado: opacidad .5, cursor `not-allowed`, sin movimiento.
- Foco visible siempre: aro `0 0 0 3px var(--brand-ring)`. Nunca quitar el contorno sin reemplazarlo.
- Mientras se guarda: desactivar el botón para evitar envíos dobles.

### 4.2 Campos

- Alto mínimo 40 px (52 px en teléfono), borde de 2 px `#d4def0`, radio 8 px (14 px en teléfono).
- Foco: borde `--azul` y aro `0 0 0 4px rgba(21,86,192,.18)`.
- Etiqueta visible **encima** del campo, nunca solo como placeholder.
- Error: mensaje debajo del campo, en `--bad`, con la causa y cómo arreglarlo.
- Tipos semánticos (`tel`, `email`, `number`) para que el teléfono muestre el teclado correcto.
- Los campos obligatorios se marcan con `*` en la etiqueta.

### 4.3 Tarjetas

- Fondo `--panel`, radio 16 px, relleno 24 px, **borde superior de 3 px en `--azul`**, sombra `--sh2`.
- Sin borde superior en tarjetas de color (zonas del punto de venta, total, bloque crema).
- Título `h2` en `--navy-2`.

### 4.4 Tarjetas de cifras (KPI)

- Rótulo arriba (11 px, mayúscula, 700), cifra grande (32 px, 800) y una línea de apoyo (12 px).
- Color pleno según su posición: **marino, azul, esmeralda, dorado**. Texto blanco, salvo el dorado, que lleva texto `#3a2a00`.
- Sombra `0 14px 30px rgba(11,27,52,.2)`. Sin borde.

### 4.5 Tablas

- Cabecera: fondo `--navy-2`, texto blanco, mayúscula 11 px, esquinas redondeadas en el primer y último encabezado.
- Filas: relleno 12 px, divisor de 1 px. Filas pares con fondo `#f5f8fe`.
- Filas pulsables: fondo `#e3eefc` al pasar el cursor.
- Columnas numéricas alineadas a la derecha y con cifras tabulares.
- Tablas anchas: envolver en un contenedor con desplazamiento horizontal. Nunca desplazar la página entera.
- Sin datos: mensaje centrado que explica qué hacer, no una tabla vacía.

### 4.6 Etiquetas y píldoras

- `.tag`: píldora pequeña (11 px, 650) en versión clara de cada estado, sin borde: correcto, atención, error, información.
- Siempre llevan texto («Entregado», «Por validar»). El color solo refuerza.

### 4.7 Ventanas emergentes (modales)

- Fondo oscuro `rgba(10,14,20,.55)` con desenfoque de 3 px.
- Ventana blanca, radio 20 px, ancho máximo 660 px (1000 px la variante ancha).
- **Encabezado marino** con título blanco y botón de cierre translúcido. Pie con fondo `--bg`.
- Siempre con una salida clara (botón de cierre y «Cancelar»).
- En teléfono: hoja que sube desde abajo, a todo el ancho, esquinas superiores de 24 px.
- Confirmar antes de acciones destructivas y pedir el motivo si queda registrado.

### 4.8 Avisos (toasts)

- Esquina inferior derecha en escritorio, ancho completo sobre la barra inferior en teléfono.
- Fondo `--ink` (neutro), `--ok` (éxito) o `--bad` (error). Desaparecen solos a los 3–5 s.
- No roban el foco.

### 4.9 Barras y gráficos

- Barra de progreso: 8 px, riel `--line`, relleno `--brand`, redondeada.
- Gráfico de barras: degradado esmeralda, esquinas superiores redondeadas, etiqueta pequeña debajo.
- Nunca depender solo del color para distinguir series: añadir etiqueta o valor.

### 4.10 Semáforo

Bloque de 12 px de radio con punto indicador (12 px) y mensaje en negrita. Verde / amarillo / rojo con el fondo claro del estado. El mensaje dice qué pasa y qué sigue.

---

## 5. Pantallas tipo

### 5.1 Acceso (login)

- Fondo marino con brillo esmeralda arriba a la izquierda y azul abajo a la derecha.
- **Escritorio (≥900 px):** dos zonas.
  - Izquierda: insignia esmeralda con el icono de la app, nombre en 36 px blanco, una frase corta y tres puntos con palomita (qué hace la app).
  - Derecha: tarjeta blanca de 380–460 px, título «Bienvenido», campos de 50 px y botón **dorado** «Entrar» de 52 px.
- **Teléfono:** la marca arriba y compacta (insignia, nombre y frase, sin lista) y la tarjeta debajo.
- Código de empresa solo si el sistema es multiempresa. Foco automático en el primer campo vacío.

### 5.2 Inicio (tablero)

1. Banda de título.
2. Tarjeta del estado operativo (día abierto, tasas, acciones).
3. Fila de 4 KPI de color (g4 → 2 columnas → 1).
4. Dos columnas de tarjetas: gráfico de ventas y lista de los más vendidos; alertas y saldos.
5. Alertas con enlace directo a la pantalla que las resuelve.

### 5.3 Listado (maestro)

1. Banda de título en línea + botones de acción a la derecha (el principal en esmeralda).
2. Tarjeta de filtros (búsqueda, categoría, estado).
3. Tarjeta con la tabla, el conteo de resultados arriba y fila pulsable que abre el detalle.
4. Si el listado tiene etapas (por ejemplo, pedidos), una fila de botones-píldora con su contador: la activa en esmeralda.

### 5.4 Detalle

Ventana ancha con encabezado marino. Arriba el semáforo de estado, después los datos en dos columnas, las tablas y, en el pie, las acciones: la principal a la derecha y la peligrosa separada a la izquierda.

### 5.5 Punto de venta (caja)

Dos columnas: escaneo + carrito a la izquierda; cliente, total y cobro a la derecha.

| Zona | Estilo |
|---|---|
| Escaneo / búsqueda | Franja azul intensa `#1556c0 → #0f3f93`, campo blanco de 52 px |
| Carrito | Tarjeta blanca con borde superior azul de 4 px |
| Cliente y descuento | Bloque crema |
| Total a pagar | Panel marino, monto blanco de 48 px con brillo esmeralda |
| Cobrar | Botón dorado de 60 px |
| Medios de pago | **Mosaicos** (ver §7) sobre fondo azul claro `#dcebff` |

Atajos de teclado visibles (por ejemplo, «F2 cobrar»). El lector de código de barras siempre tiene el foco.

### 5.6 Formularios largos

Dos columnas en escritorio, una en teléfono. Agrupar los campos relacionados. Revelar lo avanzado de forma progresiva. Si el proceso tiene pasos, mostrar el avance.

### 5.7 Asistentes con propuesta

Cuando el sistema puede sugerir (reposición, precios, rutas), el flujo ofrece dos modos: **Asistido** (por defecto, con la razón de cada línea) y **Manual**. Lo propuesto siempre es editable, y si la persona ya editó, no se pisa su trabajo sin avisar.

---

## 6. Patrones transversales

### 6.1 Estados vacíos
Mensaje centrado, con una frase que explica y, si procede, el botón que lo resuelve.

### 6.2 Carga
Texto «Cargando…» o esqueleto para esperas de más de 300 ms. Reservar el espacio para que la página no salte.

### 6.3 Errores
Mensaje claro con causa y salida: «No hay un día abierto. Ábrelo desde Inicio». Nunca códigos técnicos al usuario.

### 6.4 Acceso por permisos
Si el rol no tiene un módulo, la opción no aparece en el menú. Si entra por enlace directo, se explica por qué no puede y a quién pedirle acceso.

### 6.5 Avisos en píldora (barra superior)
Píldora de color pleno con un punto a la izquierda:

| Tipo | Fondo | Texto |
|---|---|---|
| Informativo | Marino `#12284a → #1a3d73` | Blanco |
| Correcto | Esmeralda `#12a37b → #0a6e53` | Blanco |
| Atención | Dorado `#f7bb1c → #e29a00` | `#3a2a00` |
| Alerta | Rojo `#e0483a → #b02a1f` | Blanco, punto que late |

### 6.6 Calificación con estrellas
- Cinco estrellas de 56 px (zona táctil) con `role="radio"`; la elegida y las anteriores en dorado con sombra suave.
- Debajo, el texto de la elección (Muy malo, Malo, Regular, Bueno, Excelente) y una observación opcional de hasta 500 caracteres.
- Se califica una sola vez y solo cuando el servicio terminó.
- Para el administrador: promedio, cuántos calificaron y porcentaje de 4–5 estrellas, con aviso si hay calificaciones bajas.

---

## 7. Apps de teléfono (cliente, repartidor, vendedor)

Se cargan con `styles.css` y encima `app-movil.css`. Viewport: `width=device-width, initial-scale=1, viewport-fit=cover` y `theme-color` marino.

- **Cabecera fija:** degradado marino, línea inferior de 3 px esmeralda, respeta la muesca (`env(safe-area-inset-top)`). Botones translúcidos de 44 px.
- **Contenido:** relleno 16 px, con 120 px abajo para no quedar tapado por la barra fija.
- **Barra inferior de acción:** marino con borde superior esmeralda, botón dorado de 58 px a todo el ancho (por ejemplo «Ver carrito · 3 ítems · $ 9,60»). Respeta `env(safe-area-inset-bottom)`.
- **Categorías:** píldoras desplazables de lado (46 px), la activa en azul con sombra.
- **Productos:** dos por fila, tarjeta alta de 20 px de radio, borde superior que alterna azul, verde y dorado, precio de 22 px en azul y botón «Agregar» a todo el ancho.
- **Medios de pago:** tarjetas de 2 px de borde; la elegida con borde azul y aro. Los códigos copiables en fondo crema.
- **Entregas (repartidor):** tarjeta con barra de 6 px a la izquierda (azul; dorada con halo si es nueva). Dirección en 19 px. Cobro y vuelto en bloque crema.
- **Pasos de estado:** botones de 58 px de alto, el estado actual en esmeralda. Los estados importantes siempre a la vista, no escondidos.
- **Llamar, WhatsApp, Mapa:** botones grandes en fila.
- **Mosaicos de pago (caja o cliente):** rejilla de botones blancos de 96 px de alto, borde 2 px `#d7e4f8`, icono azul de 32 px y texto en negrita. Se elevan 2 px al pasar el cursor.
- **Ventanas:** hoja desde abajo, con el pie respetando el área segura.
- **Instalables (PWA):** manifiesto con nombre corto, icono y color marino.

Reglas táctiles: separación mínima de 8 px entre elementos tocables, sin depender del gesto de pasar el dedo para acciones críticas, y retroalimentación visible en menos de 100 ms.

---

## 8. Modo oscuro

Se diseña junto con el claro, no se invierte. Se activa con `prefers-color-scheme: dark` y se puede forzar con `data-tema="claro"`.

| Token | Oscuro |
|---|---|
| `--bg` | `#0e1218` |
| `--panel` | `#171c24` |
| `--ink` / `--ink-2` / `--muted` | `#eef1f6` / `#cfd5df` / `#9aa4b2` |
| `--line` / `--line-2` | `#262d38` / `#343d4b` |
| `--brand` / `--brand-d` / `--brand-l` | `#34c398` / `#2aa982` / `#12362c` |
| `--ok` · `--warn` · `--bad` · `--info` | `#54c985` · `#e9b350` · `#f08174` · `#78aaee` |

En oscuro: el fondo de página es plano, los bordes de tarjeta vuelven a `--line`, el bloque crema pasa a `#3a3012` y los acentos se aclaran. Se comprueba el contraste por separado.

---

## 9. Accesibilidad

- **Contraste:** texto normal ≥ 4,5:1, texto grande y componentes ≥ 3:1. En claro y en oscuro.
- **Teclado:** todo se alcanza con Tab, en orden visual, con foco visible. Los modales atrapan el foco y se cierran con Esc.
- **Etiquetas:** cada campo con `label`; cada botón de icono con `aria-label`; los grupos de opciones con `role="radiogroup"`.
- **Color no basta:** estados con texto o icono además del color.
- **Movimiento reducido:** respetar la preferencia del sistema.
- **Zoom:** nunca bloquear el zoom del usuario. Texto de 16 px mínimo en campos del teléfono.
- **Jerarquía:** un solo `h1` por pantalla, sin saltarse niveles.

---

## 10. Rendimiento y portabilidad

- Sin dependencias externas para estilos ni iconos: una hoja de estilos y SVG en línea. Funciona en red local sin internet.
- Animar solo `transform` y `opacity`. Nada de animar ancho, alto o márgenes.
- Imágenes con medidas declaradas para evitar saltos. Logos y comprobantes con límite de tamaño.
- Una hoja compartida (`styles.css`) y, para teléfono, una hoja de capa (`app-movil.css`) cargada después.

---

## 11. Qué sí y qué no

**Sí**
- Colores plenos para lo que importa y blanco para el resto.
- Una acción principal por pantalla.
- Textos que dicen qué pasó y qué sigue.
- Probar cada pantalla a 375 px, 768 px y escritorio.

**No**
- Colores escritos a mano dentro de un componente.
- Emojis como iconos de interfaz.
- Más de un botón dorado en la misma pantalla.
- Texto gris sobre fondo gris, o menos de 12 px en cuerpo de texto.
- Tablas que desplazan la página entera.
- Quitar el contorno de foco.
- Información que solo se distingue por el color.

---

## 12. Lista de comprobación antes de entregar

- [ ] Todo el color sale de variables; el modo oscuro se ve bien.
- [ ] Un solo botón principal por pantalla y el peligroso separado.
- [ ] Títulos en banda marino; KPI en cuatro colores; tablas con cabecera marino.
- [ ] Zonas táctiles ≥ 48 px en teléfono; sin desplazamiento horizontal de la página.
- [ ] Foco visible y navegación completa con teclado.
- [ ] Contraste revisado en claro y en oscuro.
- [ ] Estados vacíos, de carga y de error con mensaje útil.
- [ ] El menú conserva su posición y marca la opción activa.
- [ ] Ventanas con salida clara; en teléfono suben desde abajo.
- [ ] Probado a 375 px, 768 px y 1440 px.

---

## 13. Hoja base para empezar

Pegar al inicio de la hoja de estilos de una app nueva. Con esto y los componentes de las secciones anteriores se obtiene la misma identidad.

```css
:root {
  --bg:#f6f7f9; --panel:#fff; --ink:#111827; --ink-2:#374151; --muted:#6b7280; --line:#e7e9ee; --line-2:#d5d9e0;
  --navy:#0b1b34; --navy-2:#12284a; --brand:#0a7a5a; --brand-d:#07654a; --brand-l:#e6f5ef; --brand-ring:rgba(10,122,90,.22);
  --mint:#34c398; --azul:#1556c0; --azul-d:#0f3f93; --oro:#f5b301; --crema:#fff3cf; --crema-b:#f2dc9a;
  --ok:#17803f; --ok-l:#e5f6ec; --warn:#a15c07; --warn-l:#fff5dc; --bad:#c23a2e; --bad-l:#fdeceb; --info:#2459a8; --info-l:#e8f0fb;
  --r1:8px; --r2:12px; --r3:16px;
  --sh1:0 1px 2px rgba(17,24,39,.04);
  --sh2:0 1px 2px rgba(17,24,39,.04),0 6px 20px rgba(17,24,39,.05);
  --sh3:0 24px 64px rgba(17,24,39,.28);
  --t:160ms cubic-bezier(.2,.7,.3,1);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-tema="claro"]) {
    --bg:#0e1218; --panel:#171c24; --ink:#eef1f6; --ink-2:#cfd5df; --muted:#9aa4b2; --line:#262d38; --line-2:#343d4b;
    --brand:#34c398; --brand-d:#2aa982; --brand-l:#12362c; --brand-ring:rgba(52,195,152,.28);
    --ok:#54c985; --ok-l:#143420; --warn:#e9b350; --warn-l:#392d12; --bad:#f08174; --bad-l:#3e1f1b; --info:#78aaee; --info-l:#172944;
  }
}
* { box-sizing: border-box; }
body { margin:0; background:linear-gradient(180deg,#e3eefc 0,#eef3fb 320px,var(--bg) 700px) fixed; color:var(--ink);
  font:14px/1.5 Inter,"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
.card { background:var(--panel); border:1px solid transparent; border-top:3px solid var(--azul); border-radius:var(--r3); padding:24px; box-shadow:var(--sh2); margin-bottom:20px; }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:40px; padding:9px 16px; border:2px solid #cfdcf2; border-radius:var(--r1); background:var(--panel); font:inherit; font-weight:700; cursor:pointer; box-shadow:var(--sh1); transition:background var(--t),border-color var(--t),transform var(--t); }
.btn:hover { border-color:var(--azul); background:#eef4ff; } .btn:active { transform:translateY(1px); }
.btn:focus-visible { outline:none; box-shadow:0 0 0 3px var(--brand-ring); }
.btn.pri { background:linear-gradient(180deg,#12926d,var(--brand)); border-color:var(--brand); color:#fff; }
.btn-cobrar { background:linear-gradient(180deg,#ffc82e,var(--oro)); border-color:var(--oro); color:#3a2a00; font-size:20px; font-weight:800; min-height:60px; box-shadow:0 10px 24px rgba(245,179,1,.4); }
input,select,textarea { width:100%; min-height:40px; padding:9px 12px; background:var(--panel); border:2px solid #d4def0; border-radius:var(--r1); font:inherit; color:inherit; }
input:focus,select:focus,textarea:focus { outline:none; border-color:var(--azul); box-shadow:0 0 0 4px rgba(21,86,192,.18); }
@media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
```

---

## 14. Dónde está cada cosa en Abasto Cloud

| Qué | Archivo |
|---|---|
| Tokens y componentes del sistema | `public/styles.css` |
| Capa de teléfono (cliente y repartidor) | `public/app-movil.css` |
| Menú, iconos, navegación, acceso | `public/core.js` |
| Selector de productos con modo asistido | `public/v_fin.js` |
| Calificación con estrellas (cliente) | `public/tienda/tienda.js` |

Para una app nueva: copiar `styles.css` y `app-movil.css`, cambiar los tokens de marca si hace falta y construir las pantallas con las clases ya definidas (`.card`, `.kpi`, `.grid g2/g3/g4`, `.btn`, `.tag`, `.chip`, `.semaforo`, `.mosaico`, etc.).
