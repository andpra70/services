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
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
VITE_API_BASE="${VITE_API_BASE:-api}"
VITE_APP_BASE="${VITE_APP_BASE:-/fileserver/}"
VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER:-}"
VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY:-oauth-authWidget}"
VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL:-}"
VITE_OAUTH_REDIRECT_URI="${VITE_OAUTH_REDIRECT_URI:-}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

docker build \
  --build-arg APP_UID="${APP_UID}" \
  --build-arg APP_GID="${APP_GID}" \
  --build-arg VITE_API_BASE="${VITE_API_BASE}" \
  --build-arg VITE_APP_BASE="${VITE_APP_BASE}" \
  --build-arg VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER}" \
  --build-arg VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY}" \
  --build-arg VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL}" \
  --build-arg VITE_OAUTH_REDIRECT_URI="${VITE_OAUTH_REDIRECT_URI}" \
  -t "${FULL_IMAGE}" .
docker push "${FULL_IMAGE}"

printf 'Pushed image: %s\n' "${FULL_IMAGE}"
