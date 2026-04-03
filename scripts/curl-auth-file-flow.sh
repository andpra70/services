#!/usr/bin/env bash
set -euo pipefail

#source ../.env.prod
source ../.env

FILESERVER_BASE_URL="${FILESERVER_BASE_URL:-http://localhost:8080}"
API_BASE_URL="${API_BASE_URL:-${FILESERVER_BASE_URL%/}/api}"
OAUTH_ISSUER="${OAUTH_ISSUER:-http://localhost:9000}"
TOKEN_URL="${TOKEN_URL:-${OAUTH_ISSUER%/}/token}"
TOKEN_FORM="${TOKEN_FORM:-grant_type=password&client_id=fileserver-web&username=demo&password=demo&scope=openid%20profile%20email}"
ACCESS_TOKEN="${ACCESS_TOKEN:-}"
ME_URL="${ME_URL:-${OAUTH_ISSUER%/}/me}"
ALLOW_SELF_SIGNED_TLS="${ALLOW_SELF_SIGNED_TLS:-1}"
TARGET_DIR="${TARGET_DIR:-}"
SOURCE_FILE="${1:-${SOURCE_FILE:-../README.md}}"
UPLOAD_FILENAME="${UPLOAD_FILENAME:-$(basename "$SOURCE_FILE")}"
OUTPUT_DIR="${OUTPUT_DIR:-./tmp/curl-demo}"
AUTH_DOWNLOAD_FILE="${AUTH_DOWNLOAD_FILE:-$OUTPUT_DIR/download-auth-${UPLOAD_FILENAME}}"
PUBLIC_DOWNLOAD_FILE="${PUBLIC_DOWNLOAD_FILE:-$OUTPUT_DIR/download-public-${UPLOAD_FILENAME}}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Errore: comando richiesto non trovato: $1" >&2
    exit 1
  fi
}

sanitize_username() {
  local value="$1"
  value="$(printf '%s' "$value" | sed -E 's/[^a-zA-Z0-9._-]+/_/g; s/^_+//; s/_+$//')"
  printf '%s' "$value"
}

require_command curl
if ! command -v jq >/dev/null 2>&1; then
  require_command sed
fi
require_command mktemp

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "Errore: file da caricare non trovato: $SOURCE_FILE" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

CURL_TLS_FLAGS=()
if [[ "$ALLOW_SELF_SIGNED_TLS" == "1" || "$ALLOW_SELF_SIGNED_TLS" == "true" || "$ALLOW_SELF_SIGNED_TLS" == "yes" ]]; then
  CURL_TLS_FLAGS+=(--insecure)
fi

curl_text_or_die() {
  local label="$1"
  shift
  local tmp http_code
  tmp="$(mktemp)"
  http_code="$(curl -sS "${CURL_TLS_FLAGS[@]}" -o "$tmp" -w "%{http_code}" "$@")"
  if [[ "$http_code" -ge 400 ]]; then
    echo "Errore [$label]: HTTP $http_code" >&2
    cat "$tmp" >&2 || true
    rm -f "$tmp"
    exit 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

curl_download_or_die() {
  local label="$1"
  local output_path="$2"
  shift 2
  local tmp http_code
  tmp="$(mktemp)"
  http_code="$(curl -sS "${CURL_TLS_FLAGS[@]}" -o "$tmp" -w "%{http_code}" "$@")"
  if [[ "$http_code" -ge 400 ]]; then
    echo "Errore [$label]: HTTP $http_code" >&2
    cat "$tmp" >&2 || true
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$output_path"
}

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "1) Autenticazione OAuth su: $TOKEN_URL"
  TOKEN_RESPONSE="$(curl_text_or_die "oauth-token" \
    -X POST "$TOKEN_URL" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data "$TOKEN_FORM")"

  if command -v jq >/dev/null 2>&1; then
    ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.access_token // empty')"
  else
    ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi

  if [[ -z "$ACCESS_TOKEN" ]]; then
    echo "Errore: access_token non trovato nella risposta OAuth" >&2
    echo "$TOKEN_RESPONSE" >&2
    exit 1
  fi
else
  echo "1) Access token gia' fornito via env (ACCESS_TOKEN), salto chiamata /token"
fi

echo "2) Lettura profilo utente da: $ME_URL"
ME_RESPONSE="$(curl_text_or_die "oauth-me" -H "Authorization: Bearer $ACCESS_TOKEN" "$ME_URL")"

if command -v jq >/dev/null 2>&1; then
  USER_CLAIM="$(printf '%s' "$ME_RESPONSE" | jq -r '.preferred_username // .username // (.email // "" | split("@")[0]) // .sub // empty')"
else
  USER_CLAIM="$(printf '%s' "$ME_RESPONSE" | sed -n 's/.*"preferred_username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "$USER_CLAIM" ]]; then
    USER_CLAIM="$(printf '%s' "$ME_RESPONSE" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  fi
fi

if [[ -z "$USER_CLAIM" ]]; then
  echo "Errore: impossibile derivare username da /me (claims attesi: preferred_username, username, email o sub)" >&2
  echo "$ME_RESPONSE" >&2
  exit 1
fi

SANITIZED_USER="$(sanitize_username "$USER_CLAIM")"
if [[ -z "$SANITIZED_USER" ]]; then
  echo "Errore: username derivato non valido dopo sanitizzazione" >&2
  exit 1
fi

if [[ -n "$TARGET_DIR" ]]; then
  REMOTE_RELATIVE_PATH="${TARGET_DIR%/}/$UPLOAD_FILENAME"
else
  REMOTE_RELATIVE_PATH="$UPLOAD_FILENAME"
fi

encode_path() {
  local raw="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$raw" | jq -sRr @uri
  else
    printf '%s' "$raw" | sed 's/ /%20/g'
  fi
}

PUBLIC_RELATIVE_PATH="${SANITIZED_USER}/${REMOTE_RELATIVE_PATH}"
PUBLIC_URL="${API_BASE_URL%/}/download/$(encode_path "$PUBLIC_RELATIVE_PATH" | sed 's/%2F/\//g')"

echo "3) Lista file autenticata (GET /api/list?path=)"
curl_text_or_die "api-list" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "${API_BASE_URL%/}/list?path=$(encode_path "$TARGET_DIR")"
echo

echo "4) Upload file autenticato (POST /api/upload)"
curl_text_or_die "api-upload" \
  -X POST "${API_BASE_URL%/}/upload" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "path=$TARGET_DIR" \
  -F "files=@${SOURCE_FILE};filename=${UPLOAD_FILENAME}"
echo

echo "5) Download autenticato dello stesso file (GET /api/download?path=...) -> $AUTH_DOWNLOAD_FILE"
curl_download_or_die "api-download-auth" "$AUTH_DOWNLOAD_FILE" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "${API_BASE_URL%/}/download?path=$(encode_path "$REMOTE_RELATIVE_PATH")"

echo "6) Download pubblico SENZA token dello stesso file (GET /api/download/<username>/<path>) -> $PUBLIC_DOWNLOAD_FILE"
curl_download_or_die "api-download-public" "$PUBLIC_DOWNLOAD_FILE" "$PUBLIC_URL"

echo "Flusso completato."
echo "- remote path utente : $REMOTE_RELATIVE_PATH"
echo "- public path        : $PUBLIC_RELATIVE_PATH"
echo "- url download public: $PUBLIC_URL"
echo "- file locale auth   : $AUTH_DOWNLOAD_FILE"
echo "- file locale public : $PUBLIC_DOWNLOAD_FILE"
