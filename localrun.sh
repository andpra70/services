#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="${SCRIPT_DIR}/client"
SERVER_DIR="${SCRIPT_DIR}/server"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

SERVER_PORT="${SERVER_PORT:-4000}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
VOLUME_ROOT="${VOLUME_ROOT:-${SCRIPT_DIR}/data/files}"
APP_BASE="${APP_BASE:-/fileserver/}"
VITE_APP_BASE="${VITE_APP_BASE:-${APP_BASE}}"
VITE_API_BASE="${VITE_API_BASE:-api}"
VITE_OAUTH_PROXY_TARGET="${VITE_OAUTH_PROXY_TARGET:-${OAUTH_ISSUER:-http://localhost:9000}}"
VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER:-http://localhost:${CLIENT_PORT}/oauth-server}"
VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL:-http://localhost:${CLIENT_PORT}/oauth-server/app/assets/authWidget.js}"
VITE_OAUTH_REDIRECT_URI="${VITE_OAUTH_REDIRECT_URI:-http://localhost:5173/fileserver/}"
VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY:-oauth-authWidget}"
OAUTH_ISSUER="${OAUTH_ISSUER:-${VITE_OAUTH_ISSUER}}"
PIDS=()

if [[ "${VOLUME_ROOT}" != /* ]]; then
  VOLUME_ROOT="${SCRIPT_DIR}/${VOLUME_ROOT#./}"
fi

echo "Starting development environment..."
echo OAUTH_ISSUER="${OAUTH_ISSUER}"
echo VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER}"
echo VITE_OAUTH_REDIRECT_URI="${VITE_OAUTH_REDIRECT_URI}"
echo VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL}"
echo VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY}"
echo VITE_OAUTH_PROXY_TARGET="${VITE_OAUTH_PROXY_TARGET}"

  
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

mkdir -p "${VOLUME_ROOT}"

(
  cd "${SERVER_DIR}"
  PORT="${SERVER_PORT}" \
  VOLUME_ROOT="${VOLUME_ROOT}" \
  CORS_ORIGIN="http://localhost:${CLIENT_PORT}" \
  APP_BASE="${APP_BASE}" \
  OAUTH_ISSUER="${OAUTH_ISSUER}" \
  npm run dev 2>&1 | sed -u 's/^/[server] /'
) &
PIDS+=("$!")

(
  cd "${CLIENT_DIR}"
  VITE_APP_BASE="${VITE_APP_BASE}" \
  VITE_API_BASE="${VITE_API_BASE}" \
  VITE_OAUTH_ISSUER="${VITE_OAUTH_ISSUER}" \
  VITE_OAUTH_COMPONENT_URL="${VITE_OAUTH_COMPONENT_URL}" \
  VITE_OAUTH_REDIRECT_URI="${VITE_OAUTH_REDIRECT_URI}" \
  VITE_OAUTH_STORAGE_KEY="${VITE_OAUTH_STORAGE_KEY}" \
  VITE_OAUTH_PROXY_TARGET="${VITE_OAUTH_PROXY_TARGET}" \
  npm run dev -- --host 0.0.0.0 --port "${CLIENT_PORT}" 2>&1 | sed -u 's/^/[client] /'
) &
PIDS+=("$!")

printf 'Server API: http://localhost:%s\n' "${SERVER_PORT}"
printf 'Client dev: http://localhost:%s%s\n' "${CLIENT_PORT}" "${APP_BASE}"

wait
