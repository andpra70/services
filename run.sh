#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env.prod}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

REGISTRY="${REGISTRY:-docker.io/andpra70}"
IMAGE_NAME="${IMAGE_NAME:-fileserver}"
TAG="${TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-fileserver}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
DATA_DIR="${DATA_DIR:-${SCRIPT_DIR}/data/files}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
APP_BASE="${APP_BASE:-/fileserver/}"
OAUTH_ISSUER="${OAUTH_ISSUER:-http://localhost:9000}"
OAUTH_ALLOW_SELF_SIGNED_TLS="${OAUTH_ALLOW_SELF_SIGNED_TLS:-false}"
CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:${HOST_PORT}}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

mkdir -p "${DATA_DIR}"

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  docker stop "${CONTAINER_NAME}" >/dev/null
  docker rm "${CONTAINER_NAME}" >/dev/null
fi

docker pull "${FULL_IMAGE}"

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -e PORT="${CONTAINER_PORT}" \
  -e APP_BASE="${APP_BASE}" \
  -e CLIENT_DIST=/app/client-dist \
  -e VOLUME_ROOT=/data \
  -e CORS_ORIGIN="${CORS_ORIGIN}" \
  -e MAX_EDITABLE_BYTES=26214400 \
  -e OAUTH_ISSUER="${OAUTH_ISSUER}" \
  -e OAUTH_ALLOW_SELF_SIGNED_TLS="${OAUTH_ALLOW_SELF_SIGNED_TLS}" \
  -v "${DATA_DIR}:/data" \
  "${FULL_IMAGE}"

printf 'Container: %s\n' "${CONTAINER_NAME}"
printf 'Image: %s\n' "${FULL_IMAGE}"
printf 'URL: http://localhost:%s\n' "${HOST_PORT}"
printf 'Data dir: %s\n' "${DATA_DIR}"
printf 'Expected host ownership: %s:%s\n' "${APP_UID}" "${APP_GID}"
