import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAppData } from "../context";
import { describeError, getReceipt, getReceipts } from "../api";
import { applyOverrides, baseDiscountMap } from "../utils/discounts";
import { settleAssignments } from "../utils/settle";

/**
 * The receipts of the list screen. They are fetched each time the screen gets focus and on pull to
 * refresh, and kept in the shared context so every screen sees the same list. Also returns the state
 * of the Albert Heijn connection that came with them.
 */
export function useReceiptFeed() {
  const { data, persistData, receipts, setReceipts } = useAppData();
  const [ahError, setAhError] = useState("");
  const [ahCachedAt, setAhCachedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReceipts = useCallback(async () => {
    try {
      const res = await getReceipts();
      setReceipts(res.receipts);
      setAhError(res.ahError);
      setAhCachedAt(res.cachedAt);
    } catch (e) {
      Alert.alert("Kan bonnetjes niet ophalen", describeError(e));
    }
  }, [setReceipts]);

  useFocusEffect(
    useCallback(() => {
      fetchReceipts();
    }, [fetchReceipts])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReceipts();
    setRefreshing(false);
  }, [fetchReceipts]);

  // Split amounts saved by an older version lack the exact-cent settling. Redo them once per receipt per
  // session, so the balance and QR code match the receipt page even for receipts that were never reopened.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });
  const settledIds = useRef(new Set<string>());

  useEffect(() => {
    receipts.forEach(async (r) => {
      const current = dataRef.current;
      if (!current.assignments[r.id] || current.completed.includes(r.id) || settledIds.current.has(r.id)) return;
      settledIds.current.add(r.id);
      try {
        const detail = await getReceipt(r.id);
        if (!detail) return;
        const base = baseDiscountMap(detail.products, detail.discounts || []);
        // Built from the newest data when it is applied, so nothing done in the meantime is overwritten.
        persistData((cur) => {
          const assignments = cur.assignments[r.id];
          if (!assignments) return cur;
          const priced = applyOverrides(detail.products, base.productDiscounts, base.unmatched, cur.discountOverrides?.[r.id] || {});
          const settled = settleAssignments(assignments, detail.products, priced.map, priced.unmatched);
          return settled.changed ? { ...cur, assignments: { ...cur.assignments, [r.id]: settled.assignments } } : cur;
        });
      } catch {
        settledIds.current.delete(r.id); // try again next time
      }
    });
  }, [receipts, persistData]);

  return { receipts, ahError, ahCachedAt, refreshing, refresh };
}
