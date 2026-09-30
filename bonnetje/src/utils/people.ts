import { AppData } from "../types";
import { DEFAULT_PEOPLE, ME } from "../constants";
import { pendingReceiptIds } from "./invoice";

export const MAX_NAME_LENGTH = 20;

/** The saved list, or the original four for data that predates custom people. */
export function withPeople(people: string[] | undefined): string[] {
  return people && people.length ? people : DEFAULT_PEOPLE;
}

/** Empty string when the name can be added, otherwise what is wrong with it. */
export function nameError(raw: string, people: string[]): string {
  const name = raw.trim();
  if (!name) return "Vul een naam in.";
  if (name.length > MAX_NAME_LENGTH) return `Maximaal ${MAX_NAME_LENGTH} tekens.`;
  if (people.some((p) => p.toLowerCase() === name.toLowerCase())) return "Deze naam bestaat al.";
  return "";
}

/** Only people who owe nothing can go, and never yourself. */
export function removeBlocker(name: string, data: AppData): string {
  if (name === ME) return "Jezelf kun je niet verwijderen.";
  const open = pendingReceiptIds(name, data).length;
  if (open > 0) {
    return `${name} heeft nog openstaande bonnetjes (${open}). Verwijderen kan zodra alles is betaald.`;
  }
  return "";
}

/** Listed people first (in list order), then anyone who only exists in history. */
export function orderPeople(names: Iterable<string>, listed: string[]): string[] {
  const rank = (n: string) => {
    const i = listed.indexOf(n);
    return i === -1 ? listed.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
}
