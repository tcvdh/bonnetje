import { getReceiptDetails } from "../api";
import { useAppData } from "../context";
import { PersonName } from "../constants";
import { Invoice } from "../types";
import { buildInvoice, pendingReceiptIds, withoutReservation } from "../utils/invoice";

/**
 * Returns a function that marks everything a person owes as paid, saves an invoice of what they paid
 * for and hands it to `onInvoice` to be shown.
 */
export function useMarkAllPaid(onInvoice: (invoice: Invoice) => void) {
  const { data, persistData, receipts } = useAppData();

  return async function markAllPaid(person: PersonName) {
    const ids = pendingReceiptIds(person, data);
    if (!ids.length) return;

    const details = await getReceiptDetails(ids); // a failed one falls back to "Product n" instead of blocking the payment

    // Built from the newest data: other changes may have been saved while the details loaded. Only the receipts
    // that were owed when you tapped (what the QR code showed) and still are get paid.
    const made: { invoice?: Invoice } = {};
    persistData((current) => {
      const stillOpen = new Set(pendingReceiptIds(person, current));
      const receiptIds = ids.filter((id) => stillOpen.has(id));
      if (!receiptIds.length) return current;
      made.invoice = buildInvoice({ person, receiptIds, data: current, receipts, details, now: new Date(), scope: "all" });
      const paid = { ...current.paid };
      receiptIds.forEach((id) => {
        paid[id] = { ...(paid[id] || {}), [person]: true };
      });
      return { ...current, paid, invoices: [made.invoice, ...current.invoices], reservations: withoutReservation(current, person) };
    });
    if (made.invoice) onInvoice(made.invoice);
  };
}
