/** Rounds to whole cents. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "€1,50" */
export function eur(n: number): string {
  return "€" + n.toFixed(2).replace(".", ",");
}
