import { AppData, Assignment } from "../types";
import { withPeople } from "./people";

/** An assignment as it may sit in stored data: `cents` today, euros in `amount` in older releases. */
type StoredAssignment = { person?: string; split?: string[]; cents?: unknown; amount?: unknown };

/**
 * Brings one stored assignment to the current shape. A number in `amount` means an older app wrote it
 * (it never writes `cents`), so it is the newer of the two and wins over a `cents` left behind.
 */
function normalizeAssignment(raw: StoredAssignment): Assignment {
  const cents =
    typeof raw.amount === "number"
      ? Math.round(raw.amount * 100)
      : typeof raw.cents === "number" && Number.isFinite(raw.cents)
        ? Math.round(raw.cents)
        : 0;
  return raw.split ? { split: raw.split, cents } : { person: raw.person ?? "", cents };
}

const emptyData = (): AppData => ({
  assignments: {},
  completed: [],
  hidden: [],
  paid: {},
  people: [],
  invoices: [],
  reservations: {},
  discountOverrides: {},
});

/** Fills in what older saves lack and converts euro amounts to cents. Every copy from the server or cache goes through here. */
export function normalizeData(raw: Partial<AppData> | null | undefined): AppData {
  const data = { ...emptyData(), ...(raw ?? {}) };
  const assignments: AppData["assignments"] = {};
  for (const [receiptId, items] of Object.entries(data.assignments ?? {})) {
    assignments[receiptId] = Object.fromEntries(
      Object.entries(items ?? {}).map(([index, a]) => [index, normalizeAssignment(a as StoredAssignment)])
    );
  }
  return { ...data, assignments, people: withPeople(data.people) };
}
