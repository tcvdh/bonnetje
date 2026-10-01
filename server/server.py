"""Bonnetje Splitter server.

One process that owns everything the phone used to keep locally, for one or more households:

* the split data (assignments, paid, completed, hidden) in SQLite, one private database per household
* receipt photos read with Gemini
* optionally (RECEIPT_USE_AH_API=true, self-hosting only) each household's own Albert Heijn login, refreshed
  in the background so it never lapses, and a thin proxy for AH receipts, so clients never see AH tokens

A household is whoever holds its key: RECEIPT_APP_KEY is the built-in one, more are made with
`python3 server.py tenant add "Name"` (see tenants.py and the README). Standard library only (Python 3.9+).
Configure with environment variables:

  RECEIPT_APP_KEY   the key of the built-in household (optional when you add households with `tenant add`).
                    Sent by the app as `Authorization: Bearer <key>`
  RECEIPT_HOST      default 0.0.0.0
  RECEIPT_PORT      default 3000
  RECEIPT_DATA_DIR  default ./state  (registry, databases and photos live here)
  RECEIPT_USE_AH_API  default false. true switches on the unofficial Albert Heijn integration (see README)
  RECEIPT_AH_API    default https://api.ah.nl (override for tests)
  RECEIPT_GEMINI_KEY    Gemini API key; without it scanning is switched off
  RECEIPT_GEMINI_MODEL  default gemini-3.8-flash
  RECEIPT_SCAN_PROMPT   path to the scan prompt (default ./scan_prompt.txt)
  RECEIPT_IBAN      the IBAN of the built-in household, where housemates pay (payment QR code in the app)
  RECEIPT_NAME      the name on that account
  RECEIPT_BUNQ      optional bunq.me handle: the app then also offers a shareable bunq.me payment link
  RECEIPT_REQUESTS_PER_MINUTE  default 120: requests per minute per household (0 = unlimited)
  RECEIPT_SCANS_PER_MINUTE     default 5: Gemini scans per minute per household (0 = unlimited)
  RECEIPT_SCANS_PER_WEEK   default 25: Gemini scans per week for households from `tenant add` (0 = unlimited)
  RECEIPT_PHOTO_DAYS       default 0 (keep): delete photos of kept receipts after this many days
                           (these four can also be changed live in the admin dashboard, which wins over the environment)
  RECEIPT_ADMIN_PORT, RECEIPT_ADMIN_KEY  turn on the local admin dashboard (see admin.py); RECEIPT_ADMIN_HOST is 127.0.0.1
  RECEIPT_TRUSTED_PROXY    comma-separated addresses of your reverse proxy: only then X-Forwarded-For is believed
  RECEIPT_CORS_ORIGIN      default *. Set to nothing to send no CORS headers (the phone apps do not need them)
"""
from __future__ import annotations

import base64
import contextlib
import json
import logging
import os
import re
import signal
import sys
import threading
from types import SimpleNamespace
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import admin
import scanning
import tenants
from limiter import Limiter
from tenants import Tenant

HOST = os.environ.get("RECEIPT_HOST", "0.0.0.0")
PORT = int(os.environ.get("RECEIPT_PORT", "3000"))
APP_KEY = os.environ.get("RECEIPT_APP_KEY", "")
DATA_DIR = Path(os.environ.get("RECEIPT_DATA_DIR", Path(__file__).parent / "state"))
USE_AH_API = os.environ.get("RECEIPT_USE_AH_API", "").strip().lower() in ("1", "true", "yes", "on")
AH_API = os.environ.get("RECEIPT_AH_API", "https://api.ah.nl").rstrip("/")
PAYEE_IBAN = re.sub(r"\s+", "", os.environ.get("RECEIPT_IBAN", "")).upper()
PAYEE_NAME = os.environ.get("RECEIPT_NAME", "").strip().strip("\"'").strip()[:70]
try:
    PAYEE_BUNQ = tenants.clean_bunq(os.environ.get("RECEIPT_BUNQ", "").strip().strip("\"'"))
except ValueError:
    PAYEE_BUNQ = ""
