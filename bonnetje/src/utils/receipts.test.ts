import { describe, expect, it } from "vitest";
import { isScanned, removeReceipt } from "./receipts";
import { emptyAppData } from "./testData";

describe("removeReceipt", () => {
  it("removes every trace of the receipt and leaves the others and the invoices alone", () => {
    const invoice = { id: "i1", number: "1", person: "Bob", paidAt: "", scope: "all" as const, receipts: [], total: 5 };
    const data = emptyAppData({
      assignments: { scan_a: { "0": { person: "Bob", cents: 100 } }, other: { "0": { person: "Bob", cents: 200 } } },
      paid: { scan_a: { Bob: true }, other: {} },
      discountOverrides: { scan_a: { korting: 0 } },
      completed: ["scan_a", "other"],
      hidden: ["scan_a"],
      invoices: [invoice],
    });
    const next = removeReceipt(data, "scan_a");
    expect(Object.keys(next.assignments)).toEqual(["other"]);
    expect(Object.keys(next.paid)).toEqual(["other"]);
    expect(next.discountOverrides).toEqual({});
    expect(next.completed).toEqual(["other"]);
    expect(next.hidden).toEqual([]);
    expect(next.invoices).toEqual([invoice]);
  });

  it("only scanned receipts count as deletable", () => {
    expect(isScanned("scan_0123456789abcdef")).toBe(true);
    expect(isScanned("12345")).toBe(false);
  });
});
