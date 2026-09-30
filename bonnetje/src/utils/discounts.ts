import { Product, Discount } from "../types";
import { round2 } from "./money";

function normalize(s: string): string {
  return s.replace(/[^a-zA-Z]/g, "").toLowerCase();
}

export function matchDiscounts(
  products: Product[],
  discounts: Discount[]
): { productDiscounts: Record<number, number>; unmatched: Discount[] } {
  if (!discounts?.length) return { productDiscounts: {}, unmatched: [] };

  const productDiscounts: Record<number, number> = {};
  const usedDisc = new Set<number>();

  discounts.forEach((disc, di) => {
    if (disc.general) return; // stays unmatched so the user can link it
    const dName = normalize(disc.name);
    let bestMatch = -1;
    let bestScore = 0;

    products.forEach((p, pi) => {
      const pName = normalize(p.name);
      const pWords = p.name
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z]/g, ""))
        .filter((w) => w.length >= 3);
      let score = 0;

      if (pName.includes(dName) || dName.includes(pName)) {
        score = 10;
      } else if (pWords.some((w) => dName.includes(w))) {
        score = 7;
      } else if (
        pWords.some((w) => {
          for (let len = Math.min(w.length, 6); len >= 4; len--) {
            if (dName.includes(w.slice(0, len))) return true;
          }
          return false;
        })
      ) {
        score = 5;
      } else if (
        pWords.some((w) => {
          for (let start = 1; start <= w.length - 4; start++) {
            const sub = w.slice(start, start + Math.min(w.length - start, 6));
            if (sub.length >= 4 && dName.includes(sub)) return true;
          }
          return false;
        })
      ) {
        score = 4;
      } else {
        const minLen = Math.min(dName.length, pName.length);
        let overlap = 0;
        for (let c = 0; c < minLen; c++) {
          if (dName[c] === pName[c]) overlap++;
          else break;
        }
        if (overlap >= 4) score = overlap;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = pi;
      }
    });

    if (bestMatch >= 0 && bestScore >= 4) {
      productDiscounts[bestMatch] =
        (productDiscounts[bestMatch] || 0) + disc.amount.amount;
      usedDisc.add(di);
    }
  });

  const unmatched = discounts.filter((_, i) => !usedDisc.has(i));
  return { productDiscounts, unmatched };
}

export function getNetAmount(
  product: Product,
  discountAmount: number
): number {
  const base = product.amount.amount;
  const deposit = product.deposit ? product.deposit.amount : 0;
  return round2(base + discountAmount + deposit);
}

/** Spreads a discount over products in proportion to their price, to the cent. */
export function splitDiscount(
  products: Product[],
  indices: number[],
  amount: number
): Record<number, number> {
  const idx = indices.filter((i) => products[i]);
  const out: Record<number, number> = {};
  if (!idx.length) return out;

  const cents = Math.round(amount * 100);
  const weights = idx.map((i) => Math.max(products[i].amount.amount, 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  idx.forEach((i, n) => {
    const share =
      n === idx.length - 1
        ? cents - given // the last product takes the rounding remainder
        : Math.round(cents * (total > 0 ? weights[n] / total : 1 / idx.length));
    given += share;
    out[i] = share / 100;
  });
  return out;
}

export type DiscountOverrides = Record<string, number | number[]>;

export interface LinkedDiscount {
  discount: Discount;
  indices: number[];
}

/** Applies the user's manual discount links on top of the automatic matches. */
export function applyOverrides(
  products: Product[],
  base: Record<number, number>,
  unmatched: Discount[],
  overrides: DiscountOverrides
): { map: Record<number, number>; unmatched: Discount[]; linked: LinkedDiscount[] } {
  const map = { ...base };
  const left: Discount[] = [];
  const linked: LinkedDiscount[] = [];

  unmatched.forEach((discount) => {
    const raw = overrides[discount.name];
    const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    const indices = list.filter((i) => products[i]);
    if (!indices.length) {
      left.push(discount);
      return;
    }
    const parts = splitDiscount(products, indices, discount.amount.amount);
    Object.entries(parts).forEach(([i, amount]) => {
      map[+i] = (map[+i] || 0) + amount;
    });
    linked.push({ discount, indices });
  });

  return { map, unmatched: left, linked };
}

/** Automatic discount matches plus discounts a scanned receipt already tied to a product. */
export function baseDiscountMap(
  products: Product[],
  discounts: Discount[]
): { productDiscounts: Record<number, number>; unmatched: Discount[] } {
  const { productDiscounts, unmatched } = matchDiscounts(products, discounts);
  products.forEach((p, i) => {
    if (p.discount?.amount) productDiscounts[i] = (productDiscounts[i] || 0) + p.discount.amount;
  });
  return { productDiscounts, unmatched };
}
