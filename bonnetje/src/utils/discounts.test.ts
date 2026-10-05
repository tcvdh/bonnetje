import { describe, expect, it } from "vitest";
import {
  applyOverrides,
  baseDiscountMap,
  getNetAmount,
  matchDiscounts,
  splitDiscount,
} from "./discounts";
import { product } from "./testData";

const cents = (map: Record<number, number>) => Math.round(Object.values(map).reduce((a, b) => a + b, 0) * 100);

describe("getNetAmount", () => {
  it("adds discount (negative) and deposit to the line amount", () => {
    const p = product("Bier", 10, { deposit: { amount: 0.1 } });
    expect(getNetAmount(p, -1.5)).toBe(8.6);
  });

  it("does not leave float noise", () => {
    expect(getNetAmount(product("x", 0.1), 0.2)).toBe(0.3);
  });
});

describe("splitDiscount", () => {
  it("always adds up to the discount, to the cent", () => {
    const products = [product("a", 1), product("b", 1), product("c", 1)];
    const parts = splitDiscount(products, [0, 1, 2], -1);
    expect(cents(parts)).toBe(-100);
  });

  it("weights by price", () => {
    const products = [product("a", 3), product("b", 1)];
    expect(splitDiscount(products, [0, 1], -0.4)).toEqual({ 0: -0.3, 1: -0.1 });
  });

  it("splits evenly when all prices are zero", () => {
    const products = [product("a", 0), product("b", 0)];
    expect(splitDiscount(products, [0, 1], -0.5)).toEqual({ 0: -0.25, 1: -0.25 });
  });

  it("ignores indices that are not products", () => {
    expect(splitDiscount([product("a", 2)], [0, 5], -1)).toEqual({ 0: -1 });
    expect(splitDiscount([product("a", 2)], [7], -1)).toEqual({});
  });
});

describe("matchDiscounts", () => {
  it("links a discount to the product with the same name", () => {
    const products = [product("AH Halfvolle melk", 1.2), product("Pindakaas", 2.5)];
    const { productDiscounts, unmatched } = matchDiscounts(products, [
      { name: "Pindakaas", amount: { amount: -0.5 } },
    ]);
    expect(productDiscounts).toEqual({ 1: -0.5 });
    expect(unmatched).toEqual([]);
  });

  it("leaves general (basket) discounts unmatched", () => {
    const products = [product("Pindakaas", 2.5)];
    const general = { name: "Pindakaas", amount: { amount: -1 }, general: true };
    const { productDiscounts, unmatched } = matchDiscounts(products, [general]);
    expect(productDiscounts).toEqual({});
    expect(unmatched).toEqual([general]);
  });

  it("leaves a discount unmatched when nothing resembles it", () => {
    const { unmatched } = matchDiscounts([product("Pindakaas", 2.5)], [{ name: "Zzzz", amount: { amount: -1 } }]);
    expect(unmatched).toHaveLength(1);
  });

  it("never matches on a name without letters", () => {
    const pct = { name: "25%", amount: { amount: -1 } };
    expect(matchDiscounts([product("Melk", 1), product("Brood", 2)], [pct]).unmatched).toEqual([pct]);
    const bonus = { name: "Bonus melk", amount: { amount: -1 } };
    expect(matchDiscounts([product("100", 1), product("Melk", 2)], [bonus]).productDiscounts).toEqual({ 1: -1 });
  });

  it("returns nothing for an empty list", () => {
    expect(matchDiscounts([product("a", 1)], [])).toEqual({ productDiscounts: {}, unmatched: [] });
  });
});

describe("baseDiscountMap", () => {
  it("adds a discount that a scanned product already carries", () => {
    const products = [product("Kaas", 5, { discount: { amount: -1 } })];
    expect(baseDiscountMap(products, []).productDiscounts).toEqual({ 0: -1 });
  });
});

describe("applyOverrides", () => {
  const products = [product("a", 2), product("b", 2)];
  const discount = { name: "Bon", amount: { amount: -1 }, general: true };

  it("keeps a discount unmatched without a link", () => {
    const r = applyOverrides(products, {}, [discount], {});
    expect(r.unmatched).toEqual([discount]);
    expect(r.map).toEqual({});
  });

  it("spreads a linked discount over its products", () => {
    const r = applyOverrides(products, {}, [discount], { Bon: [0, 1] });
    expect(r.unmatched).toEqual([]);
    expect(r.map).toEqual({ 0: -0.5, 1: -0.5 });
    expect(r.linked[0].indices).toEqual([0, 1]);
  });

  it("accepts the old single-index form", () => {
    expect(applyOverrides(products, {}, [discount], { Bon: 1 }).map).toEqual({ 1: -1 });
  });

  it("adds on top of automatic matches", () => {
    expect(applyOverrides(products, { 0: -0.25 }, [discount], { Bon: [0] }).map).toEqual({ 0: -1.25 });
  });
});
