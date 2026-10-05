import { AppData, Invoice, InvoiceLine, InvoiceReceipt, Receipt, ReceiptDetail } from "../types";
import { PersonName } from "../constants";
import { eur } from "./money";
import { receiptCents, shareCents, sumCents, toCents } from "./settle";

/** Receipts this person still has to pay, using the same rules as the balance on the main screen. */
export function pendingReceiptIds(person: PersonName, data: AppData): string[] {
  return Object.entries(data.assignments)
    .filter(([id, items]) => {
      if (data.completed.includes(id) || data.hidden.includes(id)) return false;
      if (data.paid[id]?.[person]) return false;
      return (receiptCents(items)[person] ?? 0) !== 0;
    })
    .map(([id]) => id);
}

export function storeName(receipt?: Receipt): string {
  if (!receipt) return "Onbekende winkel";
  return (receipt.source || "ah") === "ah" ? "Albert Heijn" : receipt.storeName || "Scan";
}

/** "1 van 5 stuks" when the share is a whole number of the line's items, otherwise a percentage ("25%"). */
export function shareLabel(line: Pick<InvoiceLine, "share" | "quantity">): string {
  const pieces = line.share * line.quantity;
  if (Number.isInteger(line.quantity) && line.quantity > 1 && Math.abs(pieces - Math.round(pieces)) < 1e-9) {
    return `${Math.round(pieces)} van ${line.quantity} stuks`;
  }
  return `${Math.round(line.share * 100)}%`;
}

interface BuildOptions {
  person: PersonName;
  receiptIds: string[];
  data: AppData;
  receipts: Receipt[];
  /** Product names come from here; a missing receipt falls back to "Product n". */
  details: Record<string, Pick<ReceiptDetail, "products"> | null | undefined>;
  now: Date;
  scope: Invoice["scope"];
}

/**
 * Next number nobody has: above every invoice and every number promised in a QR code,
 * so deleting an invoice never causes a duplicate. `except` ignores that person's own reservation.
 */
export function nextInvoiceNumber(data: AppData, now: Date, except?: string): string {
  const year = now.getFullYear();
  const used = [
    ...data.invoices.map((i) => i.number),
    ...Object.entries(data.reservations ?? {}).filter(([p]) => p !== except).map(([, n]) => n),
  ];
  const highest = used.reduce((max, number) => {
    const [y, n] = number.split("-");
    return Number(y) === year ? Math.max(max, Number(n) || 0) : max;
  }, 0);
  return `${year}-${String(highest + 1).padStart(3, "0")}`;
}

/** Locks a number for this person (kept if they already have one) and returns the updated data. */
export function reserveNumber(data: AppData, person: string, now: Date, renew = false): AppData {
  if (data.reservations?.[person] && !renew) return data;
  return { ...data, reservations: { ...data.reservations, [person]: nextInvoiceNumber(data, now, person) } };
}

export function withoutReservation(data: AppData, person: string): Record<string, string> {
  const { [person]: _released, ...rest } = data.reservations ?? {};
  return rest;
}

/**
 * The lines are this person's part of every assigned item, in whole cents from `shareCents`, so the
 * invoice adds up to exactly what the balance and the QR code showed.
 */
