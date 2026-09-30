#!/bin/sh
# Runs as root only long enough to make /data belong to the server's user, then drops all privileges.
set -e
if [ "$(id -u)" = "0" ]; then
  chown -hR 10001:10001 "${RECEIPT_DATA_DIR:-/data}" 2>/dev/null || true
  exec setpriv --reuid=10001 --regid=10001 --clear-groups --inh-caps=-all --no-new-privs "$@"
fi
exec "$@"
