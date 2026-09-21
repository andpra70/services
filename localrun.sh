#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
CLIENT_PORT="${CLIENT_PORT:-5173}"
VITE_APP_BASE="${VITE_APP_BASE:-/fileserver/}"
VITE_FRONT_CONTROLLER_URL="${VITE_FRONT_CONTROLLER_URL:-https://127.0.0.1:8443}"
VITE_BACKEND_HOST="${VITE_BACKEND_HOST:-belle.iliadboxos.it}"
VITE_PROXY_LOG="${VITE_PROXY_LOG:-true}"

npm --prefix client install

printf 'Proxy auth: %s/auth -> %s\n' "${VITE_FRONT_CONTROLLER_URL}" "${VITE_BACKEND_HOST}"
printf 'Proxy VFS:  %s/vfs  -> %s\n' "${VITE_FRONT_CONTROLLER_URL}" "${VITE_BACKEND_HOST}"
printf 'Proxy log:  %s\n' "${VITE_PROXY_LOG}"

VITE_APP_BASE="${VITE_APP_BASE}" \
VITE_FRONT_CONTROLLER_URL="${VITE_FRONT_CONTROLLER_URL}" \
VITE_BACKEND_HOST="${VITE_BACKEND_HOST}" \
VITE_PROXY_LOG="${VITE_PROXY_LOG}" \
npm --prefix client run dev -- --host 0.0.0.0 --port "${CLIENT_PORT}"
