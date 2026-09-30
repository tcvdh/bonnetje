/** True for addresses that never leave your own network: private and loopback IPs, Tailscale (100.64/10), *.local. */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * The address the user typed, made ready to use. Plain http is only kept for local addresses (a home server);
 * everything else is https, also when the user typed http://.
 */
export function normalizeServerUrl(input: string): string {
  const url = input.trim().replace(/\/+$/, "").replace(/^https?:\/\//i, (scheme) => scheme.toLowerCase());
  const typed = /^https?:\/\//.exec(url)?.[0];
  const rest = typed ? url.slice(typed.length) : url;
  const host = rest.split(/[:/]/)[0];
  return `${isLocalHost(host) && typed !== "https://" ? "http" : "https"}://${rest}`;
}
