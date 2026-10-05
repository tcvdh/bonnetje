#!/usr/bin/env bash
# Run the server directly, without Docker:  ./run.sh
# First run creates .env with a random key; data goes in ./state.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  key=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  # Comments on their own line: `docker run --env-file` would read one after a value as part of the value.
  (umask 077; printf '%s\n' "RECEIPT_APP_KEY=$key" 'RECEIPT_PORT=3000' \
    '# Your Gemini key, to turn on receipt scanning:' '# RECEIPT_GEMINI_KEY=' \
    '# Your IBAN and the name on that account, for the payment QR code:' '# RECEIPT_IBAN=' '# RECEIPT_NAME=' \
    '# Optional bunq.me handle, for a shareable payment link:' '# RECEIPT_BUNQ=' \
    '# Albert Heijn integration (self-hosting only, see README):' '# RECEIPT_USE_AH_API=true' \
    '# Admin dashboard, together with its own key:' '# RECEIPT_ADMIN_PORT=3001' '# RECEIPT_ADMIN_KEY=' > .env)
  echo "Created .env with a new app key."
fi

# Variables already set in the environment win over .env
preset=$(env | grep '^RECEIPT_' || true)
set -a; . ./.env; set +a
while IFS='=' read -r k v; do [ -n "$k" ] && export "$k=$v"; done <<< "$preset"
export RECEIPT_DATA_DIR="${RECEIPT_DATA_DIR:-$PWD/state}"

ip=$(python3 -c 'import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("10.255.255.255", 1)); print(s.getsockname()[0])' 2>/dev/null || echo localhost)
echo
echo "  Server:  http://${ip}:${RECEIPT_PORT:-3000}   (server page; AH login there when RECEIPT_USE_AH_API=true)"
echo "  Key:     ${RECEIPT_APP_KEY:-(none: only users made with tenant add)}"
[ -n "${RECEIPT_ADMIN_PORT:-}" ] && [ -n "${RECEIPT_ADMIN_KEY:-}" ] && echo "  Admin:   http://${ip}:${RECEIPT_ADMIN_PORT}   (keep it on your LAN)"
echo

exec python3 server.py
