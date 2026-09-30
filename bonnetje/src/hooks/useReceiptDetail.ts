import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useAppData } from "../context";
import { describeError, getReceipt } from "../api";
import { Discount, Product } from "../types";
import { applyOverrides, baseDiscountMap } from "../utils/discounts";
import { settleAssignments } from "../utils/settle";

interface Loaded {
  products: Product[];
  /** Automatic discount matches; the user's manual links are applied on top (see `resolved`). */
  baseMap: Record<number, number>;
  allUnmatched: Discount[];
}

const NOTHING: Loaded = { products: [], baseMap: {}, allUnmatched: [] };

/** Loads one receipt's products and works out which discount belongs to which product, manual links included. */
export function useReceiptDetail(receiptId: string) {
  const { data, persistData } = useAppData();
  const [loaded, setLoaded] = useState<Loaded>(NOTHING);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    try {
      const detail = await getReceipt(receiptId);
      if (!detail) return;

      const products = detail.products;
      const { productDiscounts, unmatched } = baseDiscountMap(products, detail.discounts || []);
      setLoaded({ products, baseMap: productDiscounts, allUnmatched: unmatched });

      // Stored split amounts must follow the current net prices, manual links included.
      const stored = data.assignments[receiptId];
      if (stored) {
        const now = applyOverrides(products, productDiscounts, unmatched, data.discountOverrides?.[receiptId] || {});
        const refreshed = settleAssignments(stored, products, now.map, now.unmatched);
        if (refreshed.changed) {
          // The fetch finishes after the screen opened, so build from the newest data, not this render's.
          persistData((current) => ({
            ...current,
            assignments: { ...current.assignments, [receiptId]: refreshed.assignments },
          }));
        }
      }
    } catch (e) {
      Alert.alert("Kan bonnetje niet laden", describeError(e));
    } finally {
      setLoading(false);
    }
    // Only refetch when the receipt changes; `data` is read once for overrides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail();
  }, [fetchDetail]);

  const overrides = data.discountOverrides?.[receiptId] || {};
  const resolved = useMemo(
    () => applyOverrides(loaded.products, loaded.baseMap, loaded.allUnmatched, overrides),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, data.discountOverrides, receiptId]
  );

  return { loading, ...loaded, resolved };
}

export type ReceiptDetailState = ReturnType<typeof useReceiptDetail>;
