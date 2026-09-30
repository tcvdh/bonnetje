import { describe, expect, it } from "vitest";
import { normalizeData } from "./normalize";
import { receiptCents } from "./settle";
import { AppData } from "../types";

/** Data as older releases saved it: euros in `amount`. */
const legacy = (assignments: unknown) => ({ assignments }) as unknown as Partial<AppData>;

describe("normalizeData", () => {
  it("converts euro amounts to whole cents and drops the old field", () => {
    const { assignments } = normalizeData(
      legacy({ r1: { 0: { person: "Alice", amount: 1.99 }, 1: { split: ["Alice", "Bob"], amount: 0.29 } } })
    );
    expect(assignments.r1[0]).toEqual({ person: "Alice", cents: 199 });
    expect(assignments.r1[1]).toEqual({ split: ["Alice", "Bob"], cents: 29 });
  });

  it("turns every euro value an old app could have saved back into the exact same cents", () => {
    for (let cents = -5000; cents <= 5000; cents++) {
      const { assignments } = normalizeData(legacy({ r: { 0: { person: "A", amount: cents / 100 } } }));
      expect(assignments.r[0]).toEqual({ person: "A", cents });
    }
  });

  it("keeps data that is already in cents", () => {
    const data = normalizeData(legacy({ r1: { 0: { person: "Alice", cents: 250 } } }));
    expect(data.assignments.r1[0]).toEqual({ person: "Alice", cents: 250 });
  });

  it("lets a fresh euro amount win over cents left behind by an earlier save", () => {
    // An old app re-settled the item (new amount) and kept the `cents` it did not know about.
    const { assignments } = normalizeData(legacy({ r1: { 0: { person: "Alice", cents: 100, amount: 3.5 } } }));
    expect(assignments.r1[0]).toEqual({ person: "Alice", cents: 350 });
  });

  it("reads mixed data: some items migrated, some written by an old app", () => {
    const { assignments } = normalizeData(
      legacy({ r1: { 0: { person: "Alice", cents: 100 }, 1: { person: "Bob", amount: 2 } } })
    );
    expect(receiptCents(assignments.r1)).toEqual({ Alice: 100, Bob: 200 });
  });

  it("is safe to run twice", () => {
    const once = normalizeData(legacy({ r1: { 0: { split: ["A", "B"], amount: 0.03 } } }));
    expect(normalizeData(once)).toEqual(once);
  });

  it("gives an assignment without any amount a price of zero instead of NaN", () => {
    const { assignments } = normalizeData(legacy({ r1: { 0: { person: "Alice" }, 1: { person: "Bob", cents: "x" } } }));
    expect(assignments.r1[0]).toEqual({ person: "Alice", cents: 0 });
    expect(assignments.r1[1]).toEqual({ person: "Bob", cents: 0 });
  });

  it("gives the same totals before and after the conversion", () => {
    const { assignments } = normalizeData(
      legacy({ r1: { 0: { split: ["Alice", "Bob", "Ik"], amount: 1 }, 1: { person: "Alice", amount: 2.7 } } })
    );
    expect(receiptCents(assignments.r1)).toEqual({ Alice: 34 + 270, Bob: 33, Ik: 33 });
  });

  it("fills in what older saves lack", () => {
    const data = normalizeData({});
    expect(data.assignments).toEqual({});
    expect(data.invoices).toEqual([]);
    expect(data.reservations).toEqual({});
    expect(data.people.length).toBeGreaterThan(0);
  });

  it("copes with null and missing assignments", () => {
    expect(normalizeData(null).assignments).toEqual({});
    expect(normalizeData(legacy({ r1: null })).assignments).toEqual({ r1: {} });
  });
});
