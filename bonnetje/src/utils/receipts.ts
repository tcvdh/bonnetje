import { AppData } from "../types";

/** Scanned receipts (photo -> Gemini) live only on our server, so only these can be deleted for good. */
export const isScanned = (receiptId: string) => receiptId.startsWith("scan_");

/**
 * The data without any trace of one receipt. Invoices already handed out keep their own copy of the lines,
 * so they stay correct.
 */
export function removeReceipt(data: AppData, id: string): AppData {
  const without = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));
  return {
    ...data,
    assignments: without(data.assignments),
    paid: without(data.paid),
    discountOverrides: without(data.discountOverrides ?? {}),
    completed: data.completed.filter((r) => r !== id),
    hidden: data.hidden.filter((r) => r !== id),
  };
}
