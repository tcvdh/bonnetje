import { PersonName } from "./constants";

export interface Receipt {
  id: string;
  dateTime: string;
  totalAmount: { amount: number };
  source?: string;
  storeName?: string;
  /** Things the scanner was unsure about. Only on scanned receipts. */
  warnings?: string[];
}

export interface Product {
  id: number;
  quantity: number;
  name: string;
  /** Category emoji, only on scanned receipts and only when the scanner was certain. */
  emoji?: string;
  price: { amount: number } | null;
  amount: { amount: number };
  deposit: { amount: number } | null;
  /** Discount already tied to this product (scanned receipts). Negative amount. */
  discount?: { amount: number; label?: string } | null;
}

export interface Discount {
  name: string;
  amount: { amount: number };
  /** Basket-level discount: never auto-matched to a product. */
  general?: boolean;
}

/**
 * `cents` is the settled price of the item in whole cents (see utils/settle.ts). It is stored as
 * `cents`, not `amount`: older releases kept euros in `amount`, and a new number under the old
 * name would be read by them as euros. `normalizeData` converts old data when it is loaded.
 */
export interface AssignmentPerson {
  person: PersonName;
  cents: number;
}

export interface AssignmentSplit {
  split: PersonName[];
  cents: number;
}

export type Assignment = AssignmentPerson | AssignmentSplit;

export interface InvoiceLine {
  name: string;
  emoji?: string;
  quantity: number;
  /** Fraction of the product this person pays: 1, 0.5, ... */
  share: number;
  amount: number;
}

export interface InvoiceReceipt {
  receiptId: string;
  store: string;
  dateTime: string;
  lines: InvoiceLine[];
  subtotal: number;
  /** Set when the payment for just this receipt was undone. */
  voidedAt?: string;
}

/** Snapshot of what a person paid for, made when they were marked as paid. */
export interface Invoice {
  id: string;
  number: string;
  person: PersonName;
  paidAt: string;
  scope: "all" | "receipt";
  receipts: InvoiceReceipt[];
  total: number;
  /** Set when every receipt on it was undone. */
  voidedAt?: string;
}

export interface AppData {
  assignments: Record<string, Record<string, Assignment>>;
  completed: string[];
  hidden: string[];
  paid: Record<string, Record<string, boolean>>;
  people: string[];
  invoices: Invoice[];
  /** person -> invoice number already handed out in a QR code, kept until they pay. */
  reservations: Record<string, string>;
  // receiptId -> discountName -> product index, or several indices (split by price)
  discountOverrides: Record<string, Record<string, number | number[]>>;
}

export interface ReceiptDetail {
  id: string;
  memberId: string;
  products: Product[];
  discounts: Discount[];
  payments: { method: string; amount: { amount: number } }[];
}