export function buildInvoice({ person, receiptIds, data, receipts, details, now, scope }: BuildOptions): Invoice {
  // A number promised in this person's QR code wins, so the transfer description and invoice match.
  const reserved = scope === "all" ? data.reservations?.[person] : undefined;
  const drafts: { receiptId: string; lines: InvoiceLine[]; cents: number }[] = [];

  receiptIds.forEach((id) => {
    const assignments = data.assignments[id] || {};
    const products = details[id]?.products ?? [];
    const lines: InvoiceLine[] = [];
    let receiptTotal = 0; // cents, so the subtotals and the total are exact

    Object.keys(assignments)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((i) => {
        const a = assignments[i];
        const cents = shareCents(a, i)[person] ?? 0;
        if (cents === 0) return;
        receiptTotal += cents;
        const product = products[i];
        lines.push({
          name: product?.name ?? `Product ${i + 1}`,
          emoji: product?.emoji || undefined,
          quantity: product?.quantity ?? 1,
          share: "person" in a ? 1 : a.split.filter((p) => p === person).length / a.split.length,
          amount: cents / 100,
        });
      });
    if (lines.length) drafts.push({ receiptId: id, lines, cents: receiptTotal });
  });

  const dateOf = (id: string) => receipts.find((r) => r.id === id)?.dateTime ?? "";
  drafts.sort((x, y) => dateOf(x.receiptId).localeCompare(dateOf(y.receiptId)));

  const invoiceReceipts: InvoiceReceipt[] = drafts.map(({ receiptId, lines, cents }) => {
    const receipt = receipts.find((r) => r.id === receiptId);
    return {
      receiptId,
      store: storeName(receipt),
      dateTime: receipt?.dateTime ?? now.toISOString(),
      lines,
      subtotal: cents / 100,
    };
  });

  return {
    id: `${now.getTime()}-${person}`,
    number: reserved && !data.invoices.some((i) => i.number === reserved) ? reserved : nextInvoiceNumber(data, now, person),
    person,
    paidAt: now.toISOString(),
    scope,
    receipts: invoiceReceipts,
    total: sumCents(drafts.map((d) => d.cents)) / 100,
  };
}

/** What still counts as paid: receipts whose payment was not undone. */
export function activeTotal(inv: Invoice): number {
  return sumCents(inv.receipts.filter((r) => !r.voidedAt).map((r) => toCents(r.subtotal))) / 100;
}

/** Marks one receipt as withdrawn on every matching invoice of this person. */
export function voidReceiptOnInvoices(invoices: Invoice[], person: PersonName, receiptId: string, at: string): Invoice[] {
  return invoices.map((inv) => {
    if (inv.person !== person || inv.voidedAt) return inv;
    if (!inv.receipts.some((r) => r.receiptId === receiptId && !r.voidedAt)) return inv;
    const receipts = inv.receipts.map((r) => (r.receiptId === receiptId && !r.voidedAt ? { ...r, voidedAt: at } : r));
    return { ...inv, receipts, voidedAt: receipts.every((r) => r.voidedAt) ? at : undefined };
  });
}

const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dateShort = (iso: string) =>
  new Date(iso).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

export const formatPaidAt = (iso: string) => `${dateLong(iso)} om ${timeOf(iso)}`;
export const formatReceiptDate = dateShort;

/** Plain-text version for sharing (chat, mail, notes). */
export function invoiceText(inv: Invoice): string {
  const out: string[] = [
    `Afrekening ${inv.number}`,
    `${inv.person}, betaald op ${formatPaidAt(inv.paidAt)}`,
  ];
  pushReceipts(out, inv);
  out.push("", `Totaal: ${eur(activeTotal(inv))}`);
  return out.join("\n");
}

/**
 * The same list for an invoice that is not paid yet, to send with a payment link: it never says "betaald",
 * and has no paid date. Build `inv` with `buildInvoice`, so the lines and the total are what the QR code asks for.
 */
export function paymentRequestText(inv: Invoice, link: string): string {
  const out: string[] = [`Afrekening ${inv.number}`, inv.person];
  pushReceipts(out, inv);
  out.push("", `Totaal: ${eur(inv.total)}`, "", `Betalen kan hier: ${link}`);
  return out.join("\n");
}

function pushReceipts(out: string[], inv: Invoice) {
  inv.receipts.forEach((r) => {
    out.push("", `${r.store}, ${dateShort(r.dateTime)}${r.voidedAt ? `, betaling ingetrokken op ${formatPaidAt(r.voidedAt)}` : ""}`);
    r.lines.forEach((l) => {
      const qty = l.quantity !== 1 ? `${l.quantity}x ` : "";
      const share = l.share < 1 ? ` (${shareLabel(l)})` : "";
      out.push(`  ${l.emoji ? l.emoji + " " : ""}${qty}${l.name}${share}: ${eur(l.amount)}`);
    });
    if (inv.receipts.length > 1) out.push(`  Subtotaal: ${eur(r.subtotal)}`);
  });
}
