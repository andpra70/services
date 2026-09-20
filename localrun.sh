#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/client"

CLIENT_PORT="${CLIENT_PORT:-5173}"
VITE_APP_BASE="${VITE_APP_BASE:-/fileserver/}"
VITE_FRONT_CONTROLLER_URL="${VITE_FRONT_CONTROLLER_URL:-https://localhost}"

npm install
VITE_APP_BASE="${VITE_APP_BASE}" \
VITE_FRONT_CONTROLLER_URL="${VITE_FRONT_CONTROLLER_URL}" \
npm run dev -- --host 0.0.0.0 --port "${CLIENT_PORT}"
