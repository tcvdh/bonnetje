import { describe, expect, it } from "vitest";
import {
  activeTotal,
  buildInvoice,
  invoiceText,
  paymentRequestText,
  nextInvoiceNumber,
  pendingReceiptIds,
  reserveNumber,
  voidReceiptOnInvoices,
  withoutReservation,
} from "./invoice";
import { emptyAppData, product } from "./testData";
import { Invoice, Receipt } from "../types";

const now = new Date("2026-03-10T12:00:00");
const receipt = (id: string, dateTime: string): Receipt => ({ id, dateTime, totalAmount: { amount: 0 } });

const invoice = (number: string, extra: Partial<Invoice> = {}): Invoice => ({
  id: number,
  number,
  person: "Alice",
  paidAt: now.toISOString(),
  scope: "all",
  receipts: [],
  total: 0,
  ...extra,
});

describe("nextInvoiceNumber", () => {
  it("starts at 001 for a new year", () => {
    expect(nextInvoiceNumber(emptyAppData({ invoices: [invoice("2025-041")] }), now)).toBe("2026-001");
  });

  it("goes above every invoice, even after one was deleted", () => {
    const data = emptyAppData({ invoices: [invoice("2026-001"), invoice("2026-003")] });
    expect(nextInvoiceNumber(data, now)).toBe("2026-004");
  });

  it("counts other people's reservations but not the person's own", () => {
    const data = emptyAppData({ reservations: { Alice: "2026-005", Bob: "2026-002" } });
    expect(nextInvoiceNumber(data, now)).toBe("2026-006");
    expect(nextInvoiceNumber(data, now, "Alice")).toBe("2026-003");
  });
});

describe("reservations", () => {
  it("keeps an existing number unless renewed", () => {
    const data = emptyAppData({ reservations: { Alice: "2026-001" } });
    expect(reserveNumber(data, "Alice", now)).toBe(data);
    expect(reserveNumber(data, "Alice", now, true).reservations.Alice).toBe("2026-001");
  });

  it("releases one person's number", () => {
    expect(withoutReservation(emptyAppData({ reservations: { Alice: "a", Bob: "b" } }), "Alice")).toEqual({ Bob: "b" });
  });
});

describe("pendingReceiptIds", () => {
  const data = emptyAppData({
    assignments: {
      open: { 0: { person: "Alice", cents: 200 } },
      paid: { 0: { person: "Alice", cents: 200 } },
      done: { 0: { person: "Alice", cents: 200 } },
      hidden: { 0: { person: "Alice", cents: 200 } },
      other: { 0: { person: "Bob", cents: 200 } },
      shared: { 0: { split: ["Alice", "Bob"], cents: 200 } },
    },
    paid: { paid: { Alice: true } },
    completed: ["done"],
    hidden: ["hidden"],
  });

  it("lists only receipts the person still owes", () => {
    expect(pendingReceiptIds("Alice", data).sort()).toEqual(["open", "shared"]);
  });
});

