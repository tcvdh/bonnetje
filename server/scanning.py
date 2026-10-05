"""Receipt scanning: Gemini call, structured-output schema, validation, normalisation.

Everything that decides how a photo becomes a receipt lives here (and in scan_prompt.txt),
so changing the prompt, the schema or the checks never touches the HTTP code.
"""
from __future__ import annotations

import base64
import datetime
import json
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path

GEMINI_API = os.environ.get("RECEIPT_GEMINI_API", "https://generativelanguage.googleapis.com").rstrip("/")
GEMINI_MODEL = os.environ.get("RECEIPT_GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_KEY = os.environ.get("RECEIPT_GEMINI_KEY", "")
PROMPT_FILE = Path(os.environ.get("RECEIPT_SCAN_PROMPT", Path(__file__).parent / "scan_prompt.txt"))

TOLERANCE = 0.02  # euro; receipts round per line


class ScanError(Exception):
    """A failure the user should see. `code` is machine readable, `message` is Dutch."""

    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ── Structured output schema ─────────────────────────────────────────────
# No nullable fields on purpose: unknown text is "" and unknown numbers are 0.

def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props)}


SCHEMA = _obj({
    "isReceipt": {"type": "boolean", "description": "false if the image is not a readable receipt"},
    "problem": {"type": "string", "description": "why it could not be read; empty when isReceipt is true"},
    "storeName": {"type": "string"},
    "purchaseDate": {"type": "string", "description": "YYYY-MM-DD or empty"},
    "purchaseTime": {"type": "string", "description": "HH:MM or empty"},
    "items": {
        "type": "array",
        "items": _obj({
            "name": {"type": "string"},
            "emoji": {"type": "string", "description": "one emoji for the product category, only if 100% certain, else empty"},
            "quantity": {"type": "number"},
            "unitPrice": {"type": "number", "description": "price of one unit before discount, 0 if not shown"},
            "lineTotal": {"type": "number", "description": "price of the whole line before discount"},
            "deposit": {"type": "number", "description": "statiegeld for this line, else 0"},
            "discount": {"type": "number", "description": "positive amount saved on this line, else 0"},
            "discountLabel": {"type": "string", "description": "printed discount wording, else empty"},
        }),
    },
    "basketDiscounts": {
        "type": "array",
        "items": _obj({
            "name": {"type": "string"},
            "amount": {"type": "number", "description": "positive amount saved"},
        }),
    },
    "total": {"type": "number", "description": "final amount paid"},
    "printedTotalDiscount": {"type": "number", "description": "total savings printed on the receipt, else 0"},
    "printedItemCount": {"type": "number", "description": "item count printed on the receipt, else 0"},
    "warnings": {"type": "array", "items": {"type": "string"}, "description": "things that were unclear"},
})


def load_prompt() -> str:
    """Read on every call, so editing scan_prompt.txt takes effect without a restart."""
    return PROMPT_FILE.read_text(encoding="utf-8")


# ── Gemini ───────────────────────────────────────────────────────────────

