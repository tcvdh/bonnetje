import { createContext, useContext } from "react";
import { AppData, Receipt } from "./types";
import { DEFAULT_PEOPLE } from "./constants";

export const emptyData: AppData = {
  assignments: {},
  completed: [],
  hidden: [],
  paid: {},
  people: DEFAULT_PEOPLE,
  invoices: [],
  reservations: {},
  discountOverrides: {},
};

/** The new data, or a function that builds it from the newest data (use this after an await). */
export type DataUpdate = AppData | ((current: AppData) => AppData);

export interface AppContextType {
  data: AppData;
  persistData: (update: DataUpdate) => void;
  /** The receipts last fetched by the list screen. Every screen reads them from here, so none holds a stale copy. */
  receipts: Receipt[];
  setReceipts: (receipts: Receipt[]) => void;
  /** Forgets the server and returns to the connect screen. */
  disconnect: () => Promise<void>;
}

export const AppContext = createContext<AppContextType>({
  data: emptyData,
  persistData: () => {},
  receipts: [],
  setReceipts: () => {},
  disconnect: async () => {},
});

export function useAppData() {
  return useContext(AppContext);
}
