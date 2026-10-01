"""The admin dashboard: a second, separate HTTP server for the person who runs this one.

* Off unless RECEIPT_ADMIN_PORT and RECEIPT_ADMIN_KEY are both set.
* Listens on 0.0.0.0 inside Docker; the compose file publishes the port to the LAN.
* Needs the admin key on every API call (a header, never a cookie), only answers to private/LAN host names
  (localhost, private IPs, .local mDNS — blocks DNS rebinding from the public internet), and sends no CORS headers.

It creates and changes households through the same registry the `tenant` command uses. It never shows a household's
key (only hashes are stored): a key is shown once, when it is made or replaced.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from limiter import Limiter
from tenants import DEFAULT_ID, ID_RE, clean_bunq

log = logging.getLogger("receipt.admin")

PAGE = Path(__file__).parent / "admin" / "dashboard.html"
CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
import ipaddress as _ip

def _is_private_host(host: str) -> bool:
    """Allow localhost names and private/LAN IP addresses in the Host header."""
    if host in LOCAL_HOSTS:
        return True
    try:
        return _ip.ip_address(host.strip("[]")).is_private
    except ValueError:
        return host.endswith(".local")  # mDNS names
MAX_BODY = 64 * 1024
LIMIT_FIELDS = {"week": "scan_limit", "requests": "request_limit", "rate": "scan_rate"}
SETTING_MAX = {"requests_per_minute": 1_000_000, "scans_per_minute": 1_000_000, "scans_per_week": 1_000_000, "photo_days": 3650}
_failures = Limiter(60)


class BadInput(Exception):
    pass


def _limit(value):
    """None (use the server-wide value) or a whole number from 0 (unlimited) up."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 1_000_000:
        raise BadInput("Limieten zijn hele getallen vanaf 0 (0 = onbeperkt).")
    return value