# (quotes are stripped because `docker run --env-file` keeps them; an EPC QR code allows 70 characters)
STATIC_DIR = Path(__file__).parent / "static"
ADMIN_HOST = os.environ.get("RECEIPT_ADMIN_HOST", "127.0.0.1")
ADMIN_PORT = int(os.environ.get("RECEIPT_ADMIN_PORT", "0") or 0)
ADMIN_KEY = os.environ.get("RECEIPT_ADMIN_KEY", "")
TRUSTED_PROXIES = {p.strip() for p in os.environ.get("RECEIPT_TRUSTED_PROXY", "").split(",") if p.strip()}
CORS_ORIGIN = os.environ.get("RECEIPT_CORS_ORIGIN", "*")

HOUSEHOLDS = tenants.Households(DATA_DIR, use_default=bool(APP_KEY))

AH_HEADERS = {"Content-Type": "application/json", "User-Agent": "Appie/8.22.3"}
AH_LOGIN_URL = (
    "https://login.ah.nl/secure/oauth/authorize"
    "?client_id=appie&redirect_uri=appie://login-exit&response_type=code"
)
REFRESH_MARGIN = 10 * 60      # refresh when fewer than 10 minutes remain
DEFAULT_LIFETIME = 30 * 60    # assumed lifetime if AH doesn't say
MAX_BODY = 25 * 1024 * 1024   # receipt photos arrive as base64
MAX_DATA_BYTES = 2 * 1024 * 1024  # everything else (the split data is small)
DRAFT_TTL = 24 * 3600
HOUSEKEEPING_EVERY = 3600
MAX_SCANS_AT_ONCE = 4         # photos are read into memory (up to MAX_BODY each); more at once get a 503
MAX_CONNECTIONS = 128         # more at once get a 503 instead of an ever-growing pile of threads
SOCKET_TIMEOUT = 60           # a client that goes quiet mid-request is dropped
AUTH_FAIL_LIMIT = 10          # wrong keys allowed per client address ...
AUTH_FAIL_WINDOW = 60         # ... within this many seconds

# Limits that can be changed while running: the admin dashboard wins over the environment, which wins over these.
LIMIT_SETTINGS = {  # name: (environment variable, built-in default)
    "requests_per_minute": ("RECEIPT_REQUESTS_PER_MINUTE", 120),  # a busy household opening the app: ~30 in a burst
    "scans_per_minute": ("RECEIPT_SCANS_PER_MINUTE", 5),
    "scans_per_week": ("RECEIPT_SCANS_PER_WEEK", 25),
    "photo_days": ("RECEIPT_PHOTO_DAYS", 0),                      # 0 = keep photos
}
STATS = {"requests": 0, "unauthorized": 0, "rateLimited": 0, "scans": 0, "errors": 0}  # since the server started
STARTED = time.time()


def setting(name: str) -> int:
    stored = HOUSEHOLDS.settings().get(name)
    if stored is not None:
        return int(stored)
    env, default = LIMIT_SETTINGS[name]
    return int(os.environ.get(env, "") or default)


def setting_source(name: str) -> str:
    if HOUSEHOLDS.settings().get(name) is not None:
        return "dashboard"
    return "environment" if os.environ.get(LIMIT_SETTINGS[name][0], "") else "built-in"


IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}

RECEIPTS_QUERY = (
    "query($offset:Int!,$limit:Int!){posReceiptsPage(pagination:{offset:$offset,limit:$limit})"
    "{posReceipts{id dateTime totalAmount{amount}}}}"
)
DETAIL_QUERY = (
    "query($id:String!){posReceiptDetails(id:$id){id memberId "
    "products{id quantity name price{amount}amount{amount}deposit{amount}}"
    "discounts{name amount{amount}}payments{method amount{amount}}}}"
)

log = logging.getLogger("receipt")


# ── Payee (where housemates pay) ─────────────────────────────────────────

def iban_valid(iban: str) -> bool:
    """Format and mod-97 check, so a typo shows up here instead of as a QR code the bank app rejects."""
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", iban):
        return False
    return int("".join(str(int(ch, 36)) for ch in iban[4:] + iban[:4])) % 97 == 1


def payee(tenant: Tenant) -> dict | None:
    """Where housemates pay: the QR code needs {iban, name}, the share link a bunq handle; either alone is fine.
    The two are chosen separately: a household's own value (`tenant payee`, dashboard) wins, and the built-in
    household falls back to RECEIPT_IBAN + RECEIPT_NAME / RECEIPT_BUNQ. None when neither is set up."""
    own = tenant.get_setting("payee") or {}
    default = tenant.id == tenants.DEFAULT_ID
    out = {}
    if iban_valid(own.get("iban", "")) and own.get("name"):
        out = {"iban": own["iban"], "name": own["name"]}
    elif default and PAYEE_IBAN and PAYEE_NAME and iban_valid(PAYEE_IBAN):
        out = {"iban": PAYEE_IBAN, "name": PAYEE_NAME}
    bunq = own.get("bunq") or (PAYEE_BUNQ if default else "")
    if bunq:
        out["bunq"] = bunq
    return out or None


