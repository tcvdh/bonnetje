import { useCallback, useState } from "react";
import { toggled } from "../utils/sets";

/** Multi-select mode: whether it is on, what is picked, and the handful of things you do with that. */
export function useSelection<T>() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const start = useCallback(() => setActive(true), []);
  /** Leaves the mode and forgets the picks. */
  const stop = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);
  const toggle = useCallback((item: T) => setSelected((prev) => toggled(prev, item)), []);
  const setAll = useCallback((items: T[]) => setSelected(new Set(items)), []);

  return { active, selected, start, stop, toggle, setAll };
}