def call_gemini(image: bytes, mime_type: str) -> dict:
    if not GEMINI_KEY:
        raise ScanError("gemini_not_configured", "Scannen staat nog niet aan: de server heeft geen Gemini-sleutel.", 503)

    body = {
        "systemInstruction": {"parts": [{"text": load_prompt()}]},
        "contents": [{
            "role": "user",
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(image).decode()}},
                # The model's training data ends before today, so recent dates look like the future to it.
                {"text": f"Today is {datetime.date.today().isoformat()}. Read this receipt."},
            ],
        }],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
        },
    }
    req = urllib.request.Request(
        f"{GEMINI_API}/v1beta/models/{GEMINI_MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY},
    )

    last: Exception | None = None
    for attempt in range(2):  # one retry for transient errors, but not after a timeout: that already took 120 s
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read()).get("error", {}).get("message", "")
            except Exception:
                pass
            if e.code in (400, 401, 403) and ("API key" in detail or e.code in (401, 403)):
                raise ScanError("gemini_auth", "De Gemini-sleutel op de server is ongeldig of heeft geen toegang.", 502)
            if e.code == 429:
                raise ScanError("gemini_rate_limited", "Gemini is tijdelijk overbelast of je quotum is op. Probeer het zo opnieuw.", 429)
            if e.code == 400:
                raise ScanError("gemini_bad_request", f"Gemini weigerde de foto of het verzoek. {detail}".strip(), 502)
            last = e
        except socket.timeout as e:  # TimeoutError on Python 3.10+, its own class on 3.9
            raise ScanError("gemini_timeout", "Gemini doet er te lang over. Probeer het opnieuw.", 504) from e
        except Exception as e:  # DNS, connection reset, ...
            last = e
        if attempt == 0:
            continue
        raise ScanError("gemini_unreachable", "Kan Gemini niet bereiken. Probeer het opnieuw.", 502) from last

    candidates = payload.get("candidates") or []
    if not candidates:
        reason = (payload.get("promptFeedback") or {}).get("blockReason", "")
        raise ScanError("gemini_blocked", f"Gemini gaf geen antwoord voor deze foto{f' ({reason})' if reason else ''}.", 502)
    cand = candidates[0]
    parts = (cand.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        if cand.get("finishReason") == "MAX_TOKENS":
            raise ScanError("gemini_truncated", "Het bonnetje is te lang om in één keer te lezen. Scan het in twee delen.", 502)
        raise ScanError("gemini_bad_output", "Gemini gaf een antwoord dat niet te lezen was. Probeer het opnieuw.", 502)


# ── Validation ───────────────────────────────────────────────────────────

def r2(x) -> float:
    return round(float(x or 0) + 0.0, 2)


def eur(x: float) -> str:
    return "€" + f"{x:.2f}".replace(".", ",")


def clean_emoji(value) -> str:
    """Keep a short non-ASCII symbol (an emoji); anything else is dropped."""
    e = str(value or "").strip()
    if not e or len(e) > 8 or any(ch.isascii() for ch in e):
        return ""
    return e


def _when(value, fmt: str) -> str:
    """The value written exactly in this format ("9:05" becomes "09:05"), or "" when it is not a real
    date/time (then it counts as not read)."""
    try:
        return datetime.datetime.strptime(str(value or "").strip(), fmt).strftime(fmt)
    except ValueError:
        return ""


def clean(raw: dict) -> dict:
    """Coerce the model output into a predictable shape (never trust types)."""
    def num(v):
        try:
            return abs(float(v))
        except (TypeError, ValueError):
            return 0.0

    items = []
    for it in raw.get("items") or []:
        qty = num(it.get("quantity")) or 1.0
        items.append({
            "name": str(it.get("name") or "").strip() or "Onbekend product",
            "emoji": clean_emoji(it.get("emoji")),
            "quantity": qty,
            "unitPrice": r2(num(it.get("unitPrice"))),
            "lineTotal": r2(num(it.get("lineTotal"))),
            "deposit": r2(num(it.get("deposit"))),
            "discount": r2(num(it.get("discount"))),
            "discountLabel": str(it.get("discountLabel") or "").strip(),
        })
    basket = [
        {"name": str(d.get("name") or "").strip() or "Korting", "amount": r2(num(d.get("amount")))}
        for d in raw.get("basketDiscounts") or []
    ]
    return {
        "isReceipt": bool(raw.get("isReceipt")),
        "problem": str(raw.get("problem") or "").strip(),
        "storeName": str(raw.get("storeName") or "").strip(),
        "purchaseDate": _when(raw.get("purchaseDate"), "%Y-%m-%d"),
        "purchaseTime": _when(raw.get("purchaseTime"), "%H:%M"),
        "items": items,
        "basketDiscounts": basket,
        "total": r2(num(raw.get("total"))),
        "printedTotalDiscount": r2(num(raw.get("printedTotalDiscount"))),
        "printedItemCount": num(raw.get("printedItemCount")),
        "warnings": [str(w).strip() for w in raw.get("warnings") or [] if str(w).strip()],
    }


def validate(scan: dict) -> tuple[list[str], list[str]]:
    """Returns (issues, warnings). Issues need the user's OK before the receipt is kept."""
    issues: list[str] = []
    warnings = list(scan["warnings"])
    items = scan["items"]

    computed = sum(i["lineTotal"] + i["deposit"] - i["discount"] for i in items)
    computed -= sum(d["amount"] for d in scan["basketDiscounts"])
    computed = r2(computed)
    if scan["total"] <= 0:
        issues.append("Het totaalbedrag is niet gelezen.")
    elif abs(computed - scan["total"]) > TOLERANCE:
        issues.append(
            f"De producten tellen op tot {eur(computed)}, maar het totaal op het bonnetje is "
            f"{eur(scan['total'])} (verschil {eur(abs(computed - scan['total']))}). "
            "Er ontbreekt of klopt een product of korting niet."
        )

    discounts = r2(sum(i["discount"] for i in items) + sum(d["amount"] for d in scan["basketDiscounts"]))
    printed = scan["printedTotalDiscount"]
    if printed > 0 and abs(discounts - printed) > TOLERANCE:
        issues.append(
            f"De kortingen tellen op tot {eur(discounts)}, maar het bonnetje vermeldt {eur(printed)} korting."
        )

    for i in items:
        if i["discount"] > i["lineTotal"] + i["deposit"] + TOLERANCE:
            issues.append(f"De korting bij “{i['name']}” ({eur(i['discount'])}) is groter dan de prijs.")
        if i["unitPrice"] > 0 and abs(i["unitPrice"] * i["quantity"] - i["lineTotal"]) > TOLERANCE * max(1, i["quantity"]):
            warnings.append(
                f"“{i['name']}”: {i['quantity']:g} × {eur(i['unitPrice'])} is niet {eur(i['lineTotal'])}."
            )
        if i["lineTotal"] == 0:
            warnings.append(f"“{i['name']}” heeft geen prijs gekregen.")

    count = sum(i["quantity"] for i in items)
    if scan["printedItemCount"] > 0 and abs(count - scan["printedItemCount"]) > 0.01:
        warnings.append(
            f"Ik lees {count:g} artikelen, het bonnetje zegt {scan['printedItemCount']:g}."
        )
    if not scan["storeName"]:
        warnings.append("De winkelnaam is niet gelezen.")
    if not scan["purchaseDate"]:
        warnings.append("De datum is niet gelezen; vandaag is gebruikt.")
    return issues, warnings


def scan_image(image: bytes, mime_type: str) -> tuple[dict, list[str], list[str]]:
    """Photo -> (clean scan, issues, warnings). Raises ScanError for unusable photos."""
    scan = clean(call_gemini(image, mime_type))
    if not scan["isReceipt"]:
        why = scan["problem"] or "Dit lijkt geen bonnetje, of de foto is te onduidelijk."
        raise ScanError("not_a_receipt", f"Kan het bonnetje niet lezen: {why}", 422)
    if not scan["items"]:
        raise ScanError("no_items", "Ik zie geen producten op deze foto. Zorg dat het hele bonnetje in beeld is.", 422)
    issues, warnings = validate(scan)
    return scan, issues, warnings


# ── App shape ────────────────────────────────────────────────────────────
# The app already knows how to split AH receipts, so scans are converted to the same
# shapes (Receipt / ReceiptDetail). Discounts are negative there.

def to_app_shapes(receipt_id: str, scan: dict, warnings: list[str], fallback_date: str) -> tuple[dict, dict]:
    date = scan["purchaseDate"] or fallback_date
    time_ = scan["purchaseTime"] if scan["purchaseDate"] and scan["purchaseTime"] else "12:00"
    net_total = scan["total"]
    listing = {
        "id": receipt_id,
        "dateTime": f"{date}T{time_}:00",
        "totalAmount": {"amount": net_total},
        "source": "scan",
        "storeName": scan["storeName"] or "Onbekende winkel",
        "warnings": warnings,
    }
    products = []
    for n, i in enumerate(scan["items"]):
        products.append({
            "id": n,
            "quantity": i["quantity"],
            "name": i["name"],
            "emoji": i["emoji"],
            "price": {"amount": i["unitPrice"]} if i["unitPrice"] else None,
            "amount": {"amount": i["lineTotal"]},
            "deposit": {"amount": i["deposit"]} if i["deposit"] else None,
            "discount": {"amount": -i["discount"], "label": i["discountLabel"]} if i["discount"] else None,
        })
    detail = {
        "id": receipt_id,
        "memberId": "",
        "products": products,
        # `general` discounts are never auto-matched to a product; the user links them.
        "discounts": [
            {"name": d["name"], "amount": {"amount": -d["amount"]}, "general": True}
            for d in scan["basketDiscounts"]
        ],
        "payments": [],
    }
    return listing, detail
