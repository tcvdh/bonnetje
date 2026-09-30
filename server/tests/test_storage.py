"""Checks for the data store and the HTTP API. Run from server/:  python3 -m unittest discover -s tests"""
import contextlib
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

_tmp = tempfile.TemporaryDirectory()
os.environ["RECEIPT_DATA_DIR"] = _tmp.name
os.environ["RECEIPT_APP_KEY"] = "test-key"
os.environ["RECEIPT_IBAN"] = "nl91 abna 0417 1643 00"
os.environ["RECEIPT_NAME"] = "Test Person"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402

TENANT = server.HOUSEHOLDS.default()


def tearDownModule():
    _tmp.cleanup()


@contextlib.contextmanager
def ah_enabled(on):
    old, server.USE_AH_API = server.USE_AH_API, on
    try:
        yield
    finally:
        server.USE_AH_API = old


class PayeeTests(unittest.TestCase):
    def test_iban_check(self):
        self.assertTrue(server.iban_valid("NL91ABNA0417164300"))
        self.assertTrue(server.iban_valid("DE89370400440532013000"))
        self.assertFalse(server.iban_valid("NL92ABNA0417164300"))  # one digit off
        self.assertFalse(server.iban_valid("not an iban"))
        self.assertFalse(server.iban_valid(""))

    def test_payee_is_normalised(self):
        self.assertEqual(server.payee(TENANT), {"iban": "NL91ABNA0417164300", "name": "Test Person"})

    def test_payee_needs_both_and_a_valid_iban(self):
        old = (server.PAYEE_IBAN, server.PAYEE_NAME)
        try:
            server.PAYEE_NAME = ""
            self.assertIsNone(server.payee(TENANT))
            server.PAYEE_NAME, server.PAYEE_IBAN = "X", "NL92ABNA0417164300"
            self.assertIsNone(server.payee(TENANT))
        finally:
            server.PAYEE_IBAN, server.PAYEE_NAME = old


class WriteDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()

    def test_compare_and_swap(self):
        _, version = TENANT.read_data()
        ok, _, new_version = TENANT.write_data({"a": 1}, version)
        self.assertTrue(ok)
        self.assertEqual(new_version, version + 1)

        ok, current, current_version = TENANT.write_data({"a": 2}, version)  # stale base version
        self.assertFalse(ok)
        self.assertEqual(current, {"a": 1})
        self.assertEqual(current_version, new_version)

    def test_connections_are_closed(self):
        with TENANT.db() as c:
            c.execute("SELECT 1")
        with self.assertRaises(Exception):
            c.execute("SELECT 1")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def call(self, method, path, body=None, key="test-key"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        resp = conn.getresponse()
        data = json.loads(resp.read() or b"{}")
        conn.close()
        return resp.status, data

    def test_health_needs_no_key(self):
        self.assertEqual(self.call("GET", "/api/health", key=None), (200, {"ok": True, "ahEnabled": False}))

    def test_status_tells_the_app_where_to_pay(self):
        status, body = self.call("GET", "/api/auth/status")
        self.assertEqual(status, 200)
        self.assertEqual(body["payee"], {"iban": "NL91ABNA0417164300", "name": "Test Person"})

    def test_other_routes_need_the_key(self):
        self.assertEqual(self.call("GET", "/api/data", key="wrong")[0], 401)
        self.assertEqual(self.call("GET", "/api/data", key=None)[0], 401)

    def test_data_round_trip_and_conflict(self):
        status, body = self.call("GET", "/api/data")
        self.assertEqual(status, 200)
        version = body["version"]

        status, body = self.call("PUT", "/api/data", {"data": {"people": ["Ik"]}, "baseVersion": version})
        self.assertEqual((status, body["version"]), (200, version + 1))

        status, body = self.call("PUT", "/api/data", {"data": {}, "baseVersion": version})
        self.assertEqual(status, 409)
        self.assertEqual(body["data"], {"people": ["Ik"]})

    def test_bad_put_is_a_400(self):
        self.assertEqual(self.call("PUT", "/api/data", {"data": "nope", "baseVersion": 0})[0], 400)

    def test_unknown_routes_are_404(self):
        self.assertEqual(self.call("GET", "/api/nothing")[0], 404)
        self.assertEqual(self.call("GET", "/api/scans/0123456789abcdef")[0], 404)

    def test_login_code_is_refused_unless_a_login_was_started(self):
        with ah_enabled(True):
            status, body = self.call("POST", "/api/auth/exchange", {"code": "abc"})
        self.assertEqual((status, body["error"]), (409, "login_not_started"))

    def test_ah_is_off_by_default(self):
        self.assertFalse(server.USE_AH_API)
        status, body = self.call("GET", "/api/auth/status")
        self.assertEqual((body["ahEnabled"], body["loginUrl"]), (False, None))
        for path in ("begin", "exchange", "logout"):
            self.assertEqual(self.call("POST", f"/api/auth/{path}", {"code": "abc"})[0], 404)
        status, body = self.call("GET", "/api/receipts")
        self.assertEqual((status, body["ahError"]), (200, ""))  # no AH warning in the app
        self.assertEqual(self.call("GET", "/api/receipts/1234")[0], 404)

    def test_ah_on_warns_until_logged_in(self):
        with ah_enabled(True):
            self.assertEqual(self.call("GET", "/api/health", key=None)[1]["ahEnabled"], True)
            status, body = self.call("GET", "/api/auth/status")
            self.assertEqual((body["ahEnabled"], body["loggedIn"], bool(body["loginUrl"])), (True, False, True))
            status, body = self.call("GET", "/api/receipts")
            self.assertEqual((status, body["ahError"]), (200, "ah_not_logged_in"))


if __name__ == "__main__":
    unittest.main()