class Api:
    """The dashboard's operations. `ctx` is what the server passes in (households, counters, settings)."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.hh = ctx.households

    # -- views
    def _limits(self, tenant, builtin: bool) -> dict:
        ctx = self.ctx
        own = {"week": tenant.scan_limit, "requests": tenant.request_limit, "rate": tenant.scan_rate}
        server = {"week": ctx.setting("scans_per_week"), "requests": ctx.setting("requests_per_minute"),
                  "rate": ctx.setting("scans_per_minute")}
        out = {}
        for name in own:
            if builtin and name == "week":
                out[name] = {"own": None, "effective": 0}  # the built-in household is never limited on scans per week
            else:
                out[name] = {"own": own[name], "effective": server[name] if own[name] is None else own[name]}
        return out

    def _household(self, tenant, seen: dict, builtin: bool, disabled: bool = False, created=None) -> dict:
        try:
            stats = tenant.stats()
        except Exception:  # a broken database must not take the whole overview down
            log.exception("stats failed for household %s", tenant.id)
            stats = None
        return {
            "id": tenant.id, "name": tenant.name if not builtin else "Standaard (RECEIPT_APP_KEY)",
            "builtin": builtin, "disabled": disabled, "createdAt": created, "lastSeen": seen.get(tenant.id),
            "scansWeek": self.hh.scans_this_week(tenant.id), "scansTotal": self.hh.scans_total(tenant.id),
            "limits": self._limits(tenant, builtin), "stats": stats,
            "ahEnabled": tenant.ah_enabled,
        }

    def households(self) -> list[dict]:
        seen = self.hh.last_seen()
        out = [self._household(self.hh.default(), seen, True)] if self.hh.use_default else []
        for row in self.hh.rows():
            out.append(self._household(self.hh._registered(row), seen, False, bool(row["disabled"]), row["created_at"]))
        return out

    def overview(self) -> dict:
        ctx = self.ctx
        houses = self.households()
        return {
            "server": ctx.info(),
            "counters": dict(ctx.stats),
            "totals": {
                "households": len(houses), "active": sum(1 for h in houses if not h["disabled"]),
                "scansWeek": sum(h["scansWeek"] for h in houses),
                "bytes": sum((h["stats"] or {}).get("bytes", 0) for h in houses),
            },
            "settings": {name: {"value": ctx.setting(name), "source": ctx.setting_source(name)} for name in SETTING_MAX},
        }

    # -- changes
    def _tenant(self, tid: str):
        if tid != DEFAULT_ID and not ID_RE.fullmatch(tid):
            raise KeyError(tid)
        return self.hh.tenant(tid)

    def create(self, body: dict) -> dict:
        name = str(body.get("name") or "").strip()
        if not name:
            raise BadInput("Geef het huishouden een naam.")
        ah = body.get("ahEnabled")
        ah_val = None if ah is None else (1 if ah else 0)
        tenant, key = self.hh.add(name, _limit(body.get("week")), _limit(body.get("requests")), _limit(body.get("rate")), ah_val)
        log.info("admin: household %s created", tenant.id)
        return {"id": tenant.id, "key": key}

    def update(self, tid: str, body: dict) -> dict:
        self._tenant(tid)
        changes = {}
        if "name" in body:
            if not str(body["name"]).strip():
                raise BadInput("De naam mag niet leeg zijn.")
            changes["name"] = body["name"]
        if "disabled" in body:
            changes["disabled"] = 1 if body["disabled"] else 0
        for short, column in LIMIT_FIELDS.items():
            if short in body:
                changes[column] = _limit(body[short])
        if "ahEnabled" in body:
            ah = body["ahEnabled"]
            changes["ah_enabled"] = None if ah is None else (1 if ah else 0)
        if "payee" in body:
            self._payee(tid, body["payee"])
        if changes:
            if tid == DEFAULT_ID:
                raise BadInput("Het standaard huishouden hoort bij RECEIPT_APP_KEY uit .env; hier kun je alleen het betaalaccount aanpassen.")
            self.hh.update(tid, **changes)
        log.info("admin: household %s changed: %s", tid, sorted(set(body)))
        return {"ok": True}

    def _payee(self, tid: str, payee):
        tenant = self._tenant(tid)
        if payee is None:
            tenant.set_setting("payee", None)
            return
        if not isinstance(payee, dict):
            raise BadInput("Dit IBAN of deze naam is niet geldig.")
        iban = re.sub(r"\s+", "", str(payee.get("iban", ""))).upper()
        name = str(payee.get("name", "")).strip()[:70]
        if not self.ctx.iban_valid(iban) or not name:
            raise BadInput("Dit IBAN of deze naam is niet geldig.")
        try:
            bunq = clean_bunq(payee.get("bunq"))
        except ValueError:
            raise BadInput("Deze bunq-naam is niet geldig.")
        tenant.set_setting("payee", {"iban": iban, "name": name, **({"bunq": bunq} if bunq else {})})

    def rotate(self, tid: str) -> dict:
        if tid == DEFAULT_ID:
            raise BadInput("Het standaard huishouden gebruikt RECEIPT_APP_KEY uit .env; pas die daar aan.")
        key = self.hh.rotate(tid)
        log.info("admin: key of household %s replaced", tid)
        return {"key": key}

    def delete(self, tid: str, body: dict) -> dict:
        if tid == DEFAULT_ID:
            raise BadInput("Het standaard huishouden kan hier niet worden verwijderd.")
        row = self.hh.row(tid)
        if body.get("confirm") != row["name"]:
            raise BadInput("Typ de naam van het huishouden om te bevestigen.")
        self.hh.delete(tid)
        log.info("admin: household %s deleted", tid)
        return {"ok": True}

    def change_settings(self, body: dict) -> dict:
        changes = {}
        for name, value in body.items():
            if name not in SETTING_MAX:
                raise BadInput(f"Onbekende instelling: {name}.")
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= SETTING_MAX[name]):
                raise BadInput(f"{name} moet een geheel getal zijn van 0 tot {SETTING_MAX[name]}.")
            changes[name] = value
        self.hh.set_settings(changes)
        log.info("admin: settings changed: %s", sorted(changes))
        return {"ok": True}


def make_handler(key: str, api: Api):
    class Handler(BaseHTTPRequestHandler):
        server_version = "BonnetjeAdmin"
        protocol_version = "HTTP/1.0"
        timeout = 30

        def log_message(self, fmt, *args):
            log.info("%s %s", self.client_address[0], fmt % args)

        def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            if ctype.startswith("text/html"):
                self.send_header("Content-Security-Policy", CSP)
                self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, status: int = 200) -> None:
            self._send(status, json.dumps(obj).encode())

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 <= length <= MAX_BODY:
                raise BadInput("Verzoek te groot.")
            raw = self.rfile.read(length) if length else b""
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict):
                raise BadInput("Verwacht een JSON-object.")
            return data

        def _allowed(self) -> bool:
            host = self.headers.get("Host", "").lower()
            host = host.rsplit(":", 1)[0] if not host.endswith("]") else host  # strip the port, keep [::1]
            return _is_private_host(host)

        do_GET = lambda self: self._dispatch("GET")
        do_POST = lambda self: self._dispatch("POST")
        do_PUT = lambda self: self._dispatch("PUT")
        do_DELETE = lambda self: self._dispatch("DELETE")

        def _dispatch(self, method: str) -> None:
            path = self.path.split("?", 1)[0]
            ip = self.client_address[0]
            try:
                if not self._allowed():
                    return self._json({"error": "forbidden_host"}, 403)
                if method == "GET" and path == "/":
                    return self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
                if not path.startswith("/api/"):
                    return self._json({"error": "not_found"}, 404)
                if _failures.full(ip, 10):
                    return self._json({"error": "too_many_attempts"}, 429)
                header = self.headers.get("Authorization", "")
                if not hmac.compare_digest(header[7:].encode() if header.startswith("Bearer ") else b"", key.encode()):
                    _failures.add(ip)
                    return self._json({"error": "unauthorized"}, 401)
                self._route(method, path)
            except BadInput as e:
                self._json({"error": "bad_request", "message": str(e)}, 400)
            except KeyError:
                self._json({"error": "not_found"}, 404)
            except (ValueError, json.JSONDecodeError):
                self._json({"error": "bad_request", "message": "Ongeldig verzoek."}, 400)
            except Exception:
                log.exception("admin error")
                self._json({"error": "server_error"}, 500)

        def _route(self, method: str, path: str) -> None:
            if method == "GET" and path == "/api/overview":
                return self._json(api.overview())
            if method == "GET" and path == "/api/households":
                return self._json(api.households())
            if method == "POST" and path == "/api/households":
                return self._json(api.create(self._body()), 201)
            if method == "PUT" and path == "/api/settings":
                return self._json(api.change_settings(self._body()))
            m = re.fullmatch(r"/api/households/([0-9a-f]{16}|default)(?:/(rotate))?", path)
            if m:
                tid, action = m.groups()
                if method == "PUT" and action is None:
                    return self._json(api.update(tid, self._body()))
                if method == "POST" and action == "rotate":
                    return self._json(api.rotate(tid))
                if method == "DELETE" and action is None:
                    return self._json(api.delete(tid, self._body()))
            self._json({"error": "not_found"}, 404)

    return Handler


def serve(host: str, port: int, key: str, ctx) -> ThreadingHTTPServer:
    """Starts the dashboard in a background thread and returns the server."""
    import threading

    httpd = ThreadingHTTPServer((host, port), make_handler(key, Api(ctx)))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
