import { describe, expect, it } from "vitest";
import { allocate, receiptCents, settleAssignments, shareCents, splitCounts, splitOf, sumCents } from "./settle";
import { owedByPerson, receiptBalance } from "./balance";
import { buildInvoice, pendingReceiptIds } from "./invoice";
import { applyOverrides, baseDiscountMap, getNetAmount } from "./discounts";
import { emptyAppData, product } from "./testData";
import { Assignment, Discount, Product } from "../types";

/** Small deterministic random numbers, so a failing case can be replayed. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe("allocate", () => {
  it("always adds up to the total", () => {
    const next = rng(1);
    for (let run = 0; run < 500; run++) {
      const weights = Array.from({ length: 1 + Math.floor(next() * 6) }, () => Math.floor(next() * 2000));
      const total = Math.floor(next() * 2000) - 1000;
      expect(sumCents(allocate(total, weights))).toBe(total);
    }
  });

  it("is proportional", () => expect(allocate(-40, [300, 100])).toEqual([-30, -10]));
  it("shares evenly when every weight is zero", () => expect(allocate(-50, [0, 0])).toEqual([-25, -25]));
  it("gives the odd cent to the biggest fraction, earlier entries first on a tie", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-33, -33, -34]);
  });
  it("handles nothing to share", () => expect(allocate(5, [])).toEqual([]));
});

describe("shareCents", () => {
  it("gives a single person the whole amount", () => {
    expect(shareCents({ person: "Alice", cents: 199 })).toEqual({ Alice: 199 });
  });

  it("splits exactly and rotates the odd cent with the item", () => {
    const split: Assignment = { split: ["A", "B", "C"], cents: 100 };
    expect(shareCents(split, 0)).toEqual({ A: 34, B: 33, C: 33 });
    expect(shareCents(split, 1)).toEqual({ A: 33, B: 34, C: 33 });
    expect(shareCents(split, 2)).toEqual({ A: 33, B: 33, C: 34 });
    expect(shareCents(split, 3)).toEqual({ A: 34, B: 33, C: 33 });
  });

  it("splits negative amounts too", () => {
    expect(sumCents(Object.values(shareCents({ split: ["A", "B", "C"], cents: -1 })))).toBe(-1);
  });

  it("charges a person per part when they are listed more than once", () => {
    // 5 beers for 4.99: 3 for Ik, 1 each for Alice and Bob
    const beers: Assignment = { split: splitOf({ Ik: 3, Alice: 1, Bob: 1 }), cents: 499 };
    expect(shareCents(beers)).toEqual({ Ik: 300, Alice: 100, Bob: 99 });
    expect(splitCounts(beers.split)).toEqual({ Ik: 3, Alice: 1, Bob: 1 });
  });
});

describe("settleAssignments", () => {
  const products = [product("Kaas", 3), product("Melk", 1)];
  const basket: Discount = { name: "Bon", amount: { amount: -0.4 }, general: true };

  it("spreads unlinked discounts over the assigned items, to the cent", () => {
    const raw: Record<string, Assignment> = { 0: { person: "Alice", cents: 0 }, 1: { person: "Bob", cents: 0 } };
    const { assignments } = settleAssignments(raw, products, {}, [basket]);
    expect(assignments[0].cents).toBe(270);
    expect(assignments[1].cents).toBe(90);
    expect(sumCents(Object.values(assignments).map((a) => a.cents))).toBe(400 - 40);
  });

  it("only spreads over what is assigned", () => {
    const { assignments } = settleAssignments({ 1: { person: "Bob", cents: 0 } }, products, {}, [basket]);
    expect(assignments[1].cents).toBe(60);
  });

  it("reports whether anything changed", () => {
    const settled = settleAssignments({ 0: { person: "Alice", cents: 0 } }, products, {}, []);
    expect(settled.changed).toBe(true);
    expect(settleAssignments(settled.assignments, products, {}, []).changed).toBe(false);
  });

  it("uses the product's own discount and deposit", () => {
    const p = [product("Bier", 5, { deposit: { amount: 0.1 } })];
    const { assignments } = settleAssignments({ 0: { person: "A", cents: 0 } }, p, { 0: -1 }, []);
    expect(assignments[0].cents).toBe(410);
  });

  it("leaves items without a product alone", () => {
    const raw: Record<string, Assignment> = { 9: { person: "A", cents: 123 } };
    expect(settleAssignments(raw, products, {}, [])).toEqual({ assignments: raw, changed: false });
  });
});

/**
 * The promise of the app: whichever screen you look at, the numbers agree.
 * Random receipts, random splits and random discounts; every total is compared with every other.
 */
