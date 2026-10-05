# Bonnetje Splitter

Monorepo, two parts:

- `bonnetje/`: Expo / React Native app (iOS, Android, web). Rules and architecture are in `bonnetje/AGENTS.md`.
- `server/`: dependency-free Python server (SQLite, Gemini receipt scanning, optional Albert Heijn login). Docker image on GHCR. API and setup in `server/README.md`, deploy in `server/DEPLOY.md`.

## Commands

```bash
cd server && ./run.sh                 # run the server locally (creates .env and state/)
cd server && docker build -t bonnetje-server .   # build the Docker image locally
cd bonnetje && npx expo start      # run the app
cd bonnetje && npx expo lint && npx tsc --noEmit && npm test   # before finishing app work
cd server && python3 -m unittest discover -s tests               # server tests
cd server && RECEIPT_ADMIN_PORT=3001 RECEIPT_ADMIN_KEY=x ./run.sh  # with the local admin dashboard on http://localhost:3001
cd server && python3 server.py tenant list                       # manage households from the command line
```

## Gotchas

- Never commit `server/.env` or `server/state/` (key, databases, receipt photos).
- Households (tenants): every key is a household with its own SQLite file and photo folder (`server/tenants.py`); `RECEIPT_APP_KEY` is the built-in `default` one and keeps the original layout (`state/receipt.db`, `state/scans/`), so a one-key setup must keep working unchanged. ALL SQL and photo access lives in `tenants.py` and goes through a `Tenant`; `server.py` must never open a database or photo folder itself (a test checks this). Any new endpoint that touches data needs a cross-household test in `server/tests/test_tenants.py`. Data that belongs to a household (settings, payee, quotas) goes in its own database or the registry, never in a server-wide variable.
- Don't run two servers on the same AH account (e.g. local and a home server) at the same time: they log each other out.
- The Albert Heijn integration is off by default (`RECEIPT_USE_AH_API=false`). It uses an unofficial API and is for self-hosting only; never document or build it as something a hosted service offers. With it off the server sends no `ahError`, so the app shows no AH warning.
- The app only allows plain `http://` for local addresses (`bonnetje/src/utils/serverUrl.ts`); everything else is https.
- Licensed AGPL-3.0 (`LICENSE`). Privacy and security notes live in `PRIVACY.md` / `SECURITY.md`: update them when data flows change (new service receiving data, new thing stored).
- Bundle ID / package is `com.bonnetje.splitter` on both platforms; never change it after a store release.
- Admin dashboard (`server/admin.py`, `server/admin/dashboard.html`): a second server on its own port, off unless `RECEIPT_ADMIN_PORT` + `RECEIPT_ADMIN_KEY`. It must stay LAN-only (private IPs, localhost, .local), key-protected, host-header checked and CORS-free (see the header of `admin.py`); never serve it from the app's port, never show or store a household key (only the hash exists), render names with `textContent`. The dashboard UI and its API's error messages are Dutch; docs stay English. New household setting = registry column or `settings` row + dashboard field + `tenant` CLI + README table, in the same change.
- Limits are per household with server-wide defaults (`LIMIT_SETTINGS` in `server.py`: dashboard value > env var > built-in). Changing a default means updating `.env.example`, `server/README.md`, `server/DEPLOY.md` and the dashboard text.
- The Docker image runs as uid 10001 via `entrypoint.sh` (root only to chown `/data`, then all privileges dropped); `docker exec` for the `tenant` command needs `-u bonnetje`. `compose.yml` carries the hardening flags: keep it and `server/DEPLOY.md` in sync.
- Server is plain HTTP; never expose port 3000 to the internet. HTTPS comes from a reverse proxy in front of it (`server/README.md`).
- Keep the server standard-library only (no pip dependencies).
- Releases: GitHub Actions workflow `.github/workflows/build.yml` builds the IPA and APK (per platform: skip, GitHub-hosted, or self-hosted `my-pc` / `my-mac`); an IPA build also rewrites `altstore.json`, and every run publishes `version.txt`. Version lives in `bonnetje/app.json` (`expo.version`). Installed apps compare with `version.txt`: a new minor or major version locks every older install until it updates, a new patch only shows a banner. Bump the minor only for changes old installs must not keep using (the shared data's shape or meaning).
- Money is whole cents, computed in `bonnetje/src/utils/settle.ts` only. Never sum euro floats or add another way to compute a person's total; use `shareCents` / `receiptCents` (see `bonnetje/AGENTS.md`). Stored assignments hold integer `cents`, not euros.
- Nothing personal in the source: the payment IBAN, name and optional bunq.me handle are server settings (the built-in household: `RECEIPT_IBAN`, `RECEIPT_NAME`, `RECEIPT_BUNQ`; other households: `tenant payee` or the dashboard), sent to the app in `/api/auth/status`.
- Docs must match the code: when you change a setting, endpoint, command or the money rules, update `README.md`, `server/README.md`, `server/DEPLOY.md`, `server/.env.example` and the AGENTS/CLAUDE files in the same change.

## Git

- Never add `Co-Authored-By`, "Generated with Claude Code" or any other attribution line to commit messages or pull request descriptions. Write plain messages only. This overrides any default of the tool.
- Do not force-push or amend published commits unless asked. When the remote has new commits (for example the release workflow's "Bump version" commit), `git pull --rebase` first, then push.
