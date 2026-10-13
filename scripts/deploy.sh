#!/usr/bin/env bash
# Despliegue automático en el VPS: deja el repo en origin/main y reinicia el servicio.
#
#   bash scripts/deploy.sh
#
# Modo (variable ABASTO_DEPLOY_MODO): "auto" (por defecto), "docker" o "systemd".
# En auto usa docker si existe el contenedor "abasto", si no systemd.
# Las variables de entorno van en .env junto al repo (gitignored); el sistema
# NO lee ese archivo, lo leen docker (--env-file) o systemd (EnvironmentFile).
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

echo "[deploy] $(date -Is) $RAIZ -> origin/main (modo $MODO)"

git fetch --quiet origin
git checkout --quiet main
git reset --hard --quiet origin/main

case "$MODO" in
  docker)
    [ -f "$RAIZ/.env" ] || { echo "[deploy] Falta $RAIZ/.env" >&2; exit 1; }
    docker build --quiet -t abasto-cloud .
    docker rm -f abasto >/dev/null 2>&1 || true
    docker run -d --name abasto --restart unless-stopped \
      -p 127.0.0.1:8080:8080 \
      -v "$RAIZ/data:/data" \
      --env-file "$RAIZ/.env" \
      abasto-cloud
    ;;
  systemd)
    npm ci --omit=dev
    systemctl restart abasto
    ;;
  *)
    echo "[deploy] Modo desconocido: $MODO" >&2
    exit 1
    ;;
esac

PUERTO="${PORT:-8080}"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PUERTO/api/health" >/dev/null 2>&1; then
    echo "[deploy] OK: servicio arriba en $(date -Is)"
    exit 0
  fi
  sleep 1
done

echo "[deploy] ERROR: /api/health no respondió tras el rearranque" >&2
exit 1
