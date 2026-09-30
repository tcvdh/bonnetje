import { Assignment, Discount, Product } from "../types";
import { getNetAmount } from "./discounts";

/**
 * Every amount that ends up in front of a person is a whole number of cents, worked out here and
 * nowhere else. The stored `Assignment.cents` of an item is its final price for the split: net of
 * its own discount and of its share of any discount that isn't linked to a product. From that one
 * number, `shareCents` gives each person's part, so the receipt page, the balance, the QR code and
 * the invoices can never disagree by a cent.
 *
 * Only prices that come from the store (euros, in `Product` and `Discount`) are converted here.
 */

export const toCents = (euros: number) => Math.round(euros * 100);

/** Splits `total` cents over `weights` so the parts add up to exactly `total` (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const clipped = weights.map((w) => Math.max(w, 0));
  const sum = clipped.reduce((a, b) => a + b, 0);
  const use = sum > 0 ? clipped : clipped.map(() => 1);
  const useSum = sum > 0 ? sum : n;

  const exact = use.map((w) => (total * w) / useSum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  // Biggest fractions get the extra cents first; ties go to the earlier entry.
  const order = exact
    .map((e, i) => ({ i, fraction: e - Math.floor(e) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) parts[order[k].i]++;
  for (let k = n - 1; left < 0; k = (k - 1 + n) % n, left++) parts[order[k].i]--; // float noise only
  return parts;
}

/**
 * What each person pays for one assignment, in cents. A split is exact: the odd cents go to different
 * people for different items (`itemIndex` rotates who is first), so nobody always pays the extra cent.
 */
export function shareCents(a: Assignment, itemIndex = 0): Record<string, number> {
  const cents = a.cents;
  if ("person" in a) return { [a.person]: cents };
  const n = a.split.length;
  const base = Math.floor(cents / n);
  const extra = cents - base * n; // 0 .. n-1 people pay one cent more
  const start = ((itemIndex % n) + n) % n;
  const out: Record<string, number> = {};
  a.split.forEach((person, k) => {
    const position = (k - start + n) % n;
    out[person] = (out[person] ?? 0) + base + (position < extra ? 1 : 0);
  });
  return out;
}

/** What each person pays for a whole receipt, in cents. Keys of `assignments` are product numbers. */
export function receiptCents(assignments: Record<string, Assignment>): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(assignments).forEach(([index, a]) => {
    Object.entries(shareCents(a, Number(index) || 0)).forEach(([person, cents]) => {
      out[person] = (out[person] ?? 0) + cents;
    });
  });
  return out;
}

export const sumCents = (values: Iterable<number>) => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

/** Net price of a product in cents: line amount, its discount and deposit. */
export const netCents = (product: Product, discount: number) => toCents(getNetAmount(product, discount));

/** Total of the discounts that are not linked to any product, in cents (negative when they save money). */
export const unlinkedCents = (unmatched: Discount[]) => sumCents(unmatched.map((d) => toCents(d.amount.amount)));

/**
 * Sets the final amount of every assigned item. Discounts that are not linked to a product are spread
 * over the assigned items in proportion to their price, to the cent, so nothing is left over.
 * Call this after anything that changes the split, the links or the prices.
 */
export function settleAssignments(
  assignments: Record<string, Assignment>,
  products: Product[],
  discountMap: Record<number, number>,
  unmatched: Discount[]
): { assignments: Record<string, Assignment>; changed: boolean } {
  const keys = Object.keys(assignments).filter((k) => products[Number(k)]);
  const nets = keys.map((k) => netCents(products[Number(k)], discountMap[Number(k)] || 0));
  const unlinked = unlinkedCents(unmatched);
  const spread = unlinked < 0 && sumCents(nets) > 0 ? allocate(unlinked, nets) : nets.map(() => 0);

  let changed = false;
  const next = { ...assignments };
  keys.forEach((key, n) => {
    const cents = nets[n] + spread[n];
    if (assignments[key].cents !== cents) changed = true;
    next[key] = { ...assignments[key], cents } as Assignment;
  });
  return { assignments: next, changed };
}
