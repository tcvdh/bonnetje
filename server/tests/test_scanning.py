"""Checks for the receipt scanning rules. Run from server/:  python3 -m unittest discover -s tests"""
import copy
import datetime
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import scanning  # noqa: E402


def raw_scan(**over):
    scan = {
        "isReceipt": True,
        "problem": "",
        "storeName": "Jumbo",
        "purchaseDate": "2026-03-01",
        "purchaseTime": "10:15",
        "items": [
            {"name": "Melk", "emoji": "🥛", "quantity": 2, "unitPrice": 1.0, "lineTotal": 2.0,
             "deposit": 0, "discount": 0, "discountLabel": ""},
            {"name": "Bier", "emoji": "", "quantity": 1, "unitPrice": 5.0, "lineTotal": 5.0,
             "deposit": 0.1, "discount": 1.0, "discountLabel": "1 euro korting"},
        ],
        "basketDiscounts": [{"name": "Bonus box", "amount": 0.5}],
        "total": 5.6,  # 2 + 5 + 0.1 - 1 - 0.5
        "printedTotalDiscount": 1.5,
        "printedItemCount": 3,
        "warnings": [],
    }
    scan.update(over)
    return scan


class CleanTests(unittest.TestCase):
    def test_coerces_bad_types_instead_of_crashing(self):
        cleaned = scanning.clean({"items": [{"name": None, "quantity": "x", "lineTotal": "3,5"}], "total": None})
        item = cleaned["items"][0]
        self.assertEqual(item["name"], "Onbekend product")
        self.assertEqual(item["quantity"], 1.0)
        self.assertEqual(item["lineTotal"], 0.0)
        self.assertEqual(cleaned["total"], 0.0)

    def test_amounts_are_never_negative(self):
        cleaned = scanning.clean({"items": [{"name": "a", "lineTotal": -2, "discount": -1}]})
        self.assertEqual(cleaned["items"][0]["lineTotal"], 2.0)
        self.assertEqual(cleaned["items"][0]["discount"], 1.0)

    def test_emoji_only_keeps_real_emoji(self):
        self.assertEqual(scanning.clean_emoji("🥛"), "🥛")
        self.assertEqual(scanning.clean_emoji("milk"), "")
        self.assertEqual(scanning.clean_emoji(""), "")
        self.assertEqual(scanning.clean_emoji("🥛🥛🥛🥛🥛🥛🥛🥛🥛"), "")


class ValidateTests(unittest.TestCase):
    def check(self, **over):
        return scanning.validate(scanning.clean(raw_scan(**over)))

    def test_consistent_receipt_has_no_issues(self):
        issues, warnings = self.check()
        self.assertEqual(issues, [])
        self.assertEqual(warnings, [])

    def test_total_that_does_not_add_up_is_an_issue(self):
        issues, _ = self.check(total=9.99)
        self.assertTrue(any("tellen op" in i for i in issues))

    def test_missing_total_is_an_issue(self):
        issues, _ = self.check(total=0)
        self.assertIn("Het totaalbedrag is niet gelezen.", issues)

    def test_within_a_couple_of_cents_is_fine(self):
        issues, _ = self.check(total=5.61)
        self.assertEqual(issues, [])

    def test_printed_savings_mismatch_is_an_issue(self):
        issues, _ = self.check(printedTotalDiscount=3.0)
        self.assertTrue(any("korting" in i for i in issues))

    def test_item_count_mismatch_is_only_a_warning(self):
        issues, warnings = self.check(printedItemCount=7)
        self.assertEqual(issues, [])
        self.assertTrue(any("artikelen" in w for w in warnings))

    def test_missing_store_and_date_are_warnings(self):
        _, warnings = self.check(storeName="", purchaseDate="")
        self.assertTrue(any("winkelnaam" in w for w in warnings))
        self.assertTrue(any("datum" in w for w in warnings))

    def test_discount_larger_than_price_is_an_issue(self):
        scan = raw_scan()
        scan["items"][1]["discount"] = 50
        issues, _ = scanning.validate(scanning.clean(scan))
        self.assertTrue(any("groter dan de prijs" in i for i in issues))


class ScanImageTests(unittest.TestCase):
    def scan_with(self, model_output):
        original = scanning.call_gemini
        scanning.call_gemini = lambda image, mime: copy.deepcopy(model_output)
        try:
            return scanning.scan_image(b"img", "image/jpeg")
        finally:
            scanning.call_gemini = original

    def test_not_a_receipt_raises(self):
        with self.assertRaises(scanning.ScanError) as ctx:
            self.scan_with(raw_scan(isReceipt=False, problem="te donker"))
        self.assertEqual(ctx.exception.code, "not_a_receipt")
        self.assertIn("te donker", ctx.exception.message)

    def test_no_items_raises(self):
        with self.assertRaises(scanning.ScanError) as ctx:
            self.scan_with(raw_scan(items=[]))
        self.assertEqual(ctx.exception.code, "no_items")

    def test_good_scan_returns_scan_issues_warnings(self):
        scan, issues, warnings = self.scan_with(raw_scan())
        self.assertEqual(scan["storeName"], "Jumbo")
        self.assertEqual((issues, warnings), ([], []))


class GeminiRequestTests(unittest.TestCase):
    def test_request_tells_the_model_todays_date(self):
        # Without it the model warns that recent receipts are "in the future".
        sent = {}

        class Done(Exception):
            pass

        def fake_urlopen(req, timeout):
            sent["body"] = json.loads(req.data)
            raise Done

        original_key, original_open = scanning.GEMINI_KEY, scanning.urllib.request.urlopen
        scanning.GEMINI_KEY, scanning.urllib.request.urlopen = "test", fake_urlopen
        try:
            with self.assertRaises(Exception):
                scanning.call_gemini(b"img", "image/jpeg")
        finally:
            scanning.GEMINI_KEY, scanning.urllib.request.urlopen = original_key, original_open
        text = sent["body"]["contents"][0]["parts"][1]["text"]
        self.assertIn(datetime.date.today().isoformat(), text)


class AppShapeTests(unittest.TestCase):
    def setUp(self):
        self.scan = scanning.clean(raw_scan())
        self.listing, self.detail = scanning.to_app_shapes("scan_abc", self.scan, [], "2026-01-01")

    def test_listing(self):
        self.assertEqual(self.listing["id"], "scan_abc")
        self.assertEqual(self.listing["dateTime"], "2026-03-01T10:15:00")
        self.assertEqual(self.listing["totalAmount"], {"amount": 5.6})
        self.assertEqual(self.listing["source"], "scan")

    def test_discounts_are_negative_in_app_shape(self):
        beer = self.detail["products"][1]
        self.assertEqual(beer["discount"]["amount"], -1.0)
        self.assertEqual(beer["deposit"], {"amount": 0.1})
        self.assertIsNone(self.detail["products"][0]["discount"])

    def test_basket_discounts_are_general_and_negative(self):
        self.assertEqual(self.detail["discounts"], [
            {"name": "Bonus box", "amount": {"amount": -0.5}, "general": True},
        ])

    def test_missing_date_uses_the_fallback_with_noon(self):
        scan = scanning.clean(raw_scan(purchaseDate="", purchaseTime="09:00"))
        listing, _ = scanning.to_app_shapes("scan_x", scan, [], "2026-01-01")
        self.assertEqual(listing["dateTime"], "2026-01-01T12:00:00")


if __name__ == "__main__":
    unittest.main()