describe("buildInvoice", () => {
  it("adds up exactly, without drifting a cent per line", () => {
    // three thirds of a 1.00 item: the odd cent rotates, so each person ends up paying exactly 1.00
    const data = emptyAppData({
      assignments: {
        r1: {
          0: { split: ["Alice", "Bob", "Ik"], cents: 100 },
          1: { split: ["Alice", "Bob", "Ik"], cents: 100 },
          2: { split: ["Alice", "Bob", "Ik"], cents: 100 },
        },
      },
    });
    const details = { r1: { products: [product("a", 1), product("b", 1), product("c", 1)] } };
    const inv = buildInvoice({
      person: "Alice",
      receiptIds: ["r1"],
      data,
      receipts: [receipt("r1", "2026-03-01T10:00:00")],
      details,
      now,
      scope: "all",
    });
    expect(inv.total).toBe(1);
    expect(inv.receipts[0].subtotal).toBe(1);
    expect(inv.receipts[0].lines.map((l) => l.amount)).toEqual([0.34, 0.33, 0.33]);
  });

  it("only lists the person's own lines, ordered by receipt date", () => {
    const data = emptyAppData({
      assignments: {
        late: { 0: { person: "Alice", cents: 200 } },
        early: { 0: { person: "Alice", cents: 300 }, 1: { person: "Bob", cents: 900 } },
      },
    });
    const inv = buildInvoice({
      person: "Alice",
      receiptIds: ["late", "early"],
      data,
      receipts: [receipt("late", "2026-03-05T10:00:00"), receipt("early", "2026-03-01T10:00:00")],
      details: { late: { products: [product("Kaas", 2)] }, early: { products: [product("Melk", 3), product("Bier", 9)] } },
      now,
      scope: "all",
    });
    expect(inv.receipts.map((r) => r.receiptId)).toEqual(["early", "late"]);
    expect(inv.receipts[0].lines.map((l) => l.name)).toEqual(["Melk"]);
    expect(inv.total).toBe(5);
  });

  it("falls back to 'Product n' when the receipt could not be loaded", () => {
    const data = emptyAppData({ assignments: { r1: { 2: { person: "Alice", cents: 100 } } } });
    const inv = buildInvoice({ person: "Alice", receiptIds: ["r1"], data, receipts: [], details: {}, now, scope: "all" });
    expect(inv.receipts[0].lines[0].name).toBe("Product 3");
  });

  it("uses the number promised in the QR code for an 'all' invoice", () => {
    const data = emptyAppData({
      assignments: { r1: { 0: { person: "Alice", cents: 100 } } },
      reservations: { Alice: "2026-007" },
    });
    const opts = { person: "Alice", receiptIds: ["r1"], data, receipts: [], details: {}, now };
    expect(buildInvoice({ ...opts, scope: "all" }).number).toBe("2026-007");
    // a single-receipt invoice ignores the person's own reservation, which stays for their next QR payment
    expect(buildInvoice({ ...opts, scope: "receipt" }).number).toBe("2026-001");
  });
});

describe("voiding", () => {
  const inv = invoice("2026-001", {
    receipts: [
      { receiptId: "a", store: "AH", dateTime: "", lines: [], subtotal: 2 },
      { receiptId: "b", store: "AH", dateTime: "", lines: [], subtotal: 3 },
    ],
  });

  it("voids one receipt and reduces the active total", () => {
    const [out] = voidReceiptOnInvoices([inv], "Alice", "a", "t");
    expect(out.voidedAt).toBeUndefined();
    expect(activeTotal(out)).toBe(3);
  });

  it("voids the whole invoice when every receipt is withdrawn", () => {
    const once = voidReceiptOnInvoices([inv], "Alice", "a", "t1");
    const [twice] = voidReceiptOnInvoices(once, "Alice", "b", "t2");
    expect(twice.voidedAt).toBe("t2");
    expect(activeTotal(twice)).toBe(0);
  });

  it("leaves other people's invoices alone", () => {
    expect(voidReceiptOnInvoices([inv], "Bob", "a", "t")).toEqual([inv]);
  });
});

describe("invoiceText", () => {
  it("shows the total of what still counts as paid", () => {
    const inv1 = invoice("2026-001", {
      receipts: [{ receiptId: "a", store: "AH", dateTime: "2026-03-01T10:00:00", subtotal: 2, lines: [{ name: "Melk", quantity: 1, share: 1, amount: 2 }] }],
    });
    const text = invoiceText(inv1);
    expect(text).toContain("Afrekening 2026-001");
    expect(text).toContain("Melk: €2,00");
    expect(text).toContain("Totaal: €2,00");
  });
});

describe("paymentRequestText", () => {
  const inv = invoice("2026-002", {
    person: "Sam",
    total: 3,
    receipts: [{ receiptId: "a", store: "AH", dateTime: "2026-03-01T10:00:00", subtotal: 3, lines: [{ name: "Melk", quantity: 2, share: 0.5, amount: 3 }] }],
  });

  it("lists the products and the link, and never says it is paid", () => {
    const text = paymentRequestText(inv, "https://bunq.me/x/3.00/Test");
    expect(text).toContain("Afrekening 2026-002");
    expect(text).toContain("2x Melk (50%): €3,00");
    expect(text).toContain("Totaal: €3,00");
    expect(text).toContain("https://bunq.me/x/3.00/Test");
    expect(text).not.toMatch(/betaald op|ingetrokken/);
  });

  it("matches the paid text apart from the paid line", () => {
    expect(invoiceText(inv)).toContain("betaald op");
    expect(paymentRequestText(inv, "l")).not.toContain("betaald op");
  });
});
