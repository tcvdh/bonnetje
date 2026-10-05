/**
 * How far behind the installed app is. A new major or minor version (1.2.0 after 1.1.x) may change the
 * shared data, so the app must be updated before it can be used again; a new patch (1.1.3) is optional.
 */
export type UpdateLevel = "none" | "optional" | "required";

const parse = (v: string) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? m.slice(1).map(Number) : null;
};

export function updateLevel(current: string, latest: string): UpdateLevel {
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return "none"; // unreadable: never lock anyone out over it
  if (b[0] !== a[0] || b[1] !== a[1]) return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? "required" : "none";
  return b[2] > a[2] ? "optional" : "none";
}
