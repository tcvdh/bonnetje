# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's **Report a vulnerability** button on the
repository's *Security* tab (private vulnerability reporting). Include what you found, how to reproduce it and
which version you used. Expect a first reply within about a week. Only the latest release is supported.

## Running the server safely

The server holds your receipts, receipt photos and (with `RECEIPT_USE_AH_API=true`) an Albert Heijn login.

- **Choose a password** (`RECEIPT_APP_KEY`). Anyone who has it can read and change that household's data. A long
  random one (`python3 -c 'import secrets; print(secrets.token_urlsafe(32))'`) is best; the server accepts any text.
  Wrong keys are limited to 10 per minute per client address. Households you add with `tenant add` get long random
  keys automatically (only a hash is stored); `tenant rotate` replaces a lost or leaked key.
- **Several households on one server** are kept apart by giving each its own database and photo folder, and by
  limits per household (requests, scans, body size). See "Security" in [server/README.md](server/README.md#security)
  for everything the server does, and the settings to use when other people are on your server
  (`RECEIPT_TRUSTED_PROXY`, `RECEIPT_CORS_ORIGIN=`, `RECEIPT_SCANS_PER_MONTH`, `RECEIPT_PHOTO_DAYS`).
- **The server speaks plain HTTP.** The password is sent with every request, so anywhere outside your own network
  (or Tailscale) put a reverse proxy with HTTPS in front of it and never expose port 3000 directly.
  The app itself refuses plain `http://` for anything but local addresses.
- **Keep `.env` and `state/` private.** They contain your keys, the database, the photos and the AH tokens.
  Never commit them; back up `state/` somewhere private.
- **Admin dashboard:** off by default. When on (`RECEIPT_ADMIN_PORT` + `RECEIPT_ADMIN_KEY`) it is a separate port that
  needs its own key on every call and only answers requests from private/LAN addresses (localhost, private IPs, `.local`
  mDNS), so it is not reachable from the public internet even if the port is open.
- **Albert Heijn integration:** off by default and only for your own server (it uses an unofficial API). A server
  that other people use should leave `RECEIPT_USE_AH_API` off.
- **Gemini:** receipt photos are sent to Google. See [PRIVACY.md](PRIVACY.md).
- **Use the hardened container:** the image runs the server as an unprivileged user, and the included `compose.yml`
  adds a read-only filesystem, dropped capabilities and resource limits.
- Update the Docker image regularly (`docker pull`).

## Known limits

Things that are deliberate, so you can judge them:

- The server has no TLS of its own; a reverse proxy provides it.
- One process and SQLite files: no high availability, and one server copy at a time.
- A key is a bearer secret: whoever holds it acts as that household (one key per household, no per-phone keys yet).
- The Albert Heijn integration uses an unofficial API and can break or be blocked at any time.
- The app's build tooling (Expo) has a moderate advisory in a build-time dependency (`uuid` via `xcode`); it is not part of the
  shipped app. Dependabot (`.github/dependabot.yml`) keeps dependencies, actions and the Docker base image current.
- Actions in the workflows are referenced by tag, not by commit hash.

Cross-household isolation is covered by automated tests (`server/tests/test_tenants.py`). If you find a way to read
or change another household's data, that is exactly the kind of report we want.
