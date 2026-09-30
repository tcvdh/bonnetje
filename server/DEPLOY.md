# Deploy: Bonnetje server

## Quick start

```bash
mkdir bonnetje && cd bonnetje
# create .env — see Settings below
docker run -d --name bonnetje \
  --env-file .env \
  -v ./state:/data \
  -p 3000:3000 \
  ghcr.io/tcvdh/bonnetje-server
```

Or with Docker Compose — create `compose.yml` (the [`compose.yml`](compose.yml) in this folder is the same plus hardening
and the local admin port; use that one for a server other people use):

```yaml
services:
  bonnetje:
    image: ghcr.io/tcvdh/bonnetje-server
    env_file: .env
    volumes:
      - ./state:/data
    ports:
      - 3000:3000
    restart: unless-stopped
```

```bash
docker compose up -d
```

Open `http://<server-ip>:3000/`: the page says the server is running. In the app, enter the server address and your `RECEIPT_APP_KEY`.

## Settings

Create an `.env` file (one `NAME=value` per line, quote values with spaces):

```
RECEIPT_APP_KEY=your-password
RECEIPT_IBAN=NL00BANK0123456789
RECEIPT_NAME="Name on the account"
RECEIPT_GEMINI_KEY=your-gemini-key
```

| Variable | Needed | What it does |
|---|---|---|
| `RECEIPT_APP_KEY` | yes, unless you only use households | The server's password (the built-in household); the app sends it. Any text works, a long random one is safer: `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'` |
| `RECEIPT_IBAN`, `RECEIPT_NAME` | for payment QR | Where housemates pay. Without them the app shows a warning instead of a QR code. |
| `RECEIPT_GEMINI_KEY` | for scanning | Gemini API key; without it, photo scanning is off. Photos are sent to Google (privacy note in [README.md](README.md#scanning-receipts-gemini)). |
| `RECEIPT_REQUESTS_PER_MINUTE`, `RECEIPT_SCANS_PER_MINUTE`, `RECEIPT_SCANS_PER_MONTH`, `RECEIPT_PHOTO_DAYS`, `RECEIPT_TRUSTED_PROXY`, `RECEIPT_CORS_ORIGIN` | no | Limits and privacy settings for a server that other people use (see [README.md](README.md#settings)). |
| `RECEIPT_ADMIN_PORT`, `RECEIPT_ADMIN_KEY` | no | Turn on the local admin dashboard, see [below](#admin-dashboard-local-only). |
| `RECEIPT_USE_AH_API` | no | Default `false`. `true` = unofficial Albert Heijn integration, **self-hosting only** (see below). |
| `RECEIPT_PORT` | no | Default `3000`. |
| `RECEIPT_HOST` | no | Default `0.0.0.0`. |

After changing settings: `docker restart bonnetje` (or `docker compose restart`).

## More households on the same server

One key is one household. To add another group of housemates (own key, own separate data, no restart needed):

```bash
docker exec -u bonnetje bonnetje python3 server.py tenant add "Family B" --scans 30
docker exec -u bonnetje bonnetje python3 server.py tenant list
```

Give the printed key to that household; they enter your server address and that key in the app. The other commands
(`rotate`, `revoke`, `payee`, `limit`, `delete`) are in [README.md](README.md#households-more-than-one-group), and the
[dashboard](#admin-dashboard-local-only) does all of it in a web page. Use `-u bonnetje`: the server runs as that unprivileged user, and files created by root could not be used by it.

## Admin dashboard (local only)

Add `RECEIPT_ADMIN_PORT=3001` and `RECEIPT_ADMIN_KEY=<a password only you know>` to `.env` and publish the port **on the host's
127.0.0.1 only** (the included `compose.yml` does: `127.0.0.1:3001:3001`; with `docker run` use `-p 127.0.0.1:3001:3001`). Then open
<http://localhost:3001> on that machine, or over an SSH tunnel (`ssh -L 3001:localhost:3001 <server>`) from your own computer.
Everything the dashboard can do is described in [README.md](README.md#admin-dashboard).

## Running it for other people

Besides the settings above, for a server that others use: `RECEIPT_TRUSTED_PROXY=<your proxy>`,
`RECEIPT_CORS_ORIGIN=` (empty), `RECEIPT_SCANS_PER_MONTH=<n>`, `RECEIPT_PHOTO_DAYS=<n>` (and adjust the per-minute limits if you
like, in `.env` or in the dashboard), leave `RECEIPT_USE_AH_API` off, HTTPS in front, and the hardened [`compose.yml`](compose.yml) from this folder. Read [SECURITY.md](../SECURITY.md) and
[PRIVACY.md](../PRIVACY.md) first.

## Updating

The image is rebuilt automatically when the server code changes on `main`. Pull the latest:

```bash
docker pull ghcr.io/tcvdh/bonnetje-server
docker stop bonnetje && docker rm bonnetje
# re-run the docker run command above
```

Or with Compose: `docker compose pull && docker compose up -d`.

Your data in `./state/` is on the host, so nothing is lost.

Since the server runs as an unprivileged user (uid 10001), the container hands `./state` to that user when it starts
(that is why it briefly starts as root and drops every privilege before the server runs). Data from older images keeps
working. If you use a `docker run` command instead of `compose.yml`, add `--cap-drop ALL --cap-add CHOWN
--cap-add DAC_OVERRIDE --cap-add SETUID --cap-add SETGID --security-opt no-new-privileges:true --read-only --tmpfs /tmp`
for the same hardening, or simply leave those flags out.

## Albert Heijn (optional, self-hosting only)

Off by default. To use it on your own server, add `RECEIPT_USE_AH_API=true` to `.env`, restart, and log in once:

1. Open `http://<server-ip>:3000/` and enter the key.
2. Click the AH login link and log in.
3. Copy the code from the `appie://login-exit?code=...` address (only the part after `code=`) and paste it in the box.

The server refreshes the token by itself after that. It uses an unofficial API: don't switch it on for a server that
other people use. Details and a Linux helper: [README.md](README.md#albert-heijn-optional).

## Custom scan prompt

The default `scan_prompt.txt` is baked into the image. To use your own, mount it:

```bash
-v ./scan_prompt.txt:/app/scan_prompt.txt
```

(The file must be readable by everyone: the server runs as an unprivileged user.)

## HTTPS with a reverse proxy

The server is plain HTTP. Put a reverse proxy in front for HTTPS (see `README.md` for a Caddy example). In the app, just type the hostname: it uses HTTPS. The app only uses plain HTTP for addresses inside your own network (private IPs, Tailscale, `localhost`, `*.local`).

## Backup

Everything is in `./state/`: `receipt.db` and `scans/` (the built-in household), `registry.db` and `tenants/` (other
households). Copy or snapshot that folder while the server is stopped (`docker stop bonnetje`), or take a consistent
copy of a database while it runs with `sqlite3 receipt.db ".backup copy.db"`. One household alone: its `tenants/<id>/` folder.
