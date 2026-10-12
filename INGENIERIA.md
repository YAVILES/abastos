# Abasto Cloud: notas para el equipo de ingeniería

Sistema de inventario, punto de venta, caja multimoneda, pedidos por app y reparto para minis abastos.
Este documento resume lo que hace falta para ponerlo en internet. La guía paso a paso de Fly.io está en
`DESPLIEGUE.md`; el detalle funcional, en `README.md`.

## Qué es

- Node 22 o superior con `node:sqlite`. La única dependencia es `@anthropic-ai/sdk` (solo para el reconocimiento por foto).
- Un solo proceso (`npm start`, puerto `PORT`, por defecto 3300) que sirve la API, el sistema administrativo y tres apps web:
  - `/` sistema administrativo (`/?e=<codigo>` fija la empresa)
  - `/tienda/<codigo>/` app de clientes (PWA)
  - `/reparto/<codigo>/` app de repartidores (PWA)
  - `/plataforma/` panel del operador (altas de abastos, licencias, pagos)
- Multiempresa: una base SQLite por empresa en `DATA_DIR/empresas/<codigo>.db` y una de la plataforma en `DATA_DIR/plataforma.db`.
- Respaldos diarios automáticos con `VACUUM INTO` en `RESPALDOS_DIR` (se conservan `RESPALDOS_CONSERVAR`, 14 por defecto).

## Lo que necesita el servidor

1. **Disco persistente** montado en `DATA_DIR`. Sin él se pierden los datos en cada reinicio.
2. **Una sola instancia.** SQLite sincrónico: no escalar a varias réplicas ni usar discos compartidos.
3. **HTTPS con dominio propio.** Las apps de clientes y repartidores se instalan como PWA y las notificaciones
   necesitan HTTPS. Detrás de un proxy, definir `TRUST_PROXY=1`.
4. Dominio o subdominio apuntando al servicio, por ejemplo `abasto.<dominio>`.
5. Copia de los respaldos fuera del servidor (hoy solo quedan en el mismo disco).

## Variables de entorno

Ver `.env.example` (el servidor no lee archivos `.env`: las variables se definen en el entorno). Las claves van como secretos del proveedor, nunca en el repositorio.

| Variable | Para qué |
|---|---|
| `PORT` | Puerto HTTP (3300 por defecto) |
| `DATA_DIR` | Carpeta de datos (bases SQLite, accesos iniciales, respaldos) |
| `ADMIN_PASSWORD` | Clave del admin de la empresa `principal` que se crea sola. Si falta, se genera una y queda en `DATA_DIR/PRIMER_ACCESO.txt` |
| `PLATAFORMA_CLAVE` | Clave del operador del panel `/plataforma/`. Si falta, se genera en `DATA_DIR/PLATAFORMA_ACCESO.txt` |
| `EMPRESA_NOMBRE` | Nombre de la empresa `principal` |
| `TRUST_PROXY` | `1` si hay proxy o balanceador delante |
| `ANTHROPIC_API_KEY` | Activa el reconocimiento de productos por foto (opcional) |
| `RECONOCER_MODELO` | Modelo para el reconocimiento (opcional) |
| `RESPALDOS_DIR`, `RESPALDOS_CONSERVAR` | Dónde y cuántos respaldos guardar |

## Pruebas

```bash
npm test      # plan de conteos + 29 bloques de humo (API completa sobre una base temporal)
npm run demo  # carga la empresa demo con datos de ejemplo
```

## Pendiente o por validar en producción

- El reconocimiento por foto solo se probó contra un servicio simulado, no contra la API real.
- Notificaciones push al repartidor: la app está lista para usarlas, pero requieren HTTPS y no se han probado en un teléfono real.
- Lector de código de barras por cámara o puerto serial: no probado con hardware real.
- El cobro de licencias es manual (se registra el pago en el panel de la plataforma).
- No hay límite de intentos por IP más allá del de inicio de sesión; conviene poner un proxy con límites.
- El balance general es de la fecha actual y aún no registra activos fijos ni préstamos.
