#!/usr/bin/env bash
# Run the server directly, without Docker:  ./run.sh
# First run creates .env with a random key; data goes in ./state.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  key=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  (umask 077; printf 'RECEIPT_APP_KEY=%s\nRECEIPT_PORT=3000\n# RECEIPT_GEMINI_KEY=   # add your Gemini key here to enable receipt scanning\n# RECEIPT_IBAN=       # your IBAN, for the payment QR code\n# RECEIPT_NAME=       # the name on that account\n# RECEIPT_USE_AH_API=true   # Albert Heijn integration (self-hosting only, see README)\n# RECEIPT_ADMIN_PORT=3001   # local admin dashboard, together with RECEIPT_ADMIN_KEY=...\n' "$key" > .env)
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
echo "  Key:     ${RECEIPT_APP_KEY:-(none: households only)}"
[ -n "${RECEIPT_ADMIN_PORT:-}" ] && [ -n "${RECEIPT_ADMIN_KEY:-}" ] && echo "  Admin:   http://localhost:${RECEIPT_ADMIN_PORT}   (LAN only)"
echo

exec python3 server.py
