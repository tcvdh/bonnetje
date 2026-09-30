"""Households: keys, isolation between them, quotas and limits. Run from server/:  python3 -m unittest discover -s tests"""
import contextlib
import http.client
import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest

_tmp = tempfile.TemporaryDirectory()
os.environ.setdefault("RECEIPT_DATA_DIR", _tmp.name)
os.environ.setdefault("RECEIPT_APP_KEY", "test-key")
os.environ.setdefault("RECEIPT_IBAN", "nl91 abna 0417 1643 00")  # same values as test_storage: whichever module imports server first wins
os.environ.setdefault("RECEIPT_NAME", "Test Person")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402
import tenants  # noqa: E402

HH = server.HOUSEHOLDS


def tearDownModule():
    _tmp.cleanup()


def scan_for(tenant, scan_id="0123456789abcdef", created_at=None):
    """A kept scanned receipt with a photo, written straight into one household."""
    listing = {"id": "scan_" + scan_id, "dateTime": "2026-01-01T12:00:00", "totalAmount": {"amount": 5.0}, "source": "scan"}
    tenant.photo_path(scan_id + ".jpg").write_bytes(b"photo")
    tenant.save_scan(scan_id, created_at or time.time(), "ok", listing, {"id": listing["id"], "products": []}, {}, [],
                     scan_id + ".jpg", "image/jpeg")