def init_db() -> None:
    HOUSEHOLDS.init()


# ── Scanned receipts ─────────────────────────────────────────────────────

def scan_id_to_receipt_id(scan_id: str) -> str:
    return f"scan_{scan_id}"


def run_scan(tenant: Tenant, scan_id: str, image: bytes, mime: str, created_at: float | None = None) -> dict:
    """Read the photo with Gemini and store the result. Returns the API response body."""
    rate = tenant.scan_rate if tenant.scan_rate is not None else setting("scans_per_minute")
    if rate and not SCAN_LIMITER.take(tenant.id, rate):
        raise scanning.ScanError("scan_rate_limited", "Je scant te snel. Wacht even en probeer het opnieuw.", 429)
    if not HOUSEHOLDS.try_count_scan(tenant, setting("scans_per_week")):
        raise scanning.ScanError("scan_quota", "Je scanlimiet voor deze week is bereikt.", 429)
    STATS["scans"] += 1
    scan, issues, warnings = scanning.scan_image(image, mime)
    today = time.strftime("%Y-%m-%d")
    listing, detail = scanning.to_app_shapes(scan_id_to_receipt_id(scan_id), scan, warnings, today)
    status = "draft" if issues else "ok"
    tenant.save_scan(scan_id, created_at or time.time(), status, listing, detail, scan, issues,
                     f"{scan_id}.{IMAGE_TYPES[mime]}", mime)
    body = {"scanId": scan_id, "receipt": listing, "warnings": warnings, "issues": issues}
    if issues:
        body.update({
            "error": "scan_needs_review",
            "message": "Ik heb het bonnetje gelezen, maar de bedragen kloppen niet: " + " ".join(issues),
        })
    return body


# ── Albert Heijn auth (per household) ────────────────────────────────────

class AHError(Exception):
    def __init__(self, code: str, status: int = 502):
        super().__init__(code)
        self.code = code
        self.status = status


def _store_auth(tenant: Tenant, token_data: dict) -> None:
    lifetime = token_data.get("expires_in") or DEFAULT_LIFETIME
    tenant.store_auth(token_data["access_token"], token_data["refresh_token"], time.time() + float(lifetime))


