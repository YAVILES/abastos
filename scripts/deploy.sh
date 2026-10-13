#!/usr/bin/env bash
# Despliegue automático en el VPS: deja el repo en origin/main y reinicia el servicio.
#
#   bash scripts/deploy.sh
#
# Modo (variable ABASTO_DEPLOY_MODO): "auto" (por defecto), "docker" o "systemd".
# En auto usa docker si existe el contenedor "abasto", si no systemd.
# Las variables de entorno van en .env junto al repo (gitignored); el sistema
# NO lee ese archivo, lo leen docker (--env-file) o systemd (EnvironmentFile).
# El puerto de escucha y de la verificación de salud sale del .env (PORT);
# si usas otro puerto, ajústalo también en el proxy_pass de Nginx.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

exec 9>/tmp/abasto-deploy.lock
flock -n 9 || { echo "[deploy] Ya hay un despliegue en curso, saliendo"; exit 1; }

MODO="${ABASTO_DEPLOY_MODO:-auto}"
if [ "$MODO" = "auto" ]; then
  if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx abasto; then
    MODO=docker
  else
    MODO=systemd
  fi
fi

# Node que usará el servicio: en systemd sale del ExecStart de la unidad (puede ser
# /usr/bin/node o un binario de nvm); en docker corre dentro de la imagen. GitHub Actions
# entra por SSH sin cargar nvm, así que ponemos ese Node al frente del PATH para que
# "npm ci" use su npm (uno viejo no lee bien el package-lock.json).
NODE_BIN=node
if [ "$MODO" = "systemd" ] && [ -f /etc/systemd/system/abasto.service ]; then
  N="$(awk -F= '/^ExecStart=/{print $2; exit}' /etc/systemd/system/abasto.service | awk '{print $1}')"
  [ -x "$N" ] && NODE_BIN="$N"
fi
if [ "$MODO" != "docker" ]; then
  export PATH="$(dirname "$NODE_BIN"):$PATH"
fi

# La app depende de node:sqlite (Node >= 22.13); si no, el servicio muere al arrancar.
if [ "$MODO" != "docker" ]; then
  if ! "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
    echo "[deploy] ERROR: $NODE_BIN ($("$NODE_BIN" --version 2>/dev/null | tr -d '\n')) es demasiado viejo; se requiere Node >= 22.13" >&2
    exit 1
  fi
fi

echo "[deploy] $(date -Is) $RAIZ -> origin/main (modo $MODO)"

[ -f "$RAIZ/.env" ] || { echo "[deploy] Falta $RAIZ/.env (PORT, DATA_DIR, claves...)" >&2; exit 1; }

# Puerto: del .env (obligatorio tenerlo), salvo que se pase PORT en el entorno.
PUERTO_ENV="$(grep -E '^[[:space:]]*PORT=' "$RAIZ/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
PUERTO="${PORT:-${PUERTO_ENV:-8080}}"

git fetch --quiet origin
git checkout --quiet main
git reset --hard --quiet origin/main

case "$MODO" in
  docker)
    docker build --quiet -t abasto-cloud .
    docker rm -f abasto >/dev/null 2>&1 || true
    docker run -d --name abasto --restart unless-stopped \
      -p "127.0.0.1:$PUERTO:$PUERTO" \
      -v "$RAIZ/data:/data" \
      --env-file "$RAIZ/.env" \
      abasto-cloud
    ;;
  systemd)
    rm -rf node_modules          # instalación limpia: evita node_modules de otro npm/versión
    npm ci --omit=dev
    systemctl restart abasto
    ;;
  *)
    echo "[deploy] Modo desconocido: $MODO" >&2
    exit 1
    ;;
esac

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PUERTO/api/health" >/dev/null 2>&1; then
    echo "[deploy] OK: servicio arriba en $(date -Is)"
    exit 0
  fi
  sleep 1
done

echo "[deploy] ERROR: /api/health no respondió tras el rearranque" >&2
exit 1
