#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_PORT="${CLIENT_PORT:-5173}"
SERVER_PORT="${SERVER_PORT:-8080}"
VITE_APP_BASE="${VITE_APP_BASE:-/fileserver/}"
VITE_FRONT_CONTROLLER_URL="${VITE_FRONT_CONTROLLER_URL:-https://localhost}"
VITE_VFS_SERVER_URL="${VITE_VFS_SERVER_URL:-http://localhost:${SERVER_PORT}}"

: "${REDIS_URL:?Set REDIS_URL for the local VFS backend}"
: "${S3_ENDPOINT:?Set S3_ENDPOINT for the local VFS backend}"
: "${S3_ACCESS_KEY:?Set S3_ACCESS_KEY for the local VFS backend}"
: "${S3_SECRET_KEY:?Set S3_SECRET_KEY for the local VFS backend}"

npm install
npm --prefix client install

PORT="${SERVER_PORT}" \
PUBLIC_KEY_PATH="${PUBLIC_KEY_PATH:-${SCRIPT_DIR}/keys/public.pem}" \
node server/server.js &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT INT TERM

VITE_APP_BASE="${VITE_APP_BASE}" \
VITE_FRONT_CONTROLLER_URL="${VITE_FRONT_CONTROLLER_URL}" \
VITE_VFS_SERVER_URL="${VITE_VFS_SERVER_URL}" \
npm --prefix client run dev -- --host 0.0.0.0 --port "${CLIENT_PORT}"