def _post_json(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{AH_API}{path}", data=json.dumps(body).encode(), headers=AH_HEADERS
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def refresh_tokens(tenant: Tenant, force: bool = False) -> bool:
    """Refresh under a lock so two threads never rotate the token at once."""
    with tenant.auth_lock:
        row = tenant.load_auth()
        if not row:
            return False
        if not force and row["expires_at"] - time.time() > REFRESH_MARGIN:
            return True  # someone else just refreshed
        try:
            _store_auth(tenant, _post_json(
                "/mobile-auth/v1/auth/token/refresh",
                {"clientId": "appie", "refreshToken": row["refresh"]},
            ))
            log.info("AH token refreshed (household %s)", tenant.id)
            return True
        except urllib.error.HTTPError as e:
            log.warning("AH token refresh rejected for household %s: %s %s", tenant.id, e.code, e.reason)
            if e.code in (400, 401, 403):
                tenant.clear_auth()  # the refresh token is dead; a fresh login is needed
            return False
        except Exception as e:  # network trouble: keep tokens, try again later
            log.warning("AH token refresh failed for household %s: %s", tenant.id, e)
            return False


LOGIN_WINDOW = 10 * 60


def exchange_code(tenant: Tenant, code: str) -> None:
    if not tenant.login_window_open():
        raise AHError("login_not_started", 409)
    try:
        _store_auth(tenant, _post_json("/mobile-auth/v1/auth/token", {"clientId": "appie", "code": code}))
        tenant.close_login_window()  # one login per window; a mistyped code can be retried until then
    except urllib.error.HTTPError as e:
        raise AHError(f"AH weigerde de code ({e.code}). Log opnieuw in.", 400)
    except Exception as e:
        raise AHError(f"Kan AH niet bereiken: {e}", 502)


class _Unauthorized(Exception):
    """AH answered 401 to a GraphQL call."""


def _graphql_once(token: str, query: str, variables: dict | None) -> dict:
    """One GraphQL call: raises _Unauthorized on 401 and AHError for any other failure."""
    req = urllib.request.Request(
        f"{AH_API}/graphql",
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={**AH_HEADERS, "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise _Unauthorized from e
        raise AHError(f"AH gaf status {e.code}", 502) from e
    except Exception as e:
        raise AHError(f"Kan AH niet bereiken: {e}", 502) from e


def ah_graphql(tenant: Tenant, query: str, variables: dict | None = None) -> dict:
    row = tenant.load_auth()
    if row and row["expires_at"] - time.time() < REFRESH_MARGIN:
        refresh_tokens(tenant)
        row = tenant.load_auth()
    if not row:
        raise AHError("ah_not_logged_in", 503)

    try:
        return _graphql_once(row["access"], query, variables)
    except _Unauthorized:
        pass  # the token was revoked early: refresh once and retry

    row = tenant.load_auth() if refresh_tokens(tenant, force=True) else None
    if not row:
        raise AHError("ah_not_logged_in", 503)
    try:
        return _graphql_once(row["access"], query, variables)
    except _Unauthorized:
        raise AHError("ah_not_logged_in", 503) from None


def auth_status(tenant: Tenant) -> dict:
    row = tenant.load_auth()
    if not row:
        return {"loggedIn": False, "reason": "not_logged_in"}
    return {"loggedIn": True, "tokenValidFor": max(0, int(row["expires_at"] - time.time()))}


def keepalive_loop() -> None:
    """Refresh every household's AH token before it expires so the logins never lapse."""
    while True:
        for tenant in HOUSEHOLDS.all():  # ponytail: scans every household each minute; fine for a self-hosted handful
            try:
                row = tenant.load_auth()
                if row and row["expires_at"] - time.time() < REFRESH_MARGIN:
                    refresh_tokens(tenant)
            except Exception:
                log.exception("keepalive failed for household %s", tenant.id)
        time.sleep(60)


def housekeeping_loop() -> None:
    """Drops old drafts (and, when RECEIPT_PHOTO_DAYS is set, old photos) of every household."""
    while True:
        for tenant in HOUSEHOLDS.all():
            try:
                tenant.purge(DRAFT_TTL, setting("photo_days"))
            except Exception:
                log.exception("housekeeping failed for household %s", tenant.id)
        time.sleep(HOUSEKEEPING_EVERY)


# ── HTTP ─────────────────────────────────────────────────────────────────

MIME = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript"}
# The admin page uses one inline script and style block, and only talks to this server.
ADMIN_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"


AUTH_FAILURES = Limiter(AUTH_FAIL_WINDOW)
REQUESTS = Limiter(60)
SCAN_LIMITER = Limiter(60)


class PayloadTooLarge(Exception):
    pass


_scan_slots = threading.BoundedSemaphore(MAX_SCANS_AT_ONCE)


@contextlib.contextmanager
def scan_slot():
    """At most MAX_SCANS_AT_ONCE uploads / Gemini calls at a time, so a burst of big photos cannot exhaust memory."""
    if not _scan_slots.acquire(blocking=False):
        raise scanning.ScanError("server_busy", "De server is druk met scannen. Probeer het zo opnieuw.", 503)
    try:
        yield
    finally:
        _scan_slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "BonnetjeServer"
    protocol_version = "HTTP/1.0"  # one request per connection: no keep-alive body desync
    timeout = SOCKET_TIMEOUT
    tenant: Tenant | None = None  # set once the key is checked; every data route reads it from here

    # -- plumbing
    def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if CORS_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if ctype.startswith("text/html"):
            self.send_header("Content-Security-Policy", ADMIN_CSP)
            self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, status: int = 200) -> None:
        self._send(status, json.dumps(obj).encode())

    def _body(self, limit: int = MAX_DATA_BYTES) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise PayloadTooLarge
        if length < 0:
            raise ValueError("bad body length")
        raw = self.rfile.read(length) if length else b""
        data = json.loads(raw) if raw else {}
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        return data

    def _client_ip(self) -> str:
        ip = self.client_address[0]
        if ip in TRUSTED_PROXIES:  # only a proxy we trust may say who the client is: its own (last) entry counts
            forwarded = self.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
            if forwarded:
                return forwarded
        return ip

    def _authenticate(self) -> Tenant | None:
        header = self.headers.get("Authorization", "")
        return HOUSEHOLDS.authenticate(header[7:] if header.startswith("Bearer ") else "", APP_KEY)

    def log_message(self, fmt, *args):  # route through logging
        log.info("%s [%s] %s", self._client_ip(), self.tenant.id if self.tenant else "-", fmt % args)

    def do_OPTIONS(self):
        self.send_response(204)
        if CORS_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = lambda self: self._dispatch("GET")
    do_POST = lambda self: self._dispatch("POST")
    do_PUT = lambda self: self._dispatch("PUT")
    do_DELETE = lambda self: self._dispatch("DELETE")

    def _dispatch(self, method: str) -> None:
        path = self.path.split("?", 1)[0]
        ip = self._client_ip()
        try:
            if not path.startswith("/api/"):
                return self._static(path) if method == "GET" else self._json({"error": "not_found"}, 404)
            if path == "/api/health" and method == "GET":
                return self._json({"ok": True, "ahEnabled": USE_AH_API})  # the server page reads this without a key
            STATS["requests"] += 1
            if AUTH_FAILURES.full(ip, AUTH_FAIL_LIMIT):
                STATS["rateLimited"] += 1
                return self._json({"error": "too_many_attempts"}, 429)
            self.tenant = self._authenticate()
            if self.tenant is None:
                STATS["unauthorized"] += 1
                AUTH_FAILURES.add(ip)
                return self._json({"error": "unauthorized"}, 401)
            HOUSEHOLDS.touch(self.tenant.id)
            limit = self.tenant.request_limit if self.tenant.request_limit is not None else setting("requests_per_minute")
            if limit and not REQUESTS.take(self.tenant.id, limit):
                STATS["rateLimited"] += 1
                return self._json({"error": "rate_limited"}, 429)
            self._route(method, path)
        except scanning.ScanError as e:
            self._json({"error": e.code, "message": e.message}, e.status)
        except AHError as e:
            self._json({"error": e.code}, e.status)
        except PayloadTooLarge:
            self._json({"error": "too_large"}, 413)
        except (ValueError, json.JSONDecodeError):
            self._json({"error": "bad_request"}, 400)
        except Exception:
            STATS["errors"] += 1
            log.exception("unhandled error")
            self._json({"error": "server_error"}, 500)

    # -- routes: each returns True when it handled the request
    def _route(self, method: str, path: str) -> None:
        for handler in (self._route_auth, self._route_receipts, self._route_scans, self._route_data):
            if handler(method, path):
                return
        self._json({"error": "not_found"}, 404)

    def _ah_for_tenant(self) -> bool:
        t = self.tenant.ah_enabled
        return t if t is not None else USE_AH_API

    def _route_auth(self, method: str, path: str) -> bool:
        tenant = self.tenant
        ah = self._ah_for_tenant()
        if path == "/api/auth/status" and method == "GET":
            self._json({
                **auth_status(tenant),
                "ahEnabled": ah,
                "loginUrl": AH_LOGIN_URL if ah else None,
                "scanEnabled": bool(scanning.GEMINI_KEY),
                "payee": payee(tenant),
            })
        elif path.startswith("/api/auth/") and path != "/api/auth/status" and not ah:
            raise AHError("ah_disabled", 404)  # begin / exchange / logout only exist with RECEIPT_USE_AH_API=true
        elif path == "/api/auth/begin" and method == "POST":
            tenant.begin_login(LOGIN_WINDOW)
            self._json({"ok": True, "validFor": LOGIN_WINDOW})
        elif path == "/api/auth/exchange" and method == "POST":
            code = str(self._body().get("code", "")).strip()
            m = re.search(r"code=([^&\s]+)", code)  # accept the whole appie:// URL too
            code = m.group(1) if m else code
            if not code:
                raise ValueError("no code")
            exchange_code(tenant, code)
            self._json({"ok": True})
        elif path == "/api/auth/logout" and method == "POST":
            tenant.clear_auth()
            self._json({"ok": True})
        else:
            return False
        return True

    def _route_receipts(self, method: str, path: str) -> bool:
        tenant = self.tenant
        ah = self._ah_for_tenant()
        if method != "GET":
            return False
        if path == "/api/receipts":
            receipts, ah_error, cached_at = [], "", 0.0
            if ah:
                try:
                    data = ah_graphql(tenant, RECEIPTS_QUERY, {"offset": 0, "limit": 100})
                    page = ((data or {}).get("data") or {}).get("posReceiptsPage")
                    if page is None:
                        raise AHError("ah_bad_response", 502)
                    receipts = page.get("posReceipts") or []
                    tenant.cache_put("list", receipts)
                except AHError as e:
                    ah_error = e.code  # fall back to the last list we saw; scans are unaffected
                    receipts, cached_at = tenant.cache_get("list")
                    receipts = receipts or []
            merged = sorted(receipts + tenant.scanned_receipts(), key=lambda r: r.get("dateTime", ""), reverse=True)
            self._json({"receipts": merged, "ahError": ah_error, "cachedAt": cached_at})
            return True

        m = re.fullmatch(r"/api/receipts/([A-Za-z0-9_-]+)", path)
        if not m:
            return False
        receipt_id = m.group(1)
        if receipt_id.startswith("scan_"):
            detail = tenant.scanned_detail(receipt_id)
        else:
            detail = self._ah_detail(receipt_id) if ah else None
        self._json(detail if detail is not None else {"error": "not_found"}, 200 if detail is not None else 404)
        return True

    def _ah_detail(self, receipt_id: str) -> dict | None:
        """AH receipt details, falling back to the last copy we saw when AH is unavailable."""
        tenant, key = self.tenant, f"detail:{receipt_id}"
        try:
            data = ah_graphql(tenant, DETAIL_QUERY, {"id": receipt_id})
            detail = ((data or {}).get("data") or {}).get("posReceiptDetails")
            if detail is not None:
                tenant.cache_put(key, detail)
            return detail
        except AHError:
            cached, at = tenant.cache_get(key)
            if cached is None:
                raise
            return {**cached, "cachedAt": at}

    def _route_scans(self, method: str, path: str) -> bool:
        tenant = self.tenant
        if path == "/api/scans" and method == "POST":
            with scan_slot():
                self._create_scan()
            return True

        m = re.fullmatch(r"/api/scans/([0-9a-f]{16})(?:/(accept|rescan|image))?", path)
        if not m:
            return False
        scan_id, action = m.group(1), m.group(2)
        row = tenant.scan(scan_id)  # this household's own database: another household's scan simply isn't there
        if not row:
            self._json({"error": "not_found"}, 404)
        elif action == "accept" and method == "POST":
            tenant.set_scan_status(scan_id, "ok")
            self._json({"receipt": json.loads(row["listing"])})
        elif action in ("rescan", "image") and not tenant.photo_path(row["image_file"]).is_file():
            self._json({"error": "photo_missing"}, 404)
        elif action == "rescan" and method == "POST":
            with scan_slot():
                result = run_scan(tenant, scan_id, tenant.photo_path(row["image_file"]).read_bytes(), row["mime"], row["created_at"])
            if row["status"] == "ok":  # a rescan of a kept receipt stays kept; review is only for drafts
                tenant.set_scan_status(scan_id, "ok")
            self._json(result)
        elif action == "image" and method == "GET":
            self._send(200, tenant.photo_path(row["image_file"]).read_bytes(), row["mime"])
        elif action is None and method == "DELETE":
            tenant.delete_scan(scan_id)
            self._json({"ok": True})
        else:
            return False
        return True

    def _create_scan(self) -> None:
        tenant = self.tenant
        body = self._body(MAX_BODY)
        mime = str(body.get("mimeType") or "image/jpeg").lower()
        if mime not in IMAGE_TYPES:
            raise scanning.ScanError("bad_image_type", "Dit bestandstype kan ik niet lezen. Gebruik JPEG, PNG, WebP of HEIC.", 415)
        try:
            image = base64.b64decode(body.get("image") or "", validate=True)
        except Exception:
            raise scanning.ScanError("bad_image", "De foto kwam niet goed aan. Probeer het opnieuw.", 400) from None
        if not image:
            raise scanning.ScanError("bad_image", "De foto is leeg.", 400)

        scan_id = uuid.uuid4().hex[:16]
        photo = tenant.photo_path(f"{scan_id}.{IMAGE_TYPES[mime]}")
        photo.write_bytes(image)
        try:
            result = run_scan(tenant, scan_id, image, mime)
        except Exception:
            photo.unlink(missing_ok=True)  # nothing was stored, so don't keep the photo either
            raise
        self._json(result, 422 if result["issues"] else 201)

    def _route_data(self, method: str, path: str) -> bool:
        if path != "/api/data":
            return False
        if method == "GET":
            data, version = self.tenant.read_data()
            self._json({"data": data, "version": version})
        elif method == "PUT":
            body = self._body()
            data, base = body.get("data"), body.get("baseVersion")
            if not isinstance(data, dict) or not isinstance(base, int):
                raise ValueError("data/baseVersion required")
            ok, current, version = self.tenant.write_data(data, base)
            if ok:
                self._json({"version": version})
            else:
                self._json({"error": "conflict", "data": current, "version": version}, 409)
        else:
            return False
        return True

    def _static(self, path: str) -> None:
        name = "admin.html" if path in ("/", "") else path.lstrip("/")
        f = (STATIC_DIR / name).resolve()
        if STATIC_DIR.resolve() not in f.parents or not f.is_file():
            return self._json({"error": "not_found"}, 404)
        self._send(200, f.read_bytes(), MIME.get(f.suffix, "application/octet-stream"))


class Server(ThreadingHTTPServer):
    """A thread per request, but never more than MAX_CONNECTIONS at once."""
    daemon_threads = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._slots = threading.BoundedSemaphore(MAX_CONNECTIONS)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def server_info() -> dict:
    return {
        "uptimeSeconds": int(time.time() - STARTED), "ahEnabled": USE_AH_API,
        "geminiEnabled": bool(scanning.GEMINI_KEY), "geminiModel": scanning.GEMINI_MODEL,
        "dataDir": str(DATA_DIR), "port": PORT, "maxConnections": MAX_CONNECTIONS,
        "corsOrigin": CORS_ORIGIN, "trustedProxies": sorted(TRUSTED_PROXIES), "builtinHousehold": HOUSEHOLDS.use_default,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.umask(0o077)  # everything the server creates (databases, photos) is private to its user
    if len(sys.argv) > 1 and sys.argv[1] == "tenant":
        sys.exit(tenants.cli(HOUSEHOLDS, sys.argv[2:], iban_valid))
    try:
        HOUSEHOLDS.init()
    except OSError as e:
        sys.exit(f"Cannot write to the data folder {DATA_DIR}: {e}. The server runs as an unprivileged user; "
                 "make the folder writable for it (Docker: chown -R 10001:10001 state).")
    if not HOUSEHOLDS.use_default and not HOUSEHOLDS.rows():
        sys.exit("No household yet. Set RECEIPT_APP_KEY (a password of your choice; make one with: "
                 "python3 -c 'import secrets; print(secrets.token_urlsafe(32))'), "
                 "or create households with: python3 server.py tenant add \"Name\"")
    if HOUSEHOLDS.use_default and payee(HOUSEHOLDS.default()) is None:
        log.warning(
            "RECEIPT_IBAN / RECEIPT_NAME are %s: the app cannot show a payment QR code.",
            "invalid" if PAYEE_IBAN and not iban_valid(PAYEE_IBAN) else "not set",
        )
    for tenant in HOUSEHOLDS.all():
        tenant.purge(DRAFT_TTL, setting("photo_days"))
    threading.Thread(target=housekeeping_loop, daemon=True).start()
    if USE_AH_API:
        threading.Thread(target=keepalive_loop, daemon=True).start()
    else:
        log.info("Albert Heijn integration is off (RECEIPT_USE_AH_API is not true)")
    if ADMIN_PORT and not ADMIN_KEY:
        log.warning("RECEIPT_ADMIN_PORT is set but RECEIPT_ADMIN_KEY is not: the admin dashboard stays off.")
    elif ADMIN_PORT:
        admin.serve(ADMIN_HOST, ADMIN_PORT, ADMIN_KEY, SimpleNamespace(
            households=HOUSEHOLDS, stats=STATS, setting=setting, setting_source=setting_source,
            iban_valid=iban_valid, info=server_info,
        ))
        log.info("Admin dashboard on http://%s:%s", ADMIN_HOST, ADMIN_PORT)
    log.info("Listening on http://%s:%s (data: %s)", HOST, PORT, DATA_DIR)
    # As PID 1 in Docker, Python ignores SIGTERM unless it has a handler: `docker stop` would wait 10 s, then kill.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    Server((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
