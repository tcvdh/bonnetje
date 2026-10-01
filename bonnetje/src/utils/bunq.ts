/** bunq.me payment link with the amount and description filled in. `amount` is euros with two decimals at most. */
export function bunqLink(handle: string, amount: number, desc: string): string {
  return `https://bunq.me/${encodeURIComponent(handle)}/${amount.toFixed(2)}/${encodeURIComponent(desc)}`;
}
