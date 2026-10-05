export const ME = "Ik";
export const DEFAULT_PEOPLE = [ME];

/** Names are plain text, so history keeps showing them after they are removed from the list. */
export type PersonName = string;

/** Same name, same colour — deterministic from the name so it stays stable across sessions. */
export function personColor(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { bg: `hsla(${hue},80%,60%,0.18)`, fg: `hsl(${hue},85%,65%)` };
}
