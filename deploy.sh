#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

REGISTRY="${REGISTRY:-docker.io/andpra70}"
IMAGE_NAME="${IMAGE_NAME:-fileserver}"
TAG="${TAG:-latest}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

docker build \
  --build-arg APP_UID="${APP_UID}" \
  --build-arg APP_GID="${APP_GID}" \
  -t "${FULL_IMAGE}" .
docker push "${FULL_IMAGE}"

printf 'Pushed image: %s\n' "${FULL_IMAGE}"
