import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, nameError, orderPeople, removeBlocker, withPeople } from "./people";
import { DEFAULT_PEOPLE } from "../constants";
import { toggled } from "./sets";
import { eur, round2 } from "./money";
import { emptyAppData } from "./testData";

describe("nameError", () => {
  const people = ["Ik", "Alice"];
  it("accepts a fresh name", () => expect(nameError(" Carol ", people)).toBe(""));
  it("rejects empty names", () => expect(nameError("  ", people)).not.toBe(""));
  it("rejects duplicates regardless of case", () => expect(nameError("alice", people)).not.toBe(""));
  it("rejects names that are too long", () => expect(nameError("x".repeat(MAX_NAME_LENGTH + 1), people)).not.toBe(""));
});

describe("removeBlocker", () => {
  it("never lets you remove yourself", () => expect(removeBlocker("Ik", emptyAppData())).not.toBe(""));

  it("blocks people who still owe money", () => {
    const data = emptyAppData({ assignments: { r1: { 0: { person: "Alice", cents: 200 } } } });
    expect(removeBlocker("Alice", data)).toContain("openstaande");
  });

  it("allows removing someone who owes nothing", () => expect(removeBlocker("Bob", emptyAppData())).toBe(""));
});

describe("people helpers", () => {
  it("falls back to the default people for old data", () => {
    expect(withPeople(undefined)).toBe(DEFAULT_PEOPLE);
    expect(withPeople([])).toBe(DEFAULT_PEOPLE);
    expect(withPeople(["A"])).toEqual(["A"]);
  });

  it("orders listed people first, historic names last", () => {
    expect(orderPeople(["Old", "Bob", "Ik"], ["Ik", "Alice", "Bob"])).toEqual(["Ik", "Bob", "Old"]);
  });
});

describe("small utils", () => {
  it("toggled adds and removes without mutating", () => {
    const a = new Set([1]);
    expect([...toggled(a, 2)]).toEqual([1, 2]);
    expect([...toggled(a, 1)]).toEqual([]);
    expect([...a]).toEqual([1]);
  });

  it("formats euros the Dutch way", () => {
    expect(eur(1.5)).toBe("€1,50");
    expect(eur(0)).toBe("€0,00");
  });

  it("rounds to cents", () => expect(round2(1.005 + 0.0001)).toBe(1.01));
});
