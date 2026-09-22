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
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
NETWORK="${NETWORK:-front-controller_internal-services}"
REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
S3_ENDPOINT="${S3_ENDPOINT:-http://minio:9000}"
S3_REGION="${S3_REGION:-us-east-1}"
S3_BUCKET="${S3_BUCKET:-public-assets}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-vfsadmin}"
: "${S3_SECRET_KEY:?Set S3_SECRET_KEY in the environment or ENV_FILE}"
OIDC_ISSUER="${OIDC_ISSUER:-http://oauth-server:9000/oauth-server}"
OIDC_USERINFO_URL="${OIDC_USERINFO_URL:-${OIDC_ISSUER%/}/me}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://localhost}"

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  docker stop "${CONTAINER_NAME}" >/dev/null
  docker rm "${CONTAINER_NAME}" >/dev/null
fi

docker pull "${FULL_IMAGE}"

docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --network "${NETWORK}" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -e PORT="${CONTAINER_PORT}" \
  -e REDIS_URL="${REDIS_URL}" \
  -e S3_ENDPOINT="${S3_ENDPOINT}" \
  -e S3_REGION="${S3_REGION}" \
  -e S3_BUCKET="${S3_BUCKET}" \
  -e S3_ACCESS_KEY="${S3_ACCESS_KEY}" \
  -e S3_SECRET_KEY="${S3_SECRET_KEY}" \
  -e OIDC_ISSUER="${OIDC_ISSUER}" \
  -e OIDC_USERINFO_URL="${OIDC_USERINFO_URL}" \
  -e ALLOWED_ORIGINS="${ALLOWED_ORIGINS}" \
  "${FULL_IMAGE}"

printf 'Container: %s\n' "${CONTAINER_NAME}"
printf 'Image: %s\n' "${FULL_IMAGE}"
printf 'URL: http://localhost:%s\n' "${HOST_PORT}"
printf 'VFS widget: http://localhost:%s/widget.js\n' "${HOST_PORT}"