class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()

    def test_default_household_keeps_the_original_layout(self):
        default = HH.default()
        self.assertEqual(default.db_path, server.DATA_DIR / "receipt.db")
        self.assertEqual(default.scan_dir, server.DATA_DIR / "scans")

    def test_keys_are_random_and_only_stored_as_a_hash(self):
        tenant, key = HH.add("Household A")
        self.assertTrue(key.startswith("bk_") and len(key) > 40)
        self.assertNotIn(key.encode(), HH.registry_path.read_bytes())
        self.assertEqual(HH.authenticate(key, server.APP_KEY).id, tenant.id)
        self.assertEqual(tenant.db_path.parent, server.DATA_DIR / "tenants" / tenant.id)
        self.assertEqual(oct(tenant.db_path.stat().st_mode & 0o777), "0o600")

    def test_who_gets_in(self):
        tenant, key = HH.add("B")
        self.assertEqual(HH.authenticate(server.APP_KEY, server.APP_KEY).id, tenants.DEFAULT_ID)
        self.assertIsNone(HH.authenticate("", server.APP_KEY))
        self.assertIsNone(HH.authenticate("wrong", server.APP_KEY))
        HH.update(tenant.id, disabled=1)
        self.assertIsNone(HH.authenticate(key, server.APP_KEY))
        HH.update(tenant.id, disabled=0)
        new_key = HH.rotate(tenant.id)
        self.assertIsNone(HH.authenticate(key, server.APP_KEY))
        self.assertEqual(HH.authenticate(new_key, server.APP_KEY).id, tenant.id)

    def test_delete_removes_everything(self):
        tenant, key = HH.add("Gone")
        scan_for(tenant)
        HH.delete(tenant.id)
        self.assertIsNone(HH.authenticate(key, server.APP_KEY))
        self.assertFalse(tenant.db_path.parent.exists())

    def test_bad_ids_and_photo_names_are_refused(self):
        with self.assertRaises(ValueError):
            tenants.Tenant("../etc", "x", server.DATA_DIR)
        with self.assertRaises(ValueError):
            HH.default().photo_path("../receipt.db")

    def test_scan_quota(self):
        limited, _ = HH.add("Limited", scan_limit=2)
        self.assertEqual([HH.try_count_scan(limited, 0) for _ in range(3)], [True, True, False])
        free, _ = HH.add("Free")
        self.assertTrue(all(HH.try_count_scan(free, 0) for _ in range(5)))  # 0 = unlimited
        self.assertEqual([HH.try_count_scan(free, 6) for _ in range(2)], [True, False])  # the server default applies
        self.assertTrue(all(HH.try_count_scan(HH.default(), 1) for _ in range(3)))  # the built-in household never

    def test_old_photos_go_but_the_receipt_stays(self):
        tenant, _ = HH.add("Photos")
        scan_for(tenant, created_at=time.time() - 3 * 86400)
        tenant.purge(server.DRAFT_TTL, photo_days=2)
        self.assertFalse(tenant.photo_path("0123456789abcdef.jpg").exists())
        self.assertEqual(len(tenant.scanned_receipts()), 1)

    def test_stats_survive_files_that_come_and_go(self):
        tenant, _ = HH.add("Stats")
        scan_for(tenant)
        stats = tenant.stats()
        self.assertEqual((stats["scans"], stats["photos"], stats["people"]), (1, 1, 0))
        self.assertGreater(stats["bytes"], 5)
        self.assertGreater(HH.default().stats()["bytes"], 0)  # the built-in household is the data folder itself

    def test_server_code_cannot_bypass_the_household(self):
        with open(server.__file__) as f:
            source = f.read()
        for forbidden in ("sqlite3", ".execute(", "DATA_DIR /", "SCAN_DIR"):
            self.assertNotIn(forbidden, source)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.httpd = server.Server(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.a, cls.key_a = HH.add("Household A")
        cls.b, cls.key_b = HH.add("Household B")

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def call(self, method, path, body=None, key=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = {"Content-Type": "application/json", **(headers or {})}
        if key:
            hdrs["Authorization"] = f"Bearer {key}"
        conn.request(method, path, raw if raw is not None else (json.dumps(body) if body is not None else None), hdrs)
        resp = conn.getresponse()
        payload = resp.read()
        try:
            data = json.loads(payload or b"{}")
        except ValueError:
            data = {"bytes": payload}  # a photo
        conn.close()
        return resp.status, data

    def test_households_cannot_see_each_others_data(self):
        _, body = self.call("GET", "/api/data", key=self.key_a)
        status, _ = self.call("PUT", "/api/data", {"data": {"people": ["Only A"]}, "baseVersion": body["version"]}, key=self.key_a)
        self.assertEqual(status, 200)
        self.assertEqual(self.call("GET", "/api/data", key=self.key_a)[1]["data"]["people"], ["Only A"])
        self.assertNotIn("Only A", json.dumps(self.call("GET", "/api/data", key=self.key_b)[1]))
        self.assertNotIn("Only A", json.dumps(self.call("GET", "/api/data", key=server.APP_KEY)[1]))

    def test_households_cannot_reach_each_others_scans(self):
        scan_for(self.a, "aaaaaaaaaaaaaaaa")
        mine = self.call("GET", "/api/receipts", key=self.key_a)[1]["receipts"]
        self.assertEqual([r["id"] for r in mine], ["scan_aaaaaaaaaaaaaaaa"])
        for key in (self.key_b, server.APP_KEY):
            self.assertEqual(self.call("GET", "/api/receipts", key=key)[1]["receipts"], [])
            self.assertEqual(self.call("GET", "/api/receipts/scan_aaaaaaaaaaaaaaaa", key=key)[0], 404)
            for method, path in (("GET", "/aaaaaaaaaaaaaaaa"), ("GET", "/aaaaaaaaaaaaaaaa/image"),
                                 ("POST", "/aaaaaaaaaaaaaaaa/accept"), ("POST", "/aaaaaaaaaaaaaaaa/rescan"),
                                 ("DELETE", "/aaaaaaaaaaaaaaaa")):
                self.assertEqual(self.call(method, "/api/scans" + path, key=key)[0], 404, (method, path))
        self.assertTrue(self.a.photo_path("aaaaaaaaaaaaaaaa.jpg").exists())  # B's DELETE did nothing
        self.assertEqual(self.call("GET", "/api/scans/aaaaaaaaaaaaaaaa/image", key=self.key_a)[0], 200)

    def test_payee_is_per_household(self):
        self.assertIsNone(self.call("GET", "/api/auth/status", key=self.key_b)[1]["payee"])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = tenants.cli(HH, ["payee", self.b.id, "nl91 abna 0417 1643 00", "Household B"], server.iban_valid)
        self.assertEqual(code, 0)
        self.assertEqual(self.call("GET", "/api/auth/status", key=self.key_b)[1]["payee"]["name"], "Household B")
        self.assertIsNone(self.call("GET", "/api/auth/status", key=self.key_a)[1]["payee"])

    def test_big_bodies_are_refused(self):
        big = '{"data": {"x": "' + "a" * (server.MAX_DATA_BYTES + 10) + '"}, "baseVersion": 0}'
        self.assertEqual(self.call("PUT", "/api/data", key=self.key_a, raw=big)[0], 413)

    def test_a_body_that_is_not_an_object_is_a_400_not_a_crash(self):
        for raw in ("[1, 2]", "42", '"text"', "null", "{nope"):
            self.assertEqual(self.call("PUT", "/api/data", key=self.key_a, raw=raw)[0], 400, raw)

    def test_too_many_photos_at_once_get_a_503(self):
        held = [server._scan_slots.acquire(blocking=False) for _ in range(server.MAX_SCANS_AT_ONCE)]
        try:
            status, body = self.call("POST", "/api/scans", {"image": "aGk=", "mimeType": "image/jpeg"}, key=self.key_a)
            self.assertEqual((status, body["error"]), (503, "server_busy"))
        finally:
            for _ in held:
                server._scan_slots.release()

    def test_a_household_is_rate_limited_alone(self):
        server.REQUESTS = server.Limiter(60)  # other tests used this household's budget
        HH.update(self.a.id, request_limit=3)
        try:
            codes = [self.call("GET", "/api/data", key=self.key_a)[0] for _ in range(5)]
            self.assertEqual(codes, [200, 200, 200, 429, 429])
            self.assertEqual(self.call("GET", "/api/data", key=self.key_b)[0], 200)
            HH.update(self.a.id, request_limit=0)  # 0 = unlimited
            server.REQUESTS = server.Limiter(60)
            self.assertTrue(all(self.call("GET", "/api/data", key=self.key_a)[0] == 200 for _ in range(5)))
        finally:
            HH.update(self.a.id, request_limit=None)
            server.REQUESTS = server.Limiter(60)

    def test_x_forwarded_for_is_only_believed_from_a_trusted_proxy(self):
        old, old_limit = server.AUTH_FAILURES, server.AUTH_FAIL_LIMIT
        server.AUTH_FAILURES, server.AUTH_FAIL_LIMIT = server.Limiter(60), 3
        try:
            fwd = lambda ip: {"X-Forwarded-For": f"1.1.1.1, {ip}"}  # noqa: E731
            # not trusted: the header is ignored, so all these count against 127.0.0.1
            codes = [self.call("GET", "/api/data", key="bad", headers=fwd(f"9.9.9.{i}"))[0] for i in range(4)]
            self.assertEqual(codes, [401, 401, 401, 429])
            server.AUTH_FAILURES = server.Limiter(60)
            server.TRUSTED_PROXIES = {"127.0.0.1"}
            codes = [self.call("GET", "/api/data", key="bad", headers=fwd("9.9.9.9"))[0] for _ in range(4)]
            self.assertEqual(codes, [401, 401, 401, 429])
            self.assertEqual(self.call("GET", "/api/data", key="bad", headers=fwd("8.8.8.8"))[0], 401)  # another client
        finally:
            server.TRUSTED_PROXIES = set()
            server.AUTH_FAILURES, server.AUTH_FAIL_LIMIT = old, old_limit

    def test_scan_quota_answers_429(self):
        limited, key = HH.add("Quota", scan_limit=1)
        HH.try_count_scan(limited, 0)
        status, body = self.call("POST", "/api/scans", {"image": "aGk=", "mimeType": "image/jpeg"}, key=key)
        self.assertEqual((status, body["error"]), (429, "scan_quota"))
        self.assertEqual(list(limited.scan_dir.iterdir()), [])  # nothing was kept

    def test_each_household_has_its_own_albert_heijn_login(self):
        old, server.USE_AH_API = server.USE_AH_API, True
        try:
            self.assertEqual(self.call("POST", "/api/auth/begin", key=self.key_a)[0], 200)  # A opens its login window
            status, body = self.call("POST", "/api/auth/exchange", {"code": "x"}, key=self.key_b)
            self.assertEqual((status, body["error"]), (409, "login_not_started"))  # B's is still closed
            self.a.store_auth("access", "refresh", time.time() + 3600)
            self.assertTrue(self.call("GET", "/api/auth/status", key=self.key_a)[1]["loggedIn"])
            self.assertFalse(self.call("GET", "/api/auth/status", key=self.key_b)[1]["loggedIn"])
            self.assertEqual(self.call("GET", "/api/receipts", key=self.key_b)[1]["ahError"], "ah_not_logged_in")
        finally:
            server.USE_AH_API = old
            self.a.clear_auth()

    def test_cli_add_list_delete(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(tenants.cli(HH, ["add", "From CLI", "--scans", "7"], server.iban_valid), 0)
            key = [l for l in out.getvalue().splitlines() if "key:" in l][0].split()[-1]
            tid = [l for l in out.getvalue().splitlines() if "id:" in l][0].split()[-1]
            self.assertEqual(tenants.cli(HH, ["list"], server.iban_valid), 0)
        self.assertIn("From CLI", out.getvalue())
        self.assertEqual(self.call("GET", "/api/data", key=key)[0], 200)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(tenants.cli(HH, ["delete", tid, "--yes"], server.iban_valid), 0)
        self.assertEqual(self.call("GET", "/api/data", key=key)[0], 401)


    def test_per_household_ah_override(self):
        old, server.USE_AH_API = server.USE_AH_API, True
        try:
            # Default: follows global (True)
            self.assertTrue(self.call("GET", "/api/auth/status", key=self.key_a)[1]["ahEnabled"])
            # Disable AH for household A
            HH.update(self.a.id, ah_enabled=0)
            self.assertFalse(self.call("GET", "/api/auth/status", key=self.key_a)[1]["ahEnabled"])
            # B still follows global
            self.assertTrue(self.call("GET", "/api/auth/status", key=self.key_b)[1]["ahEnabled"])
            # Auth routes blocked for A
            self.assertEqual(self.call("POST", "/api/auth/begin", key=self.key_a)[0], 404)
        finally:
            server.USE_AH_API = old
            HH.update(self.a.id, ah_enabled=None)


if __name__ == "__main__":
    unittest.main()
