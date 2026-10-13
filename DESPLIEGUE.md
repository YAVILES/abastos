# Publicar Abasto Cloud en internet

La app guarda todo en archivos SQLite (una base por abasto más una de la plataforma), así que necesita
un servidor con **disco persistente** y **una sola instancia**. Por eso no sirve el plan gratuito de Render
(su disco se borra en cada reinicio) y por eso no se usó Turso como en la panadería: el código de esta app
consulta la base de forma síncrona y pasarla a Turso exigiría reescribirla casi completa. El camino más corto
es un servidor pequeño con disco.

Esta guía usa Fly.io porque ya quedó configurado (`fly.toml` y `Dockerfile`). Cualquier VPS con Docker
sirve igual (ver al final). No se publicó nada todavía: hace falta tu cuenta.

## 1. Fly.io

Instala `flyctl` (<https://fly.io/docs/flyctl/install/>), crea la cuenta y, desde esta carpeta:

```bash
fly auth login
fly launch --no-deploy --copy-config      # acepta el fly.toml; cambia el nombre de la app si hace falta
fly volumes create abasto_data --size 1 --region mia
fly secrets set ADMIN_PASSWORD="una-clave-larga" PLATAFORMA_CLAVE="otra-clave-larga"
fly deploy
```

- `ADMIN_PASSWORD` es la clave del admin de la empresa `principal` que se crea sola. Si no vas a usar esa
  empresa, igual hay que definirla o se genera una al azar (la verás en `fly ssh console`, archivo `/data/PRIMER_ACCESO.txt`).
- `PLATAFORMA_CLAVE` es la clave del operador del panel `/plataforma/`. Sin ella se genera una al azar en
  `/data/PLATAFORMA_ACCESO.txt`.
- Mantén **una sola máquina**: `fly scale count 1`. Con dos, cada una tendría su propio disco y los datos se partirían.
- La URL queda en `https://<nombre-de-la-app>.fly.dev`. HTTPS lo pone Fly.

## 2. Primer uso

1. Entra a `https://<app>.fly.dev/plataforma/` con usuario `plataforma`.
2. **Nuevo abasto**: nombre, código y precio. El panel muestra una sola vez la clave del admin y los enlaces:
   - Sistema del abasto: `https://<app>.fly.dev/?e=<codigo>`
   - App de clientes: `https://<app>.fly.dev/tienda/<codigo>/` (se instala como app desde el navegador del celular)
3. Cada pago de licencia se registra con **Registrar pago**: suma los meses desde el vencimiento (o desde hoy si ya venció).

Reglas de licencia: vence → 5 días de gracia con aviso → después queda en **solo lectura** (se puede consultar
todo, no registrar nada) → **Suspendida** la bloquea por completo. La app de clientes muestra "cerrado" cuando no
hay licencia vigente.

Si no vas a ofrecer el servicio a varios abastos, puedes usar solo la empresa `principal` y ignorar el panel.

## 3. Reconocimiento de productos por foto

Se activa definiendo la credencial de la API de Claude como secreto:

```bash
fly secrets set ANTHROPIC_API_KEY="sk-ant-..."
```

- Por defecto usa `claude-opus-5-5`. Cada reconocimiento cuesta en el orden de centavos de dólar (la foto más el
  catálogo del abasto, que se guarda en caché). Para abaratarlo mucho puedes probar un modelo más pequeño:
  `fly secrets set RECONOCER_MODELO="claude-haiku-5-5"`. Conviene probar la precisión con productos reales antes de cambiarlo.
- Cada abasto tiene un tope mensual de fotos (por defecto 200; se cambia en el panel). Así el costo queda acotado
  y puedes incluirlo en el precio del plan.
- Las fotos se envían a la API de Anthropic para analizarlas y no se guardan en este sistema. Avísalo a tus clientes.

## 4. Respaldos

- El servidor guarda una copia diaria de cada abasto y de la plataforma en `/data/respaldos` y conserva las últimas 14
  (`RESPALDOS_CONSERVAR` lo cambia).
- Esa carpeta está en el mismo disco que los datos. Si se pierde el disco, se pierden también. Dos protecciones simples:
  - Cada dueño puede descargar su base desde **Parámetros › Negocio › Descargar respaldo**.
  - Fly toma instantáneas diarias del volumen; verifica en su documentación cuántos días las conserva y consideralo un
    extra, no tu única copia. Para una copia fuera de Fly: `fly ssh sftp get /data/respaldos/<codigo>/<fecha>.db`.
- Para restaurar: detén la app, reemplaza `/data/empresas/<codigo>.db` por la copia y arranca de nuevo.

## 5. Seguridad mínima antes de abrirlo al público

- Usa claves largas en `ADMIN_PASSWORD` y `PLATAFORMA_CLAVE`, y cámbiala del admin en Parámetros › Usuarios.
- `/plataforma/` es público en internet (con login y límite de intentos). Si quieres, limítalo por IP en un proxy.
- `TRUST_PROXY=1` hace que el límite de intentos use la IP real detrás del proxy de Fly. No lo actives si el servidor
  está expuesto sin proxy, porque cualquiera podría falsificar esa cabecera.

## Alternativa: un VPS con despliegue automático

Cualquier VPS con Ubuntu 22.04/24.04 sirve. Con `scripts/deploy.sh`, cada `git push` a `main`
despliega solo si las pruebas pasan.

### 1. Preparar el VPS (una sola vez)

```bash
apt update && apt upgrade -y
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
apt install -y curl git
cd /opt && git clone https://github.com/YAVILES/abastos.git && cd abastos
```

Crea `/opt/abastos/.env` (gitignored; lo leen docker con `--env-file` o systemd con `EnvironmentFile`):

```
PORT=8080
DATA_DIR=/opt/abastos/data
TRUST_PROXY=1
ADMIN_PASSWORD=una-clave-larga
PLATAFORMA_CLAVE=otra-clave-larga
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Servicio: Docker o systemd

**Docker:**

```bash
curl -fsSL https://get.docker.com | sh
cd /opt/abastos && bash scripts/deploy.sh    # detecta docker, construye y levanta el contenedor "abasto"
```

**systemd:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
cd /opt/abastos && bash scripts/deploy.sh    # detecta systemd, corre npm ci y reinicia "abasto"
```

La unidad `/etc/systemd/system/abasto.service` (ajusta las rutas si no clonaste en `/opt/abastos`):

```ini
[Unit]
Description=Abasto Cloud
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/abastos
ExecStart=/usr/bin/node --no-warnings server.js
Restart=on-failure
EnvironmentFile=/opt/abastos/.env

[Install]
WantedBy=multi-user.target
```

`scripts/deploy.sh` siempre deja el repo en `origin/main`, reconstruye/reinicia y verifica
`http://127.0.0.1:8080/api/health`; si no responde, sale con error. Elige el modo con
`ABASTO_DEPLOY_MODO=docker|systemd` (por defecto lo detecta solo).

### 3. HTTPS con Nginx y Certbot

Como ya tienes Nginx y Certbot en el VPS, agrega un sitio más. `/etc/nginx/sites-available/abasto`:

```nginx
server {
    listen 80;
    server_name tuabasto.com;

    client_max_body_size 25m;   # las fotos de reconocimiento y el logo viajan en base64 dentro del JSON

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/abasto /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d tuabasto.com      # emite el certificado y agrega la redirección a HTTPS
```

La app no usa websockets (la app del repartidor consulta cada 10 segundos), así que no hace falta
configurar `Upgrade`. El HTTPS es necesario para la app de clientes y la cámara en el celular.
`TRUST_PROXY=1` solo tiene sentido con este proxy delante, como está en el `.env` de arriba.

### 4. Automático desde GitHub

El workflow `.github/workflows/deploy.yml` corre `npm test` y, si pasan, entra por SSH al VPS y
ejecuta `scripts/deploy.sh`. Define en el repo (Settings › Secrets and variables › Actions):

| Secreto | Contenido |
|---|---|
| `VPS_HOST` | IP o dominio del VPS |
| `VPS_USER` | usuario SSH (root, o uno con permisos para `systemctl restart abasto` o docker) |
| `VPS_SSH_KEY` | llave privada SSH (la pública va en `~/.ssh/authorized_keys` del VPS) |
| `VPS_PORT` | opcional, 22 por defecto |

Desde entonces, cada push a `main` (o **Run workflow** a mano) despliega si las pruebas pasan.

**Si prefieres sin GitHub Actions:** un cron que pregunta por cambios cada minuto
(`crontab -e`: `* * * * * cd /opt/abastos && git fetch --quiet origin main && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ] && bash scripts/deploy.sh >> /var/log/abasto-deploy.log 2>&1`),
o un webhook (`apt install webhook`) apuntando a `https://tuabasto.com/hooks/...` detrás de Caddy.

### 5. Respaldos

Una copia diaria con cron fuera del VPS (`rsync`/`rclone` de `data/respaldos/`), porque los
respaldos del sistema quedan en el mismo disco. Mantén **una sola instancia**: la base es SQLite.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `PORT` | Puerto (3300 por defecto) |
| `DATA_DIR` | Dónde se guardan las bases (`./data` por defecto) |
| `ADMIN_PASSWORD` | Clave inicial del admin de la empresa `principal` |
| `EMPRESA_NOMBRE` | Nombre de la empresa `principal` al crearla |
| `PLATAFORMA_CLAVE` | Clave inicial del operador `plataforma` |
| `ANTHROPIC_API_KEY` | Activa el reconocimiento por foto |
| `RECONOCER_MODELO` | Modelo del reconocimiento (`claude-opus-5-5` por defecto) |
| `TRUST_PROXY` | `1` detrás de un proxy con HTTPS |
| `RESPALDOS_DIR`, `RESPALDOS_CONSERVAR` | Carpeta y cantidad de respaldos diarios |
