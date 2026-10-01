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

    const invoice = buildInvoice({ person, receiptIds: ids, data, receipts, details, now: new Date(), scope: "all" });
    const paid = { ...data.paid };
    ids.forEach((id) => {
      paid[id] = { ...(paid[id] || {}), [person]: true };
    });
    persistData({ ...data, paid, invoices: [invoice, ...data.invoices], reservations: withoutReservation(data, person) });
    onInvoice(invoice);
  };
}
