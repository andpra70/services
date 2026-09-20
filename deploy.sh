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
VITE_APP_BASE="${VITE_APP_BASE:-/fileserver/}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

docker build \
  --build-arg VITE_APP_BASE="${VITE_APP_BASE}" \
  -t "${FULL_IMAGE}" .
docker push "${FULL_IMAGE}"

printf 'Pushed image: %s\n' "${FULL_IMAGE}"
