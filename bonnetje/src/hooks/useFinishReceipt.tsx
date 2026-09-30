import React, { useState } from "react";
import { AppData, Assignment, Discount, Product } from "../types";
import { DataUpdate } from "../context";
import { ME } from "../constants";
import { receiptBalance } from "../utils/balance";
import { settleAssignments } from "../utils/settle";
import { eur } from "../theme";
import ConfirmDialog from "../components/ConfirmDialog";

/** What the caller must provide: the products of the receipt, their discount per product and the unlinked discounts. */
export interface Pricing {
  products: Product[];
  discountMap: Record<number, number>;
  /** Discounts not linked to a product; they are spread over the split so the totals stay exact. */
  unmatched: Discount[];
}

interface Options {
  data: AppData;
  persistData: (update: DataUpdate) => void;
  /** The list screen has to fetch this; the receipt screen already has it in memory. */
  loadPricing: (receiptId: string) => Promise<Pricing>;
  /** Called after the receipt has been moved to "Afgerond". */
  onFinished?: (receiptId: string) => void;
  onError?: (error: unknown) => void;
}

/**
 * The one place that decides what "afronden" means, used by the swipe action and by the
 * "Afronden" button on the receipt page:
 *
 *  - someone else has paid everything they owe -> just mark it done, keep the split
 *  - nothing is divided yet                    -> put every product on "Ik", then mark it done
 *  - someone still owes money                  -> ask first, then put every product on "Ik"
 */
export function useFinishReceipt({ data, persistData, loadPricing, onFinished, onError }: Options) {
  const [asking, setAsking] = useState<{ receiptIds: string[]; open: number } | null>(null);

  /** Prices every product on "Ik" for one receipt. */
  async function allOnMe(id: string): Promise<Record<string, Assignment>> {
    const { products, discountMap, unmatched } = await loadPricing(id);
    const all: Record<string, Assignment> = {};
    products.forEach((_, i) => {
      all[i] = { person: ME, cents: 0 };
    });
    return settleAssignments(all, products, discountMap, unmatched).assignments;
  }

  /** Completes the receipts in one save; `assignments` holds the receipts that get everything on "Ik". */
  function markDone(ids: string[], assignments: Record<string, Record<string, Assignment>> = {}) {
    // Built from the newest data: loading prices takes a moment, and the data may have changed meanwhile.
    persistData((current) => ({
      ...current,
      assignments: { ...current.assignments, ...assignments },
      completed: [...new Set([...current.completed, ...ids])],
    }));
    ids.forEach((id) => onFinished?.(id));
  }

  async function finishOnMe(ids: string[], toAssign: string[]) {
    try {
      const entries = await Promise.all(toAssign.map(async (id) => [id, await allOnMe(id)] as const));
      markDone(ids, Object.fromEntries(entries));
    } catch (e) {
      onError?.(e);
    }
  }

  /** Same rules for one receipt or many; a single question covers everything that would lose its split. */
  function finishMany(ids: string[]) {
    const owed = ids.filter((id) => receiptBalance(id, data).open > 0);
    const undivided = ids.filter((id) => Object.keys(data.assignments[id] || {}).length === 0);
    const toAssign = [...new Set([...owed, ...undivided])];

    if (owed.length > 0) {
      const open = owed.reduce((sum, id) => sum + receiptBalance(id, data).open, 0);
      setAsking({ receiptIds: ids, open });
    } else if (toAssign.length > 0) {
      finishOnMe(ids, toAssign);
    } else {
      markDone(ids);
    }
  }

  const finish = (id: string) => finishMany([id]);

  const dialog = (
    <ConfirmDialog
      visible={!!asking}
      title="Afronden op jezelf?"
      message={
        asking
          ? `Er staat nog ${eur(asking.open)} open. ${
              asking.receiptIds.length > 1 ? "Bonnetjes waar nog iemand geld open heeft" : "Alle producten van dit bonnetje"
            } worden op Ik gezet en ${asking.receiptIds.length > 1 ? "alles" : "het bonnetje"} gaat naar Afgerond. De huidige verdeling van die bonnetjes gaat verloren.`
          : ""
      }
      confirmLabel="Alles op Ik zetten"
      onConfirm={() => {
        const ids = asking?.receiptIds;
        setAsking(null);
        if (!ids) return;
        const toAssign = ids.filter(
          (id) => receiptBalance(id, data).open > 0 || Object.keys(data.assignments[id] || {}).length === 0
        );
        finishOnMe(ids, toAssign);
      }}
      onCancel={() => setAsking(null)}
    />
  );

  return { finish, finishMany, dialog };
}
