import { AppData, Product } from "../types";

/** Small fixtures shared by the utils tests. */
export const product = (name: string, amount: number, extra: Partial<Product> = {}): Product => ({
  id: 0,
  quantity: 1,
  name,
  price: null,
  amount: { amount },
  deposit: null,
  ...extra,
});

export const emptyAppData = (extra: Partial<AppData> = {}): AppData => ({
  assignments: {},
  completed: [],
  hidden: [],
  paid: {},
  people: ["Ik", "Alice", "Bob"],
  invoices: [],
  reservations: {},
  discountOverrides: {},
  ...extra,
});
