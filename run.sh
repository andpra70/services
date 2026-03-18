#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

REGISTRY="${REGISTRY:-docker.io/andpra70}"
IMAGE_NAME="${IMAGE_NAME:-fileserver}"
TAG="${TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-fileserver}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-8080}"
DATA_DIR="${DATA_DIR:-${SCRIPT_DIR}/data}"
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
  -e APP_BASE=/ \
  -e CLIENT_DIST=/app/client-dist \
  -e VOLUME_ROOT=/data \
  -e CORS_ORIGIN="http://localhost:${HOST_PORT}" \
  -e MAX_EDITABLE_BYTES=1048576 \
  -v "${DATA_DIR}:/data" \
  "${FULL_IMAGE}"

printf 'Container: %s\n' "${CONTAINER_NAME}"
printf 'Image: %s\n' "${FULL_IMAGE}"
printf 'URL: http://localhost:%s\n' "${HOST_PORT}"
printf 'Data dir: %s\n' "${DATA_DIR}"
