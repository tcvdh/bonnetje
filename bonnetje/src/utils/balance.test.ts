import { describe, expect, it } from "vitest";
import { owedByPerson, receiptBalance } from "./balance";
import { emptyAppData } from "./testData";

describe("receiptBalance", () => {
  it("never counts your own share as owed", () => {
    const data = emptyAppData({ assignments: { r1: { 0: { person: "Ik", cents: 500 } } } });
    expect(receiptBalance("r1", data)).toEqual({ owed: 0, paid: 0, open: 0 });
  });

  it("splits shared items between the people", () => {
    const data = emptyAppData({ assignments: { r1: { 0: { split: ["Ik", "Alice"], cents: 300 } } } });
    expect(receiptBalance("r1", data).owed).toBe(1.5);
  });

  it("moves paid amounts out of open", () => {
    const data = emptyAppData({
      assignments: { r1: { 0: { person: "Alice", cents: 400 }, 1: { person: "Bob", cents: 200 } } },
      paid: { r1: { Alice: true } },
    });
    expect(receiptBalance("r1", data)).toEqual({ owed: 6, paid: 4, open: 2 });
  });

  it("is empty for an unknown receipt", () => {
    expect(receiptBalance("nope", emptyAppData())).toEqual({ owed: 0, paid: 0, open: 0 });
  });
});

describe("owedByPerson", () => {
  it("adds up open receipts per person and skips paid, done and hidden ones", () => {
    const data = emptyAppData({
      assignments: {
        a: { 0: { person: "Alice", cents: 200 }, 1: { split: ["Alice", "Bob"], cents: 1 } },
        b: { 0: { person: "Alice", cents: 500 } },
        c: { 0: { person: "Alice", cents: 700 } },
        d: { 0: { person: "Bob", cents: 300 } },
      },
      paid: { b: { Alice: true } },
      completed: ["c"],
      hidden: [],
    });
    // the odd cent of the second item rotates to Bob
    expect(owedByPerson(data)).toEqual({ Alice: 200, Bob: 301 });
  });
});
