import { useAppData } from "../context";
import { PersonName } from "../constants";
import { Assignment, Invoice } from "../types";
import { applyOverrides } from "../utils/discounts";
import { buildInvoice, voidReceiptOnInvoices } from "../utils/invoice";
import { netCents, settleAssignments } from "../utils/settle";
import { ReceiptDetailState } from "./useReceiptDetail";

/** Everything you can change on one receipt. Each action settles the amounts again and saves. */
export function useReceiptActions(receiptId: string, detail: ReceiptDetailState) {
  const { data, persistData, receipts } = useAppData();
  const { products, baseMap, allUnmatched, resolved } = detail;
  const discountMap = resolved.map;
  const assignments = data.assignments[receiptId] || {};

  const netOf = (i: number) => netCents(products[i], discountMap[i] || 0);

  /** Sets (or, when `make` returns null, clears) the assignment of each given product and saves. */
  function editItems(indices: Iterable<number>, make: (i: number) => Assignment | null) {
    const next = { ...assignments };
    for (const i of indices) {
      const assignment = make(i);
      if (assignment) next[i] = assignment;
      else delete next[i];
    }
    // Unlinked discounts are spread over whatever is assigned, so every amount is settled again.
    const settled = settleAssignments(next, products, discountMap, resolved.unmatched).assignments;
    persistData({ ...data, assignments: { ...data.assignments, [receiptId]: settled } });
  }

  return {
    assign: (indices: Iterable<number>, person: PersonName) => editItems(indices, (i) => ({ person, cents: netOf(i) })),
    split: (indices: Iterable<number>, people: PersonName[]) => editItems(indices, (i) => ({ split: people, cents: netOf(i) })),
    clear: (indices: Iterable<number>) => editItems(indices, () => null),

    /** Back to how this receipt looks when fetched fresh: no split, payments, links or "afgerond". */
    reset() {
      const { [receiptId]: _a, ...assignmentsRest } = data.assignments;
      const { [receiptId]: _p, ...paidRest } = data.paid;
      const { [receiptId]: _o, ...overridesRest } = data.discountOverrides || {};
      persistData({
        ...data,
        assignments: assignmentsRest,
        paid: paidRest,
        discountOverrides: overridesRest,
        completed: data.completed.filter((id) => id !== receiptId),
      });
    },

    reopen() {
      persistData({ ...data, completed: data.completed.filter((id) => id !== receiptId) });
    },

    /** Hiding keeps assignments and payments, so "Verborgen" in the menu can restore it intact. */
    hide() {
      persistData({ ...data, hidden: [...data.hidden, receiptId] });
    },

    /** Links a discount to the chosen products (none = unlink) and keeps split amounts in sync. */
    saveLinks(discountName: string, chosen: number[]) {
      const overrides = { ...(data.discountOverrides?.[receiptId] || {}) };
      if (chosen.length) overrides[discountName] = chosen;
      else delete overrides[discountName];

      const after = applyOverrides(products, baseMap, allUnmatched, overrides);
      const refreshed = settleAssignments(assignments, products, after.map, after.unmatched);

      persistData({
        ...data,
        assignments: { ...data.assignments, [receiptId]: refreshed.assignments },
        discountOverrides: { ...(data.discountOverrides || {}), [receiptId]: overrides },
      });
    },

    /** Marks a person as paid for this receipt, returning the invoice that was made, or undoes it (returns null). */
    setPaid(person: PersonName, paid: boolean): Invoice | null {
      const paidNow = { ...(data.paid[receiptId] || {}) };
      if (!paid) {
        // Undoing a payment also withdraws the invoices that counted this receipt for this person.
        delete paidNow[person];
        persistData({
          ...data,
          paid: { ...data.paid, [receiptId]: paidNow },
          invoices: voidReceiptOnInvoices(data.invoices, person, receiptId, new Date().toISOString()),
        });
        return null;
      }

      paidNow[person] = true;
      const invoice = buildInvoice({
        person,
        receiptIds: [receiptId],
        data,
        receipts,
        details: { [receiptId]: { products } },
        now: new Date(),
        scope: "receipt",
      });
      persistData({ ...data, paid: { ...data.paid, [receiptId]: paidNow }, invoices: [invoice, ...data.invoices] });
      return invoice;
    },
  };
}
