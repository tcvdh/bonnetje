"""Users (tenants): who may connect, and where each user's data lives.

Every user gets its own private folder with its own SQLite database and photos, so one user's
requests can only ever open that user's files: there is no shared table to leak from.

* `default`  the user of RECEIPT_APP_KEY. It uses the original layout (DATA_DIR/receipt.db and
             DATA_DIR/scans), so a server that started with one key keeps working, data and all.
* others     created with `python3 server.py tenant add "Name"`; folder DATA_DIR/tenants/<id>/.
             Their keys are random, shown once and only stored as a hash in DATA_DIR/registry.db.

All SQL lives in this file. server.py never touches a database or a photo except through a `Tenant`.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

DEFAULT_ID = "default"
ID_RE = re.compile(r"[0-9a-f]{16}")
PHOTO_RE = re.compile(r"[0-9a-f]{16}\.(?:jpg|png|webp|heic|heif)")
KEY_PREFIX = "bk_"

EMPTY_DATA = {
    "assignments": {},
    "completed": [],
    "hidden": [],
    "paid": {},
    "people": [],
    "discountOverrides": {},
}


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class Tenant:
    """One user: its folder, database and photos. Created only by `Users`, one object per user."""

    def __init__(self, tid: str, name: str, root: Path):
        if tid != DEFAULT_ID and not ID_RE.fullmatch(tid):
            raise ValueError("bad user id")
        self.id, self.name = tid, name
        self.db_path = root / "receipt.db"
        self.scan_dir = root / "scans"
        # Per-user overrides from the registry; None = the server-wide default, 0 = unlimited.
        self.scan_limit: int | None = None     # Gemini scans per week
        self.request_limit: int | None = None  # requests per minute
        self.scan_rate: int | None = None      # scans per minute
        self.ah_enabled: bool | None = None    # None = follow global USE_AH_API
        self.auth_lock = threading.Lock()  # Albert Heijn token refresh
        self.scan_lock = threading.Lock()  # one scan at a time (server.scan_slot)
        self._login_lock = threading.Lock()
        self._login_open_until = 0.0

    # -- storage plumbing
    @contextmanager
    def db(self):
        """A connection that commits on success, rolls back on error, and is always closed."""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def init(self) -> None:
        for private in (self.db_path.parent, self.scan_dir):  # receipts, photos and AH tokens live here
            private.mkdir(parents=True, exist_ok=True)
            os.chmod(private, 0o700)
        with self.db() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute(
                "CREATE TABLE IF NOT EXISTS app_data ("
                " id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, json TEXT NOT NULL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS ah_auth ("
                " id INTEGER PRIMARY KEY CHECK (id = 1), access TEXT NOT NULL,"
                " refresh TEXT NOT NULL, expires_at REAL NOT NULL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS ah_cache ("
                " key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at REAL NOT NULL)"
            )
            c.execute(
                "CREATE TABLE IF NOT EXISTS scans ("
                " id TEXT PRIMARY KEY, created_at REAL NOT NULL, status TEXT NOT NULL,"
                " listing TEXT NOT NULL, detail TEXT NOT NULL, raw TEXT NOT NULL,"
                " issues TEXT NOT NULL, image_file TEXT NOT NULL, mime TEXT NOT NULL)"
            )
            c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            c.execute("INSERT OR IGNORE INTO app_data (id, version, json) VALUES (1, 0, ?)", (json.dumps(EMPTY_DATA),))
        os.chmod(self.db_path, 0o600)

    # -- the split data
    def read_data(self) -> tuple[dict, int]:
        with self.db() as c:
            row = c.execute("SELECT version, json FROM app_data WHERE id = 1").fetchone()
        return json.loads(row["json"]), row["version"]

    def write_data(self, data: dict, base_version: int) -> tuple[bool, dict, int]:
        """Compare-and-swap. Returns (ok, current_data, current_version)."""
        with self.db() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT version, json FROM app_data WHERE id = 1").fetchone()
            if row["version"] != base_version:
                return False, json.loads(row["json"]), row["version"]
            new_version = row["version"] + 1
            c.execute("UPDATE app_data SET version = ?, json = ? WHERE id = 1", (new_version, json.dumps(data)))
            return True, data, new_version

    # -- settings (where this user's housemates pay)
    def get_setting(self, key: str):
        with self.db() as c:
            row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def set_setting(self, key: str, value) -> None:
        with self.db() as c:
            c.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )

    # -- scanned receipts. status: "draft" (needs the user's OK), "ok" (kept). Drafts expire.
    def photo_path(self, name: str) -> Path:
        if not PHOTO_RE.fullmatch(name):
            raise ValueError("bad photo name")
        return self.scan_dir / name

    def save_scan(self, scan_id, created_at, status, listing, detail, raw, issues, image_file, mime) -> None:
        with self.db() as c:
            c.execute(
                "INSERT INTO scans (id, created_at, status, listing, detail, raw, issues, image_file, mime) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET status=excluded.status, listing=excluded.listing, "
                "detail=excluded.detail, raw=excluded.raw, issues=excluded.issues",
                (scan_id, created_at, status, json.dumps(listing), json.dumps(detail), json.dumps(raw),
                 json.dumps(issues), image_file, mime),
            )

    def scan(self, scan_id: str):
        with self.db() as c:
            return c.execute("SELECT * FROM scans WHERE id = ?", (scan_id,)).fetchone()

    def set_scan_status(self, scan_id: str, status: str) -> None:
        with self.db() as c:
            c.execute("UPDATE scans SET status = ? WHERE id = ?", (status, scan_id))

    def delete_scan(self, scan_id: str) -> None:
        """Removes the scan and its photo for good."""
        row = self.scan(scan_id)
        with self.db() as c:
            c.execute("DELETE FROM scans WHERE id = ?", (scan_id,))
        if row:
            self.photo_path(row["image_file"]).unlink(missing_ok=True)

    def scanned_receipts(self) -> list[dict]:
        with self.db() as c:
            rows = c.execute("SELECT listing FROM scans WHERE status = 'ok'").fetchall()
        return [json.loads(r["listing"]) for r in rows]

    def scanned_detail(self, receipt_id: str) -> dict | None:
        with self.db() as c:
            row = c.execute(
                "SELECT detail FROM scans WHERE id = ? AND status = 'ok'", (receipt_id.removeprefix("scan_"),)
            ).fetchone()
        return json.loads(row["detail"]) if row else None

    def purge(self, draft_ttl: float, photo_days: int) -> None:
        """Housekeeping: old drafts go, and (when photo_days is set) so do photos of kept receipts."""
        now = time.time()
        with self.db() as c:
            drafts = c.execute(
                "SELECT id FROM scans WHERE status = 'draft' AND created_at < ?", (now - draft_ttl,)
            ).fetchall()
            old = c.execute(
                "SELECT image_file FROM scans WHERE status = 'ok' AND created_at < ?", (now - photo_days * 86400,)
            ).fetchall() if photo_days > 0 else []
        for r in drafts:
            self.delete_scan(r["id"])
        for r in old:
            self.photo_path(r["image_file"]).unlink(missing_ok=True)  # the receipt stays, only the photo goes

    def stats(self) -> dict:
        """What this user holds, for the admin dashboard."""
        # ponytail: parses the user's data and walks its photos; fine for hundreds of users, cache it beyond that
        data, version = self.read_data()
        with self.db() as c:
            scans = c.execute("SELECT status, COUNT(*) AS n FROM scans GROUP BY status").fetchall()
        def size(path: Path) -> int:  # SQLite creates and removes its -wal / -shm files at any moment
            try:
                return path.stat().st_size
            except FileNotFoundError:
                return 0

        photos = list(self.scan_dir.iterdir()) if self.scan_dir.is_dir() else []
        db_bytes = sum(size(p) for p in self.db_path.parent.glob("receipt.db*"))
        return {
            "people": len(data.get("people", [])),
            "receiptsSplit": len(data.get("assignments", {})),
            "receiptsDone": len(data.get("completed", [])),
            "invoices": len(data.get("invoices", [])),
            "version": version,
            "scans": sum(r["n"] for r in scans if r["status"] == "ok"),
            "drafts": sum(r["n"] for r in scans if r["status"] == "draft"),
            "photos": len(photos),
            "bytes": db_bytes + sum(size(p) for p in photos),
            "ahLoggedIn": self.load_auth() is not None,
            "payee": self.get_setting("payee"),
        }

    # -- last known Albert Heijn data, so receipts stay visible while AH is not logged in
    def cache_put(self, key: str, value) -> None:
        with self.db() as c:
            c.execute(
                "INSERT INTO ah_cache (key, json, fetched_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at",
                (key, json.dumps(value), time.time()),
            )

    def cache_get(self, key: str):
        with self.db() as c:
            row = c.execute("SELECT json, fetched_at FROM ah_cache WHERE key = ?", (key,)).fetchone()
        return (json.loads(row["json"]), row["fetched_at"]) if row else (None, 0.0)

    # -- Albert Heijn login of this user (only used with RECEIPT_USE_AH_API=true)
    def load_auth(self):
        with self.db() as c:
            return c.execute("SELECT access, refresh, expires_at FROM ah_auth WHERE id = 1").fetchone()

    def store_auth(self, access: str, refresh: str, expires_at: float) -> None:
        with self.db() as c:
            c.execute(
                "INSERT INTO ah_auth (id, access, refresh, expires_at) VALUES (1, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET access=excluded.access, "
                "refresh=excluded.refresh, expires_at=excluded.expires_at",
                (access, refresh, expires_at),
            )

    def clear_auth(self) -> None:
        with self.db() as c:
            c.execute("DELETE FROM ah_auth")

    # A login code is only accepted shortly after a login was started from the server's own page.
    # Otherwise any web page could hand your browser (and the appie:// helper) a code from an attacker's
    # Albert Heijn account and quietly switch the user over to it.
    def begin_login(self, window: float) -> None:
        with self._login_lock:
            self._login_open_until = time.time() + window

    def login_window_open(self) -> bool:
        with self._login_lock:
            return time.time() <= self._login_open_until

    def close_login_window(self) -> None:
        with self._login_lock:
            self._login_open_until = 0.0


class Users:
    """The registry: which key belongs to which user, plus scan usage per week."""

    def __init__(self, data_dir: Path, use_default: bool):
        self.data_dir = Path(data_dir)
        self.use_default = use_default  # RECEIPT_APP_KEY is set
        self.registry_path = self.data_dir / "registry.db"
        self._tenants: dict[str, Tenant] = {}
        self._lock = threading.Lock()
        self._seen: dict[str, float] = {}      # last time we wrote "last seen", so it is at most once a minute
        self._settings_cache: tuple[float, dict] = (0.0, {})

    @contextmanager
    def _reg(self):
        conn = sqlite3.connect(self.registry_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def init(self) -> None:
        for private in (self.data_dir, self.data_dir / "tenants"):
            private.mkdir(parents=True, exist_ok=True)
            os.chmod(private, 0o700)
        with self._reg() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute(
                "CREATE TABLE IF NOT EXISTS tenants ("
                " id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,"
                " created_at REAL NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, scan_limit INTEGER)"
            )
            for column in ("request_limit", "scan_rate", "ah_enabled"):
                if column not in {r["name"] for r in c.execute("PRAGMA table_info(tenants)")}:
                    c.execute(f"ALTER TABLE tenants ADD COLUMN {column} INTEGER")
            c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            c.execute("CREATE TABLE IF NOT EXISTS seen (tenant_id TEXT PRIMARY KEY, at REAL NOT NULL)")
            c.execute(
                "CREATE TABLE IF NOT EXISTS usage ("
                " tenant_id TEXT NOT NULL, week TEXT NOT NULL, scans INTEGER NOT NULL,"
                " PRIMARY KEY (tenant_id, week))"
            )
            if "month" in {r["name"] for r in c.execute("PRAGMA table_info(usage)")}:  # older servers named it wrongly
                c.execute("ALTER TABLE usage RENAME COLUMN month TO week")
        os.chmod(self.registry_path, 0o600)
        for tenant in self.all():
            tenant.init()

    # -- looking users up
    def _get(self, tid: str, name: str, root: Path) -> Tenant:
        with self._lock:  # one object per user: it holds that user's locks
            if tid not in self._tenants:
                self._tenants[tid] = Tenant(tid, name, root)
            return self._tenants[tid]

    def default(self) -> Tenant:
        return self._get(DEFAULT_ID, "default", self.data_dir)

    def _registered(self, row) -> Tenant:
        tenant = self._get(row["id"], row["name"], self.data_dir / "tenants" / row["id"])
        tenant.name = row["name"]
        tenant.scan_limit, tenant.request_limit, tenant.scan_rate = row["scan_limit"], row["request_limit"], row["scan_rate"]
        tenant.ah_enabled = None if row["ah_enabled"] is None else bool(row["ah_enabled"])
        return tenant

    def rows(self) -> list[sqlite3.Row]:
        with self._reg() as c:
            return c.execute("SELECT * FROM tenants ORDER BY created_at").fetchall()

    def all(self) -> list[Tenant]:
        """Every user that may currently use the server."""
        active = [self._registered(r) for r in self.rows() if not r["disabled"]]
        return ([self.default()] if self.use_default else []) + active

    def authenticate(self, key: str, env_key: str) -> Tenant | None:
        """The user this key belongs to, or None. Keys are 256-bit random, so hashing them and looking
        the hash up leaks nothing useful; the env key is compared in constant time."""
        if not key:
            return None
        if self.use_default and hmac.compare_digest(_hash(key), _hash(env_key)):
            return self.default()
        with self._reg() as c:
            row = c.execute("SELECT * FROM tenants WHERE key_hash = ? AND disabled = 0", (_hash(key),)).fetchone()
        return self._registered(row) if row else None

    # -- managing users (the `tenant` command)
    @staticmethod
    def clean_name(name: str) -> str:
        return re.sub(r"[\x00-\x1f]", " ", str(name)).strip()[:60] or "user"

    def add(self, name: str, scan_limit: int | None = None, request_limit: int | None = None,
            scan_rate: int | None = None, ah_enabled: int | None = None) -> tuple[Tenant, str]:
        tid, key = secrets.token_hex(8), KEY_PREFIX + secrets.token_urlsafe(32)
        with self._reg() as c:
            c.execute(
                "INSERT INTO tenants (id, name, key_hash, created_at, scan_limit, request_limit, scan_rate, ah_enabled) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (tid, self.clean_name(name), _hash(key), time.time(), scan_limit, request_limit, scan_rate, ah_enabled),
            )
        tenant = self._registered(self.row(tid))
        tenant.init()
        return tenant, key

    def row(self, tid: str):
        with self._reg() as c:
            row = c.execute("SELECT * FROM tenants WHERE id = ?", (tid,)).fetchone()
        if not row:
            raise KeyError(tid)
        return row

    def tenant(self, tid: str) -> Tenant:
        return self.default() if tid == DEFAULT_ID and self.use_default else self._registered(self.row(tid))

    def rotate(self, tid: str) -> str:
        key = KEY_PREFIX + secrets.token_urlsafe(32)
        self.row(tid)
        with self._reg() as c:
            c.execute("UPDATE tenants SET key_hash = ? WHERE id = ?", (_hash(key), tid))
        return key

    def update(self, tid: str, **fields) -> None:
        self.row(tid)
        if not set(fields) <= {"name", "disabled", "scan_limit", "request_limit", "scan_rate", "ah_enabled"}:
            raise ValueError("unknown user field")
        if "name" in fields:
            fields["name"] = self.clean_name(fields["name"])
        with self._reg() as c:
            for column, value in fields.items():
                c.execute(f"UPDATE tenants SET {column} = ? WHERE id = ?", (value, tid))

    def delete(self, tid: str) -> None:
        """Removes the user and everything it stored: registry row, database, photos."""
        self.row(tid)
        with self._reg() as c:
            for table, column in (("tenants", "id"), ("usage", "tenant_id"), ("seen", "tenant_id")):
                c.execute(f"DELETE FROM {table} WHERE {column} = ?", (tid,))
        with self._lock:
            self._tenants.pop(tid, None)
        shutil.rmtree(self.data_dir / "tenants" / tid, ignore_errors=True)

    # -- scan usage
    @staticmethod
    def _week() -> str:
        return time.strftime("%G-W%V")

    def scans_this_week(self, tid: str) -> int:
        with self._reg() as c:
            row = c.execute("SELECT scans FROM usage WHERE tenant_id = ? AND week = ?", (tid, self._week())).fetchone()
        return row["scans"] if row else 0

    def scans_total(self, tid: str) -> int:
        with self._reg() as c:
            row = c.execute("SELECT COALESCE(SUM(scans), 0) AS n FROM usage WHERE tenant_id = ?", (tid,)).fetchone()
        return row["n"]

    def touch(self, tid: str) -> None:
        """Remembers that this user just used the server (written at most once a minute)."""
        now = time.time()
        if now - self._seen.get(tid, 0) < 60:
            return
        self._seen[tid] = now
        with self._reg() as c:
            c.execute("INSERT INTO seen (tenant_id, at) VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET at = excluded.at", (tid, now))

    def last_seen(self) -> dict[str, float]:
        with self._reg() as c:
            return {r["tenant_id"]: r["at"] for r in c.execute("SELECT tenant_id, at FROM seen")}

    # -- server-wide settings changed from the dashboard (they win over the environment)
    def settings(self) -> dict:
        at, cached = self._settings_cache
        if time.time() - at < 5:  # read on every request, so not from the database every time
            return cached
        with self._reg() as c:
            values = {r["key"]: json.loads(r["value"]) for r in c.execute("SELECT key, value FROM settings")}
        self._settings_cache = (time.time(), values)
        return values

    def set_settings(self, changes: dict) -> None:
        """A value sets it, None removes it (back to the environment / built-in default)."""
        with self._reg() as c:
            for key, value in changes.items():
                if value is None:
                    c.execute("DELETE FROM settings WHERE key = ?", (key,))
                else:
                    c.execute(
                        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        (key, json.dumps(value)),
                    )
        self._settings_cache = (0.0, {})

    def scans_left(self, tenant: Tenant, default_limit: int) -> bool:
        """False when this user used up its weekly scan limit. The default user is never limited.
        0 means unlimited. Checked before a scan and counted after it; one scan at a time per user keeps that exact."""
        limit = 0 if tenant.id == DEFAULT_ID else (tenant.scan_limit if tenant.scan_limit is not None else default_limit)
        return not limit or self.scans_this_week(tenant.id) < limit

    def count_scan(self, tenant: Tenant) -> None:
        """Counts one scan that Gemini answered, for this user this week."""
        with self._reg() as c:
            c.execute(
                "INSERT INTO usage (tenant_id, week, scans) VALUES (?, ?, 1) "
                "ON CONFLICT(tenant_id, week) DO UPDATE SET scans = scans + 1",
                (tenant.id, self._week()),
            )


# ── the `tenant` command ─────────────────────────────────────────────────

LIMIT_COLUMNS = {"week": "scan_limit", "requests": "request_limit", "rate": "scan_rate"}

def clean_payee_name(raw) -> str:
    """The account name for the EPC QR code: one line (a newline would break the code), at most 70 characters."""
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(raw or "")).strip()[:70]


def whole_number(raw: str) -> int:
    """A limit typed on the command line: a whole number from 0 up."""
    if not raw.isdigit():
        raise ValueError(f"{raw!r} is not a whole number of 0 or more")
    return int(raw)


def clean_bunq(raw) -> str:
    """A bunq.me handle ("tcvdh", "@tcvdh" or "bunq.me/tcvdh" all work); "" when empty. Raises ValueError if invalid."""
    handle = re.sub(r"^(https?://)?(www\.)?bunq\.me/|^@", "", str(raw or "").strip(), flags=re.I).strip("/")
    if handle and not re.fullmatch(r"[A-Za-z0-9._-]{1,32}", handle):
        raise ValueError("invalid bunq handle")
    return handle


USAGE = """Users (each has its own key and its own private data):
  python3 server.py tenant add "Name" [--scans N]   create one; prints its key once
  python3 server.py tenant list                     all users and this week's scans
  python3 server.py tenant rotate ID                new key (the old one stops working)
  python3 server.py tenant revoke ID | enable ID    switch a user off / on
  python3 server.py tenant limit ID week|requests|rate N|default
                                                    scans per week / requests per minute / scans per minute
                                                    (0 = unlimited, default = the server-wide value)
  python3 server.py tenant ah ID on|off|default     Albert Heijn for this user (only does something when
                                                    RECEIPT_USE_AH_API=true; off then switches it off for them)
  python3 server.py tenant payee ID [IBAN "Name"] [--bunq HANDLE] [--clear]
                                                    where this user's housemates pay: IBAN + name (QR code),
                                                    a bunq.me handle (share link), or both. What you leave out stays
                                                    as it was; --bunq "" removes the handle, --clear removes all
  python3 server.py tenant delete ID --yes          delete the user and ALL its data
