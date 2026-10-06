# Bonnetje server

Central server for the Bonnetje Splitter app. It stores the split data (SQLite) and reads receipt photos with
Gemini. Optionally, for self-hosting only, it also logs in to Albert Heijn and proxies AH receipts (off by
default, see [Albert Heijn (optional)](#albert-heijn-optional)). The app only ever talks to this server; it never
sees AH tokens. One key = one user, and you can add more users to the same server
([Users](#users-more-than-one-person)). Python 3.9+, standard library only.

## Docker (recommended)

```bash
docker run -d --name bonnetje \
  --env-file .env \
  -v ./state:/data \
  -p 3000:3000 \
  -p 3001:3001 \
  ghcr.io/tcvdh/bonnetje-server
```

Create an `.env` file first (see [`.env.example`](.env.example) or [DEPLOY.md](DEPLOY.md) for all settings).
The image is rebuilt automatically when the server code changes. Full setup, updating, and backup instructions
are in [DEPLOY.md](DEPLOY.md).

Then open `http://<server-ip>:3000/`: the page says the server is running. In the app, enter the server address and
your `RECEIPT_APP_KEY`.

### Settings

All settings are environment variables (passed via `--env-file` with Docker, or `.env` with `run.sh` for local dev). One `NAME=value` per line; quote values that contain spaces (`RECEIPT_NAME="Jan Jansen"`) and put comments on their own line (`docker run --env-file` reads a comment after a value as part of the value). The server refuses to start when a limit is not a whole number. [`.env.example`](.env.example) lists every setting with comments: `cp .env.example .env` and fill it in.

| Variable | Needed | What it does |
|---|---|---|
| `RECEIPT_APP_KEY` | yes, unless you only use [users](#users-more-than-one-person) | The password of your server (the built-in user): the app sends it as `Authorization: Bearer <key>`. Any text works (no minimum length), but a long random one is safer: `python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`. `run.sh` generates one on first run. |
| `RECEIPT_BUNQ` | optional | bunq.me handle of the built-in user. The payment screen then also offers "Deel bunq-betaallink": a message with the person's products and total plus the link (`https://bunq.me/<handle>/<amount>/<description>`). Other users: `tenant payee` or the dashboard. Works with or without an IBAN. |
| `RECEIPT_IBAN`, `RECEIPT_NAME` | for the payment QR code | The account of the built-in user, where its housemates pay. The server checks the IBAN and sends both to the app. Without them the app shows "Betaalgegevens ontbreken" instead of a QR code. Other users get theirs with `tenant payee`. |
| `RECEIPT_GEMINI_KEY` | for scanning | Gemini API key; without it, scanning is off. See the privacy note under [Scanning receipts](#scanning-receipts-gemini). |
| `RECEIPT_USE_AH_API` | no | Default `false`. `true` switches on the unofficial Albert Heijn integration. **Self-hosting only**, see [below](#albert-heijn-optional). |
| `RECEIPT_PORT` | no | Default `3000`. |
| `RECEIPT_HOST` | no | Default `0.0.0.0` (all interfaces). Use `127.0.0.1` when a reverse proxy runs on the same machine without Docker. |
| `RECEIPT_DATA_DIR` | no | Default `./state`. The Docker image fixes it to `/data`. |
| `RECEIPT_REQUESTS_PER_MINUTE` | no | Default `120`. Requests per minute per user (`0` = unlimited). Opening the app takes about 3 requests plus one per open receipt, so a busy user bursts to roughly 30. |
| `RECEIPT_SCANS_PER_MINUTE` | no | Default `5`. Gemini scans per minute per user (`0` = unlimited). |
| `RECEIPT_SCANS_PER_WEEK` | no | Default `25`. Gemini scans per week for each user made with `tenant add` (`0` = unlimited). A scan counts when Gemini read the photo (also when it was no receipt); when the server or Gemini failed, it does not. The built-in user is never limited. |
| `RECEIPT_PHOTO_DAYS` | no | Default `0` (keep). Delete the photo of a kept receipt after this many days (the receipt itself stays; a rescan is then no longer possible). |
| `RECEIPT_ADMIN_PORT`, `RECEIPT_ADMIN_KEY` | no | Both set = the [admin dashboard](#admin-dashboard) runs on that port, protected by that key. `RECEIPT_ADMIN_HOST` (default `0.0.0.0`) is where it listens. Keep the port on your LAN; never forward it to the internet. |
| `RECEIPT_TRUSTED_PROXY` | no | Address(es) of your reverse proxy, comma-separated (for Docker usually the proxy container or the Docker gateway). Only requests from these are allowed to say who the real client is (`X-Forwarded-For`), so the rate limits work per person instead of per proxy. |
| `RECEIPT_CORS_ORIGIN` | no | Default `*`. Set it empty to send no CORS headers at all: the phone apps don't need them, only the browser version of the app does. Empty is right for a public server. |
| `RECEIPT_GEMINI_MODEL`, `RECEIPT_SCAN_PROMPT`, `RECEIPT_GEMINI_API`, `RECEIPT_AH_API` | no | Model name, prompt file, and the Gemini / AH API base addresses (for tests). |

The four limits above are defaults for every user: each user can have its own (`tenant limit`, or the dashboard), and
the dashboard can change the server-wide values while the server runs (a value set there wins over `.env`).
The key travels in every request, so use HTTPS (below) whenever the server can be reached from outside your own network.
More about what protects the server: [Security](#security).

The payment details live on the server, not in the app, so the app itself contains nothing personal.

## Users (more than one person)

One server can serve many people. A **user** is one person who keeps track of what others owe them (the "Ik" in
the app), so housemates who each split their own receipts get a user each. Every user has their own key, and their data, photos,
Albert Heijn login and payment details are completely separate from every other user's. Anyone who only needs
one user changes nothing: `RECEIPT_APP_KEY` *is* that user (id `default`), it keeps using
`state/receipt.db` and `state/scans/` exactly like before, and a server with only that key behaves as it always did.

Prefer clicking? The [admin dashboard](#admin-dashboard) does all of this in a web page. Add another user (works
immediately, no restart):

```bash
python3 server.py tenant add "Alice"                      # from server/ ; or with Docker:
docker exec -u bonnetje bonnetje python3 server.py tenant add "Alice" --scans 30
```

It prints an id and a key, **once**. Give the key to that user: in the app they enter your server address and that
key, just like the built-in user does with `RECEIPT_APP_KEY`. Their keys are long random values and only a hash
is stored on the server.

| Command (`python3 server.py tenant ...`) | |
|---|---|
| `add "Name" [--scans N]` | create a user; `--scans` is its weekly Gemini scan limit |
| `list` | all users, their state and this week's scans |
| `rotate ID` | new key; the old one stops working at once |
| `revoke ID` / `enable ID` | switch a user off / on again (its data stays) |
| `ah ID on\|off\|default` | Albert Heijn for that user. Only has an effect with `RECEIPT_USE_AH_API=true` (`.env` leads): then `off` switches it off for them |
| `limit ID week\|requests\|rate N` | that user's own limit: scans per week / requests per minute / scans per minute (`0` = unlimited); `N` = `default` goes back to the server-wide value |
| `payee ID [IBAN "Name"] [--bunq HANDLE] [--clear]` | where that user's housemates pay: IBAN + name (payment QR code), a bunq.me handle (share link), or both. What you leave out stays as it was; `--bunq ""` removes the handle, `--clear` removes everything. The built-in user falls back to `RECEIPT_IBAN` + `RECEIPT_NAME` / `RECEIPT_BUNQ` for what it has not set itself |
| `delete ID --yes` | delete the user and **all** its data, photos included |

Good to know:

- **What is separate:** the split data, scanned receipts and photos, the Albert Heijn login (each user logs in
  with its own key on the server page, when `RECEIPT_USE_AH_API=true`), the payment details, the scan usage.
  **What is shared:** the Gemini key (the scanning costs are yours), the `RECEIPT_USE_AH_API` switch, the scan prompt.
- **Where it lives:** `state/registry.db` (which key belongs to which user) and one folder per user in
  `state/tenants/<id>/`. Backing up, moving or exporting a user is copying its folder while the server is stopped
  (or take a consistent copy of its database while it runs, see [Backup](DEPLOY.md#backup)); deleting one is `tenant delete`.
- **Without `RECEIPT_APP_KEY`** the server only knows the users you added. It refuses to start when there is neither.
- **Hosting for other people:** keep `RECEIPT_USE_AH_API` off (unofficial API, not for other people's use), set
  `RECEIPT_SCANS_PER_WEEK`, `RECEIPT_PHOTO_DAYS`, `RECEIPT_TRUSTED_PROXY` and an empty `RECEIPT_CORS_ORIGIN`, and
  read [Security](#security) and [PRIVACY.md](../PRIVACY.md) (you are then responsible for their data).
- **Not there yet:** self-service sign-up and payments (users are created by you), several keys per user
  (one per phone), setting the payment account from inside the app, and running several server copies at once
  (that needs Postgres and shared photo storage instead of SQLite files; the split of all storage code into
  `tenants.py` is the seam for it).

### How the users are kept apart

Every user has its own SQLite file and photo folder, so a request only ever opens *its own* files: there is no
shared table in which one user's rows could show up in another's answer. The key is looked up once per request
and turned into a `Tenant` object; all storage code lives in `tenants.py` and only works through that object (a test
fails if `server.py` starts touching a database or photo folder directly). Ids of other users' scans simply
don't exist for you (`404`, never `403`, so nobody can probe). Cross-user tests run every scan and data endpoint
with the wrong user's key.

## Security

What protects the server, and the settings that tune it:

| Area | What it does |
|---|---|
| Keys | Compared in constant time. Users made with `tenant add` get 256-bit random keys, stored only as a SHA-256 hash; a lost phone: `tenant rotate`. Wrong keys: 10 a minute per client address, then `429`. |
| Isolation | One database and photo folder per user (see above). Data files are private to the server user (`0600` / `0700`). |
| Limits | Per user (defaults, all adjustable): 120 requests and 5 scans a minute, 25 scans per week, one scan at a time. Request bodies at most 2 MB (photos 25 MB), at most 128 connections at once, 60 s socket timeout. |
| Admin dashboard | A separate port with its own key (see below), meant for your local network only. Off unless you turn it on. |
| Real client address | With a reverse proxy, set `RECEIPT_TRUSTED_PROXY` to the proxy's address; otherwise every visitor looks like the proxy. |
| Web | No cookies (token in a header), so no CSRF. `RECEIPT_CORS_ORIGIN=` (empty) for a public server. Every response is `no-store` and `nosniff`; the server page has a strict CSP. |
| Photos | Only image types are accepted, files are named by the server (`<id>.jpg`), and read back only through the user's own record. `RECEIPT_PHOTO_DAYS` deletes old ones. |
| Container | Runs as an unprivileged user (uid 10001, no capabilities, `no-new-privileges`); the included [`compose.yml`](compose.yml) adds a read-only filesystem, dropped capabilities and memory / process limits. |
| Logs | Client address, user id and the request line. Never keys, photos or receipt contents. |
| Transport | The server speaks HTTP; TLS (and HSTS) belongs in the reverse proxy below. |

Report problems as described in [SECURITY.md](../SECURITY.md).

## Admin dashboard

A local web page for the person running the server: see every user with its usage, add users, change
their limits and payment account, replace or revoke a key, and delete a user. It is **off by default**; turn it
on with two settings:

```
RECEIPT_ADMIN_PORT=3001
RECEIPT_ADMIN_KEY=a-password-only-you-know
```

Use a different key from `RECEIPT_APP_KEY`.

Then open `http://<server-ip>:3001` from any machine on your local network and log in with the admin key. What it shows and does:

- **Overview:** users active, scans this week, storage, requests and wrong keys since the server started, whether Albert Heijn and scanning are
  on. The four server-wide limits are editable here (a value set here wins over `.env`; *Herstel* goes back to `.env` / the default).
- **Gebruikers:** per user: last seen, people, scanned and split receipts, invoices, scans this week against its limit, storage, AH status.
  Actions: edit (name, its own limits, AH on/off, payment account), new key, switch off / on, delete (type its name to confirm).
  The AH toggle only appears when AH is enabled globally (`RECEIPT_USE_AH_API=true`): `.env` leads, so with it off no user has AH,
  and with it on each user can be switched off individually.
  A new or replaced key is shown once: only hashes are stored, so a key can never be looked up later.

How it is kept private:

- It runs on a different port from the app's server and is never part of the app's API.
- Every call needs the admin key (in a header, not a cookie, so a web page elsewhere cannot use your login), and it
  sends no CORS headers. Wrong keys: 10 a minute, then blocked.
- It does **not** check where a request comes from: who can reach it is decided by where you open its port. Keep it on
  your LAN and never forward it to the internet. Behind a reverse proxy, let the proxy allow LAN addresses only, for
  example with Caddy:

  ```
  admin.example.com {
      @lan remote_ip private_ranges
      handle @lan {
          reverse_proxy <server-ip>:3001
      }
      respond 403
  }
  ```
- Docker: `compose.yml` publishes it as `3001:3001`, so it is reachable from your LAN. Don't forward that port on your
  router.
- Everything it changes is written to the log (`admin: user ... changed`), never a key.

## Albert Heijn (optional)

Off by default. With `RECEIPT_USE_AH_API=true` the server logs in to your own Albert Heijn account, keeps that
login alive, and shows your AH receipts in the app next to scanned ones.

> **Only for your own, self-hosted server.** It uses Albert Heijn's *unofficial* mobile API, which is not meant for
> third-party apps and can change or stop working at any time. Do not switch it on for a server that other people
> use, and do not offer it in a hosted service. This project is not affiliated with or endorsed by Albert Heijn.
> With the switch off, scanning photos and splitting work exactly the same.

What the switch changes:

| | `false` (default) | `true` |
|---|---|---|
| Receipts in the app | scanned receipts only | AH receipts + scanned |
| "Albert Heijn is niet verbonden" warning in the app | never shown | shown while the server is not logged in |
| Server page at `/` | says the server runs and that AH is off | AH login page (asks for the key) |
| `/api/auth/begin`, `exchange`, `logout` | `404 ah_disabled` | work |

Every [user](#users-more-than-one-person) logs in with its own Albert Heijn account: open the server page
and enter *that user's* key. Log in once (the server refreshes the token by itself after that):

1. Set `RECEIPT_USE_AH_API=true` in your `.env` and restart the server.
2. Open `http://<server-ip>:3000/`, enter the key, and press **Open inloglink** to log in at Albert Heijn.
3. Afterwards the browser tries to open `appie://login-exit?code=...`. Copy **only the code** (the part after `code=`) and paste it in the box.

Don't run two servers on the same AH account (for example one on your PC and one on a home server): they log each other out.

### Easier login on a Linux desktop

Copying the code by hand is fiddly, because browsers can't show the `appie://` link for long. `tools/appie-login.sh`
registers your PC as the handler for those links: it sends the code to the server itself and shows a notification.

```bash
./tools/appie-login.sh install http://<server-ip>:3000   # uses the key from ./.env, or asks for it
./tools/appie-login.sh uninstall                          # remove it again
```

Then open the server page, tap the AH login link and log in. The browser asks once whether to open the link with
"Bonnetje Splitter AH-login"; confirm, and you get "Ingelogd bij Albert Heijn". Needs `curl`; `notify-send` is optional.

## Scanning receipts (Gemini)

Photos of receipts from any store are read by Gemini and turned into receipts you can split like Albert Heijn ones.

1. Put your key in the env file: `RECEIPT_GEMINI_KEY=...`, then restart.
2. Scan or upload a photo in the app.

How it works, and where to change it:

- **`scan_prompt.txt`** is the instruction Gemini gets (how to treat discounts, deposits, totals, Dutch stores). Each request also sends today's date, so the model doesn't flag a recent receipt as being in the future (its training data ends before today). Keep the date rule if you use your own prompt.
  It is re-read on every scan, so edits apply immediately (with Docker, mount your own copy, see [DEPLOY.md](DEPLOY.md)).
- **`scanning.py`** holds the structured-output schema, the checks, and the conversion to the app's receipt shape.
  Model: `RECEIPT_GEMINI_MODEL` (default `gemini-3.8-flash`).
- **Checks:** after reading, the server adds up items, deposits and discounts and compares with the printed total
  (and with the printed total savings and item count when there are any). Small doubts become *warnings* (the receipt is
  kept and the app shows them); wrong sums become *issues*: the receipt is held as a draft and the app asks whether to keep it.
- Photos are stored in the user's `scans/` folder next to its database, so a receipt can be re-read after a prompt change:
  `POST /api/scans/:id/rescan`. Note that assignments refer to item positions, so rescan before splitting.
- **Privacy:** every scanned photo is sent to Google's Gemini API. Google's terms differ between the free and the
  paid API: on the free tier your content may be used to improve Google's products, on a paid (billing enabled)
  key it is not. Check the current terms, and if you scan other people's receipts or let others use your server,
  use a paid key. Photos stay on your server until you delete the receipt, or until `RECEIPT_PHOTO_DAYS` has passed (then only the photo goes).

## Reaching it from your phone

The server speaks plain HTTP. Don't expose port 3000 to the internet. Either use Tailscale (install it
on the server and use the tailnet address), or put it behind a reverse proxy that does HTTPS.

The app only uses plain HTTP for addresses inside your own network: private IPs (`192.168.x.x`, `10.x.x.x`,
`172.16-31.x.x`), Tailscale (`100.64-127.x.x`), `localhost` and `*.local` names. Every other address is forced to
HTTPS, also when you type `http://`. (iOS and Android allow this for local addresses; the app asks for the
local-network permission on iOS.)

### HTTPS with a reverse proxy (Caddy)

The server itself stays on plain HTTP; the proxy adds TLS. A Caddyfile for a name that only resolves inside your
network (local DNS pointing at the proxy):

```
bonnetje.example.com {
    reverse_proxy <server-ip>:3000
    tls {
        dns <your-dns-provider> {env.DNS_API_TOKEN}
    }
}
```

- **The certificate must be publicly trusted.** Use a real domain you own and Caddy's DNS challenge (Let's Encrypt),
  so no port has to be open to the internet. A private CA (`tls internal`) does not work: Android apps ignore
  certificates the user installed, and iOS needs the CA installed and trusted by hand.
- In the app, just type the hostname: `bonnetje.example.com`. The app uses HTTPS for hostnames (and HTTP for local
  addresses like `192.168.1.50:3000`). Typing `http://bonnetje.example.com` is also upgraded to HTTPS.
- Port 3000 stays reachable over plain HTTP on the LAN. Close it in the container's firewall if you want HTTPS only.
- Your data and key do not change. To move a phone from the old address to the new one, use **Server wisselen** (red,
  in the menu on the main screen), then connect again with the new address and the same key.
- Behind a proxy the server sees the proxy's address for every request. Set `RECEIPT_TRUSTED_PROXY` to that address so
  the limits (wrong keys per minute) count per client instead of for everyone together.

## API (all except `/api/health` need `Authorization: Bearer <key>`)

Every key belongs to one user and only sees that user's data. Errors are JSON `{error}`; scan errors also carry a
Dutch `message` for the app. `400 bad_request`, `401` wrong key, `404 not_found`, `413 too_large`,
`429` (`too_many_attempts`, `rate_limited`, `scan_rate_limited`, `scan_quota`, `scan_busy` while that user's previous scan runs), `503` when the server is full.

| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness, `{ok, ahEnabled}` (no key needed) |
| GET | `/api/auth/status` | `ahEnabled`, AH login state, `loginUrl` (`null` when AH is off), `scanEnabled`, and `payee` (`{iban, name, bunq?}` or `null` when not set up) |
| POST | `/api/auth/begin` | AH only: start a login, opens a 10-minute window in which one code is accepted (`404 ah_disabled` when AH is off) |
| POST | `/api/auth/exchange` `{code}` | AH only: finish the login (accepts the code, or the whole `appie://…?code=` URL); `409` if no login was started, so a foreign `appie://` link can't switch the server to someone else's account |
| POST | `/api/auth/logout` | AH only: forget AH tokens |
| GET | `/api/receipts` | `{receipts, ahError, cachedAt}`: scans, plus AH receipts when AH is on |
| GET | `/api/receipts/:id` | receipt detail |
| GET | `/api/data` | `{data, version}` |
| POST | `/api/scans` `{image (base64), mimeType}` | read a photo: `201 {receipt, warnings}`, or `422 {error, message, issues, scanId}` |
| POST | `/api/scans/:id/accept` | keep a draft that had issues |
| POST | `/api/scans/:id/rescan` | read the stored photo again |
| GET | `/api/scans/:id/image` | the stored photo |
| DELETE | `/api/scans/:id` | delete the scanned receipt and its photo for good |
| PUT | `/api/data` `{data, baseVersion}` | `{version}`, or `409 {data, version}` if `baseVersion` is stale |

## Tests

```bash
python3 -m unittest discover -s tests     # from server/; standard library only
```

They cover the scan checks, the save conflict logic, the IBAN check, the AH on/off switch, the HTTP API, users (keys, isolation
between them, limits, quotas, per-user AH and payment account) and the admin dashboard's API. They use a temporary data folder.

## Run without Docker

```bash
./run.sh
```

First run creates `.env` with a random key and stores data in `./state`. It prints the address and
key to enter in the app. Stop with Ctrl+C. The server uses `python3` only, nothing to install
(Arch: `sudo pacman -S python` if missing). Both `.env` and `state/` are git-ignored.

To move your data to another machine, copy `state/` (stop the server first).