describe("all totals agree", () => {
  const people = ["Ik", "Alice", "Bob", "Carol"];

  function randomCase(seed: number) {
    const next = rng(seed);
    const products: Product[] = Array.from({ length: 2 + Math.floor(next() * 8) }, (_, i) =>
      product(`Product ${i}`, Math.round(next() * 1500) / 100, {
        deposit: next() < 0.2 ? { amount: 0.1 } : null,
        discount: next() < 0.2 ? { amount: -Math.round(next() * 50) / 100 } : null,
      })
    );
    const discounts: Discount[] = Array.from({ length: Math.floor(next() * 3) }, (_, i) => ({
      name: `Korting ${i}`,
      amount: { amount: -Math.round(next() * 300) / 100 },
      general: true,
    }));
    const base = baseDiscountMap(products, discounts);
    const linkedTo = discounts.length && next() < 0.5 ? { [discounts[0].name]: [0] } : {};
    const priced = applyOverrides(products, base.productDiscounts, base.unmatched, linkedTo);

    const raw: Record<string, Assignment> = {};
    products.forEach((_, i) => {
      const roll = next();
      if (roll < 0.25) return; // left unassigned
      if (roll < 0.65) raw[i] = { person: people[Math.floor(next() * people.length)], cents: 0 };
      else {
        // some people take several parts (3 of 5 beers), so names can repeat
        const size = 2 + Math.floor(next() * 3);
        const split = people.slice(0, size).flatMap((p) => Array<string>(1 + Math.floor(next() * 3)).fill(p));
        raw[i] = { split, cents: 0 };
      }
    });
    const { assignments } = settleAssignments(raw, products, priced.map, priced.unmatched);
    return { products, priced, assignments };
  }

  it.each(Array.from({ length: 300 }, (_, i) => i + 1))("case %i", (seed) => {
    const { products, priced, assignments } = randomCase(seed);
    const data = emptyAppData({ assignments: { r1: assignments }, people });

    // 1. the people's parts add up to the assigned items, to the cent
    const itemCents = Object.values(assignments).map((a) => a.cents);
    const perPerson = receiptCents(assignments);
    expect(sumCents(Object.values(perPerson))).toBe(sumCents(itemCents));

    // 2. the assigned items add up to the receipt, minus what is still unassigned
    const netAll = sumCents(products.map((p, i) => Math.round(getNetAmount(p, priced.map[i] || 0) * 100)));
    const unlinked = sumCents(priced.unmatched.map((d) => Math.round(d.amount.amount * 100)));
    const netUnassigned = sumCents(
      products.map((p, i) => (assignments[i] ? 0 : Math.round(getNetAmount(p, priced.map[i] || 0) * 100)))
    );
    const spread = Object.keys(assignments).length > 0 && unlinked < 0 ? unlinked : 0;
    expect(sumCents(itemCents) + netUnassigned + (unlinked - spread)).toBe(netAll + unlinked);

    // 3. the receipt balance, the balance card and an invoice for each person show the same money
    const owedOthers = Object.entries(perPerson).filter(([p]) => p !== "Ik").reduce((s, [, c]) => s + c, 0);
    expect(Math.round(receiptBalance("r1", data).owed * 100)).toBe(owedOthers);

    const card = owedByPerson(data);
    people.filter((p) => p !== "Ik").forEach((person) => {
      const invoice = buildInvoice({
        person,
        receiptIds: pendingReceiptIds(person, data),
        data,
        receipts: [],
        details: { r1: { products } },
        now: new Date("2026-03-10T12:00:00"),
        scope: "all",
      });
      expect(Math.round(invoice.total * 100)).toBe(perPerson[person] ?? 0);
      expect(Math.round(invoice.total * 100)).toBe(card[person] ?? 0);
      // and the invoice lines add up to the invoice
      const lines = invoice.receipts.flatMap((r) => r.lines).reduce((s, l) => s + Math.round(l.amount * 100), 0);
      expect(lines).toBe(Math.round(invoice.total * 100));
    });
  });
});
