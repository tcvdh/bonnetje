#!/usr/bin/env bash
# Finishes the Albert Heijn login on a Linux desktop, so you never have to copy a code by hand.
#
# After you log in, AH sends the browser to  appie://login-exit?code=...  and browsers can't show that
# address for long. This registers itself as the handler for appie:// links: it takes the code out of
# the link, hands it to your Bonnetje server, and shows a desktop notification.
#
#   ./tools/appie-login.sh install http://192.168.1.50:3000    set it up (uses ../.env for the key)
#   ./tools/appie-login.sh uninstall                           remove everything again
#
# Needs: curl. Optional: notify-send (notifications), wl-copy or xclip (copy the code if sending fails).
set -euo pipefail

NAME=bonnetje-appie-login
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/bonnetje"
CONFIG="$CONFIG_DIR/login.env"
BIN="$HOME/.local/bin/$NAME"
DESKTOP="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$NAME.desktop"

notify() {
  echo "$1${2:+ - $2}" >&2
  if command -v notify-send >/dev/null 2>&1; then notify-send -a "Bonnetje Splitter" "$1" "${2:-}" || true; fi
}

copy_to_clipboard() {
  if command -v wl-copy >/dev/null 2>&1; then printf '%s' "$1" | wl-copy
  elif command -v xclip >/dev/null 2>&1; then printf '%s' "$1" | xclip -selection clipboard
  elif command -v xsel >/dev/null 2>&1; then printf '%s' "$1" | xsel --clipboard --input
  else return 1; fi
}

# Called by the browser with the appie:// link
handle() {
  if [ ! -f "$CONFIG" ]; then
    notify "Bonnetje-login niet ingesteld" "Voer eerst 'appie-login.sh install <serveradres>' uit."
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$CONFIG" # SERVER_URL and APP_KEY, written by 'install'

  local code
  code=$(printf '%s' "${1:-}" | grep -oP 'code=\K[^&\s]+' | head -1 || true)
  if [[ ! "$code" =~ ^[A-Za-z0-9._~%-]+$ ]]; then # never put anything else in the request
    notify "Geen geldige code in de link" "${1:-}"
    exit 1
  fi

  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$SERVER_URL/api/auth/exchange" \
    -H "Authorization: Bearer $APP_KEY" -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\"}" 2>/dev/null) || status=000

  case "$status" in
    200) notify "Ingelogd bij Albert Heijn" "De server is verbonden." ;;
    401) notify "Inloggen mislukt" "De server-sleutel klopt niet. Voer 'install' opnieuw uit." ;;
    409) notify "Inloggen niet gestart" "Open de beheerpagina van de server en klik daar op de AH-inloglink." ;;
    000) notify "Inloggen mislukt" "Kan $SERVER_URL niet bereiken." ;;
    *)
      if copy_to_clipboard "$code"; then
        notify "Inloggen mislukt (status $status)" "De code staat op je klembord. Plak hem op $SERVER_URL/"
      else
        notify "Inloggen mislukt (status $status)" "Code: $code"
      fi
      exit 1
      ;;
  esac
}

install_handler() {
  local url="${1:-}"
  if [ -z "$url" ]; then
    echo "Gebruik: $0 install <serveradres>   bijvoorbeeld http://192.168.1.50:3000" >&2
    exit 1
  fi
  url="${url%/}"
  [[ "$url" =~ ^https?:// ]] || url="http://$url"

  # The key: from the environment, else from the .env next to server.py, else ask.
  local key="${RECEIPT_APP_KEY:-}" here
  here="$(cd "$(dirname "$0")/.." && pwd)"
  if [ -z "$key" ] && [ -f "$here/.env" ]; then
    key=$(grep -m1 '^RECEIPT_APP_KEY=' "$here/.env" | cut -d= -f2- || true)
    key="${key%\"}"; key="${key#\"}"; key="${key%\'}"; key="${key#\'}"
  fi
  if [ -z "$key" ]; then read -rsp "Server-sleutel: " key; echo; fi

  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Authorization: Bearer $key" "$url/api/auth/status") || status=000
  case "$status" in
    200) ;;
    401) echo "De sleutel klopt niet voor $url" >&2; exit 1 ;;
    *) echo "Kan $url niet bereiken (status $status)" >&2; exit 1 ;;
  esac

  mkdir -p "$CONFIG_DIR" "$(dirname "$BIN")" "$(dirname "$DESKTOP")"
  (umask 077; printf 'SERVER_URL=%q\nAPP_KEY=%q\n' "$url" "$key" > "$CONFIG")
  install -m 755 "$0" "$BIN"
  cat > "$DESKTOP" <<EOF
[Desktop Entry]
Name=Bonnetje Splitter AH-login
Exec=$BIN handle %u
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/appie;
EOF
  xdg-mime default "$NAME.desktop" x-scheme-handler/appie
  update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true

  echo "Klaar. Server: $url"
  echo "Open $url/ , klik op de AH-inloglink en log in. Je browser vraagt eenmalig om appie-links te openen"
  echo "met 'Bonnetje Splitter AH-login'. Bevestig dat, en je krijgt een melding dat je bent ingelogd."
}

uninstall_handler() {
  rm -f "$BIN" "$DESKTOP" "$CONFIG"
  rmdir "$CONFIG_DIR" 2>/dev/null || true
  local mime="${XDG_CONFIG_HOME:-$HOME/.config}/mimeapps.list"
  [ -f "$mime" ] && sed -i '/x-scheme-handler\/appie=/d' "$mime"
  update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
  echo "Verwijderd. Als je browser nog een 'appie'-koppeling onthoudt, verwijder die dan bij de browserinstellingen."
}

case "${1:-}" in
  handle) shift; handle "${1:-}" ;;
  install) shift; install_handler "${1:-}" ;;
  uninstall) uninstall_handler ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
