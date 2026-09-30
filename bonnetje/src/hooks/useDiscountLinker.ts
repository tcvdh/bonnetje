import { useCallback, useState } from "react";
import { toggled } from "../utils/sets";

/**
 * State of the "which products does this discount apply to" sheet. The picks are kept when the sheet
 * closes, so they don't vanish while it slides away.
 */
export function useDiscountLinker() {
  const [name, setName] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());

  /** Opens the sheet for a discount, with the products it is linked to now ticked. */
  const open = useCallback((discountName: string, linked: number[] = []) => {
    setSelection(new Set(linked));
    setName(discountName);
  }, []);
  const toggle = useCallback((index: number) => setSelection((prev) => toggled(prev, index)), []);
  const close = useCallback(() => setName(null), []);

  return { name, selection, open, toggle, close };
}
