#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="${SCRIPT_DIR}/client"
SERVER_DIR="${SCRIPT_DIR}/server"
SERVER_PORT="${SERVER_PORT:-4000}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
VOLUME_ROOT="${VOLUME_ROOT:-${SCRIPT_DIR}/data/files}"
OAUTH_ISSUER="${OAUTH_ISSUER:-http://localhost:9000}"
PIDS=()

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
  OAUTH_ISSUER="${OAUTH_ISSUER}" \
  npm run dev
) &
PIDS+=("$!")

(
  cd "${CLIENT_DIR}"
  npm run dev -- --host 0.0.0.0 --port "${CLIENT_PORT}"
) &
PIDS+=("$!")

printf 'Server API: http://localhost:%s\n' "${SERVER_PORT}"
printf 'Client dev: http://localhost:%s\n' "${CLIENT_PORT}"

wait