With Docker:  docker exec -u bonnetje bonnetje python3 server.py tenant ...
"""


def cli(hh: Users, args: list[str], iban_valid) -> int:
    if os.geteuid() == 0 and hh.data_dir.exists() and hh.data_dir.stat().st_uid != 0:
        print("Run this as the user that owns the data folder (Docker: docker exec -u bonnetje ...), "
              "or the files it creates cannot be used by the server.", file=sys.stderr)
        return 1
    cmd = args[0] if args else ""
    try:
        hh.init()
        if cmd == "add" and len(args) in (2, 4) and (len(args) == 2 or args[2] == "--scans"):
            limit = whole_number(args[3]) if len(args) == 4 else None
            tenant, key = hh.add(args[1], limit)
            print(f"User created: {tenant.name}\n  id:  {tenant.id}\n  key: {key}\n"
                  "The key is shown only once; give it to the user (it goes into the app).")
        elif cmd == "list":
            print(f"{'id':<18}{'name':<24}{'state':<10}{'scans (week)':<15}limit")
            if hh.use_default:
                print(f"{DEFAULT_ID:<18}{'(RECEIPT_APP_KEY)':<24}{'active':<10}{hh.scans_this_week(DEFAULT_ID):<15}-")
            for r in hh.rows():
                limit = "default" if r["scan_limit"] is None else (r["scan_limit"] or "unlimited")
                print(f"{r['id']:<18}{r['name']:<24}{'off' if r['disabled'] else 'active':<10}"
                      f"{hh.scans_this_week(r['id']):<15}{limit}")
        elif cmd == "rotate" and len(args) == 2:
            print(f"New key: {hh.rotate(args[1])}\nThe old key no longer works.")
        elif cmd in ("revoke", "enable") and len(args) == 2:
            hh.update(args[1], disabled=1 if cmd == "revoke" else 0)
            print("Done.")
        elif cmd == "limit" and len(args) == 4 and args[2] in LIMIT_COLUMNS:
            value = None if args[3] == "default" else whole_number(args[3])
            hh.update(args[1], **{LIMIT_COLUMNS[args[2]]: value})
            print("Done.")
        elif cmd == "ah" and len(args) == 3 and args[2] in ("on", "off", "default"):
            value = {"on": 1, "off": 0, "default": None}[args[2]]
            hh.update(args[1], ah_enabled=value)
            print("Done.")
        elif cmd == "payee" and len(args) >= 2:
            rest = args[2:]
            clear = "--clear" in rest
            rest = [a for a in rest if a != "--clear"]
            bunq = None  # None = leave the handle as it is
            if "--bunq" in rest:
                i = rest.index("--bunq")
                try:
                    bunq = clean_bunq(rest[i + 1])
                except (IndexError, ValueError):
                    print("That bunq handle is not valid.", file=sys.stderr)
                    return 1
                rest = rest[:i] + rest[i + 2:]
            if len(rest) not in (0, 2) or not (rest or bunq is not None or clear):
                print(USAGE)
                return 1
            tenant = hh.tenant(args[1])
            payee = {} if clear else dict(tenant.get_setting("payee") or {})
            if rest:
                iban, name = re.sub(r"\s+", "", rest[0]).upper(), clean_payee_name(rest[1])
                if not iban_valid(iban) or not name:
                    print("That IBAN or name is not valid.", file=sys.stderr)
                    return 1
                payee.update(iban=iban, name=name)
            if bunq is not None:
                payee["bunq"] = bunq
            if not payee.get("bunq"):
                payee.pop("bunq", None)
            tenant.set_setting("payee", payee or None)
            print("Done.")
        elif cmd == "delete" and len(args) == 3 and args[2] == "--yes":
            hh.delete(args[1])
            print("User and all its data deleted.")
        else:
            print(USAGE)
            return 1
    except KeyError:
        print("No such user. See: python3 server.py tenant list", file=sys.stderr)
        return 1
    except ValueError as e:
        print(f"Invalid input: {e}", file=sys.stderr)
        return 1
    return 0
