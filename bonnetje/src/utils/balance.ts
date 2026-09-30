import { AppData } from "../types";
import { ME } from "../constants";
import { receiptCents } from "./settle";

export interface ReceiptBalance {
  /** What other people owe for this receipt (your own share is never owed). */
  owed: number;
  /** Part of that which is already marked as paid. */
  paid: number;
  /** Still to receive. */
  open: number;
}

/** Euros, worked out in whole cents so the parts always add up to the total. */
export function receiptBalance(receiptId: string, data: AppData): ReceiptBalance {
  const paidBy = data.paid[receiptId] || {};
  let owed = 0;
  let paid = 0;
  Object.entries(receiptCents(data.assignments[receiptId] || {})).forEach(([person, cents]) => {
    if (person === ME) return;
    owed += cents;
    if (paidBy[person]) paid += cents;
  });
  return { owed: owed / 100, paid: paid / 100, open: Math.max(0, owed - paid) / 100 };
}

/**
 * What each other person still owes over all receipts that are open and visible, in cents.
 * The same receipts and the same amounts as an "all" invoice for that person.
 */
export function owedByPerson(data: AppData): Record<string, number> {
  const owed: Record<string, number> = {};
  Object.entries(data.assignments).forEach(([id, items]) => {
    if (data.completed.includes(id) || data.hidden.includes(id)) return;
    const paidBy = data.paid[id] || {};
    Object.entries(receiptCents(items)).forEach(([person, cents]) => {
      if (person === ME || paidBy[person]) return;
      owed[person] = (owed[person] ?? 0) + cents;
    });
  });
  return owed;
}
