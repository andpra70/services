#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

REGISTRY="${REGISTRY:-docker.io/andpra70}"
IMAGE_NAME="${IMAGE_NAME:-fileserver}"
TAG="${TAG:-latest}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
VITE_API_BASE="${VITE_API_BASE:-/api}"
VITE_APP_BASE="${VITE_APP_BASE:-./}"
VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER:-}"
VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY:-fileserver-oauth-widget}"
VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL:-}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

docker build \
  --build-arg APP_UID="${APP_UID}" \
  --build-arg APP_GID="${APP_GID}" \
  --build-arg VITE_API_BASE="${VITE_API_BASE}" \
  --build-arg VITE_APP_BASE="${VITE_APP_BASE}" \
  --build-arg VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER}" \
  --build-arg VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY}" \
  --build-arg VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL}" \
  -t "${FULL_IMAGE}" .
docker push "${FULL_IMAGE}"

printf 'Pushed image: %s\n' "${FULL_IMAGE}"
