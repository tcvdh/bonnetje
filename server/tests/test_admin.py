"""The local admin dashboard's API. Run from server/:  python3 -m unittest discover -s tests"""
import http.client
import json
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

_tmp = tempfile.TemporaryDirectory()
os.environ.setdefault("RECEIPT_DATA_DIR", _tmp.name)
os.environ.setdefault("RECEIPT_APP_KEY", "test-key")
os.environ.setdefault("RECEIPT_IBAN", "nl91 abna 0417 1643 00")  # same values as test_storage: whichever module imports server first wins
os.environ.setdefault("RECEIPT_NAME", "Test Person")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import admin  # noqa: E402
import server  # noqa: E402

HH = server.USERS
ADMIN_KEY = "admin-secret"


def tearDownModule():
    _tmp.cleanup()


class AdminTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        ctx = SimpleNamespace(users=HH, stats=server.STATS, setting=server.setting, setting_source=server.setting_source,
                              iban_valid=server.iban_valid, info=server.server_info)
        cls.httpd = admin.serve("127.0.0.1", 0, ADMIN_KEY, ctx)
        cls.port = cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def call(self, method, path, body=None, key=ADMIN_KEY, host="localhost"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Host": f"{host}:{self.port}", "Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        try:
            return resp.status, json.loads(raw or b"{}"), resp
        except ValueError:
            return resp.status, raw, resp

    def make(self, name="Test", **body):
        status, data, _ = self.call("POST", "/api/users", {"name": name, **body})
        self.assertEqual(status, 201)
        return data["id"], data["key"]

    def test_only_with_the_key(self):
        self.assertEqual(self.call("GET", "/api/overview", key=None)[0], 401)
        self.assertEqual(self.call("GET", "/api/overview", key="nope")[0], 401)
        self.assertEqual(self.call("GET", "/api/overview", host="admin.example.com")[0], 200)  # e.g. behind a reverse proxy
        status, page, resp = self.call("GET", "/", key=None)
        self.assertEqual(status, 200)
        self.assertIn(b"Bonnetje beheer", page)
        self.assertIn("default-src 'none'", resp.getheader("Content-Security-Policy"))
        self.assertIsNone(resp.getheader("Access-Control-Allow-Origin"))  # no CORS: web pages cannot call it

    def test_wrong_keys_are_throttled(self):
        admin._failures = admin.Limiter(60)
        codes = [self.call("GET", "/api/overview", key="bad")[0] for _ in range(11)]
        self.assertEqual(codes, [401] * 10 + [429])
        admin._failures = admin.Limiter(60)

    def test_create_change_rotate_and_delete_a_user(self):
        tid, key = self.make("Family", week=10, requests=50)
        self.assertEqual(HH.authenticate(key, server.APP_KEY).id, tid)
        listed = {h["id"]: h for h in self.call("GET", "/api/users")[1]}
        self.assertEqual(listed[tid]["limits"]["week"], {"own": 10, "effective": 10})
        self.assertEqual(listed[tid]["limits"]["rate"]["own"], None)
        self.assertIn(tid, listed)
        self.assertNotIn(key, json.dumps(listed))  # keys can never be read back

        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"name": "Renamed", "week": None, "rate": 2})[0], 200)
        row = HH.row(tid)
        self.assertEqual((row["name"], row["scan_limit"], row["scan_rate"], row["request_limit"]), ("Renamed", None, 2, 50))

        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"disabled": True})[0], 200)
        self.assertIsNone(HH.authenticate(key, server.APP_KEY))
        self.call("PUT", f"/api/users/{tid}", {"disabled": False})

        status, data, _ = self.call("POST", f"/api/users/{tid}/rotate")
        self.assertEqual(status, 200)
        self.assertIsNone(HH.authenticate(key, server.APP_KEY))
        self.assertEqual(HH.authenticate(data["key"], server.APP_KEY).id, tid)

        self.assertEqual(self.call("DELETE", f"/api/users/{tid}", {"confirm": "wrong"})[0], 400)
        self.assertEqual(self.call("DELETE", f"/api/users/{tid}", {"confirm": "Renamed"})[0], 200)
        self.assertIsNone(HH.authenticate(data["key"], server.APP_KEY))

    def test_bad_input_is_refused(self):
        self.assertEqual(self.call("POST", "/api/users", {"name": "  "})[0], 400)
        self.assertEqual(self.call("POST", "/api/users", {"name": "x", "week": -1})[0], 400)
        self.assertEqual(self.call("POST", "/api/users", {"name": "x", "week": True})[0], 400)
        self.assertEqual(self.call("POST", "/api/users", {"name": "x", "rate": "5"})[0], 400)
        tid, _ = self.make("Valid")
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"payee": {"iban": "NL00", "name": "X"}})[0], 400)
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"payee": [1]})[0], 400)
        self.assertEqual(self.call("PUT", "/api/users/0000000000000000", {"name": "x"})[0], 404)
        self.assertEqual(self.call("PUT", "/api/users/../../etc", {"name": "x"})[0], 404)
        self.assertEqual(self.call("POST", "/api/nothing")[0], 404)

    def test_payee_per_user(self):
        tid, key = self.make("Pay")
        body = {"payee": {"iban": "nl91 abna 0417 1643 00", "name": "Pay User"}}
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", body)[0], 200)
        self.assertEqual(server.payee(HH.tenant(tid)), {"iban": "NL91ABNA0417164300", "name": "Pay User"})
        body["payee"]["bunq"] = " https://bunq.me/some.one/ "
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", body)[0], 200)
        self.assertEqual(server.payee(HH.tenant(tid))["bunq"], "some.one")
        body["payee"]["bunq"] = "no spaces/allowed"
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", body)[0], 400)
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"payee": {"bunq": "only.bunq"}})[0], 200)
        self.assertEqual(server.payee(HH.tenant(tid)), {"bunq": "only.bunq"})  # a link without a QR code is fine
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"payee": {"iban": "NL91ABNA0417164300"}})[0], 400)
        self.assertEqual(self.call("PUT", f"/api/users/{tid}", {"payee": None})[0], 200)
        self.assertIsNone(server.payee(HH.tenant(tid)))

    def test_the_built_in_user_is_protected(self):
        listed = self.call("GET", "/api/users")[1]
        default = [h for h in listed if h["id"] == "default"][0]
        self.assertTrue(default["builtin"])
        self.assertEqual(default["limits"]["week"]["effective"], 0)
        for status in (self.call("POST", "/api/users/default/rotate")[0],
                       self.call("DELETE", "/api/users/default", {"confirm": "default"})[0],
                       self.call("PUT", "/api/users/default", {"disabled": True})[0]):
            self.assertEqual(status, 400)
        # the dashboard's bunq name alone keeps the IBAN and name from .env
        self.assertEqual(self.call("PUT", "/api/users/default", {"payee": {"bunq": "dash"}})[0], 200)
        self.assertEqual(server.payee(HH.default())["bunq"], "dash")
        self.assertTrue(server.payee(HH.default())["iban"])
        self.assertEqual(self.call("PUT", "/api/users/default", {"payee": None})[0], 200)

    def test_server_wide_limits_can_be_changed_and_reset(self):
        self.assertEqual(server.setting("requests_per_minute"), 120)
        self.assertEqual(self.call("PUT", "/api/settings", {"requests_per_minute": 60, "scans_per_minute": 3})[0], 200)
        self.assertEqual((server.setting("requests_per_minute"), server.setting("scans_per_minute")), (60, 3))
        settings = self.call("GET", "/api/overview")[1]["settings"]
        self.assertEqual(settings["requests_per_minute"], {"value": 60, "source": "dashboard"})
        self.assertEqual(self.call("PUT", "/api/settings", {"requests_per_minute": None, "scans_per_minute": None})[0], 200)
        self.assertEqual((server.setting("requests_per_minute"), server.setting_source("requests_per_minute")), (120, "built-in"))
        self.assertEqual(self.call("PUT", "/api/settings", {"bogus": 1})[0], 400)
        self.assertEqual(self.call("PUT", "/api/settings", {"photo_days": -1})[0], 400)
        self.assertEqual(self.call("PUT", "/api/settings", {"photo_days": 99999})[0], 400)

    def test_overview_has_the_numbers(self):
        data = self.call("GET", "/api/overview")[1]
        self.assertEqual(set(data), {"server", "counters", "totals", "settings"})
        self.assertIn("uptimeSeconds", data["server"])
        self.assertEqual(set(data["counters"]), {"requests", "unauthorized", "rateLimited", "scans", "errors"})


if __name__ == "__main__":
    unittest.main()
