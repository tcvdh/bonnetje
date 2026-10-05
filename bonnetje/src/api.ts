import { normalizeData } from "./utils/normalize";
import { normalizeServerUrl } from "./utils/serverUrl";
import { Platform } from "react-native";
import * as SecureStoreNative from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppData, Receipt, ReceiptDetail } from "./types";

// All data and the Albert Heijn login live on the central server.
// The app only stores the server address + shared key, plus a local cache of the data.

const URL_KEY = "server_url";
const APP_KEY_KEY = "server_key";
const CACHE_KEY = "app_data_cache";
const PAYEE_KEY = "payee";

// expo-secure-store has no web implementation; fall back to localStorage there.
const SecureStore = {
  async getItemAsync(key: string): Promise<string | null> {
    if (Platform.OS === "web") return localStorage.getItem(key);
    return SecureStoreNative.getItemAsync(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return localStorage.setItem(key, value);
    return SecureStoreNative.setItemAsync(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    if (Platform.OS === "web") return localStorage.removeItem(key);
    return SecureStoreNative.deleteItemAsync(key);
  },
};

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    /** Ready-to-show Dutch text when the server provides one. */
    public userMessage = "",
    public body: any = {}
  ) {
    super(code);
  }
}

// ── Server config ──

export interface ServerConfig {
  url: string;
  key: string;
}

let config: ServerConfig | null = null;

export async function loadServerConfig(): Promise<ServerConfig | null> {
  const url = await SecureStore.getItemAsync(URL_KEY);
  const key = await SecureStore.getItemAsync(APP_KEY_KEY);
  config = url && key ? { url: normalizeServerUrl(url), key } : null; // re-checked: plain http only stays for local addresses
  try {
    const saved = await AsyncStorage.getItem(PAYEE_KEY);
    if (saved) payee = JSON.parse(saved);
  } catch {}
  return config;
}

export async function saveServerConfig(next: ServerConfig): Promise<void> {
  config = { url: normalizeServerUrl(next.url), key: next.key.trim() };
  await SecureStore.setItemAsync(URL_KEY, config.url);
  await SecureStore.setItemAsync(APP_KEY_KEY, config.key);
}

// ── Requests ──

/** How long a request may take. A scan waits for Gemini, which the server gives up to two minutes. */
const TIMEOUT_MS = 20_000;
const SCAN_TIMEOUT_MS = 150_000;

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; cfg?: ServerConfig; timeoutMs?: number } = {}
): Promise<T> {
  const cfg = init.cfg ?? config;
  if (!cfg) throw new ApiError("not_configured", 0);

  // A server that never answers must not leave a spinner forever.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), init.timeoutMs ?? TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${cfg.url}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.key}`,
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: abort.signal,
      });
    } catch {
      throw new ApiError(abort.signal.aborted ? "timeout" : "unreachable", 0);
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(json?.error ?? `http_${res.status}`, res.status, json?.message ?? "", json);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

/** No answer at all (offline, or the server took too long): the cache and a later retry can stand in. */
const isNoAnswer = (e: unknown) => e instanceof ApiError && (e.code === "unreachable" || e.code === "timeout");

/** Turn an ApiError into a message for the user. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError && e.userMessage) return e.userMessage;
  const code = e instanceof ApiError ? e.code : "";
  switch (code) {
    case "unreachable":
      return "Kan de server niet bereiken. Controleer het adres en je verbinding.";
    case "timeout":
      return "De server reageert niet op tijd. Probeer het zo opnieuw.";
    case "unauthorized":
      return "De server-sleutel klopt niet, of dit huishouden is uitgeschakeld.";
    case "rate_limited":
      return "Je doet te veel verzoeken achter elkaar. Wacht even en probeer het opnieuw.";
    case "too_many_attempts":
      return "Te veel foute sleutels achter elkaar. Wacht een minuut en probeer het opnieuw.";
    case "too_large":
      return "Dit is te groot om naar de server te sturen.";
    case "ah_not_logged_in":
      return "De server is niet ingelogd bij Albert Heijn. Log in via de beheerpagina van de server.";
    case "ah_disabled":
      return "Albert Heijn staat uit op deze server.";
    case "not_found":
      return "Dit staat niet (meer) op de server.";
    case "photo_missing":
      return "De foto van dit bonnetje staat niet meer op de server.";
    case "bad_request":
      return "De server begreep dit verzoek niet. Werk de app en de server bij en probeer het opnieuw.";
    case "server_error":
      return "Er ging iets mis op de server. Probeer het zo opnieuw; blijft het misgaan, kijk dan in het serverlog.";
    case "http_503":
      return "De server is even te druk. Probeer het zo opnieuw.";
    default:
      return "Er ging iets mis bij de server.";
  }
}

/** Where housemates pay. Set on the server (RECEIPT_IBAN / RECEIPT_NAME); older servers don't send it. */
export interface Payee {
  /** With the name: the payment QR code. Both are missing when only a bunq link is set up. */
  iban?: string;
  name?: string;
  /** bunq.me handle; when set the payment sheet offers a shareable payment link. */
  bunq?: string;
}

export interface ServerStatus {
  loggedIn: boolean;
  scanEnabled?: boolean;
  payee?: Payee | null;
}

let payee: Payee | null = null;

/** The account for the payment QR code, or null until the server has sent one. */
export function getPayee(): Payee | null {
  return payee;
}

/** Remembers the payee from the server, so the QR code also works offline. */
async function rememberPayee(status: ServerStatus) {
  if (!status.payee?.bunq && !(status.payee?.iban && status.payee.name)) return;
  payee = status.payee;
  try {
    await AsyncStorage.setItem(PAYEE_KEY, JSON.stringify(payee));
  } catch {}
}

/** Checks address + key against the server. Throws ApiError if it can't connect. */
export async function connect(cfg: ServerConfig): Promise<ServerStatus> {
  const normalized = { url: normalizeServerUrl(cfg.url), key: cfg.key.trim() };
  await request("/api/health", { cfg: normalized });
  const status = await request<ServerStatus>("/api/auth/status", { cfg: normalized });
  await saveServerConfig(normalized);
  await rememberPayee(status);
  return status;
}

export async function getAuthStatus(): Promise<ServerStatus> {
  const status = await request<ServerStatus>("/api/auth/status");
  await rememberPayee(status);
  return status;
}

// ── Receipts (proxied through the server) ──

export async function getReceipts(): Promise<{ receipts: Receipt[]; ahError: string; cachedAt: number }> {
  const res = await request<{ receipts: Receipt[]; ahError?: string; cachedAt?: number }>("/api/receipts");
  return { receipts: res.receipts, ahError: res.ahError ?? "", cachedAt: res.cachedAt ?? 0 };
}

export async function getReceipt(id: string): Promise<ReceiptDetail | null> {
  try {
    return await request<ReceiptDetail>(`/api/receipts/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Details of several receipts for an invoice; one that can't be loaded is null (the invoice then says "Product n"). */
export async function getReceiptDetails(ids: string[]): Promise<Record<string, ReceiptDetail | null>> {
  const details: Record<string, ReceiptDetail | null> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        details[id] = await getReceipt(id);
      } catch {
        details[id] = null;
      }
    })
  );
  return details;
}

// ── Receipt scanning (photo -> Gemini on the server) ──

export type ScanOutcome =
  | { kind: "saved"; receipt: Receipt; warnings: string[] }
  | { kind: "review"; scanId: string; receipt: Receipt; issues: string[]; message: string };

/** Sends a photo to the server. Amounts that don't add up come back as a "review" outcome. */
export async function scanReceipt(base64: string, mimeType: string): Promise<ScanOutcome> {
  try {
    const res = await request<{ receipt: Receipt; warnings: string[] }>("/api/scans", {
      method: "POST",
      body: { image: base64, mimeType },
      timeoutMs: SCAN_TIMEOUT_MS,
    });
    return { kind: "saved", receipt: res.receipt, warnings: res.warnings ?? [] };
  } catch (e) {
    if (e instanceof ApiError && e.code === "timeout") {
      // The server may still finish and keep it; then it shows up in the list after a refresh.
      throw new ApiError("timeout", 0, "Het lezen duurde te lang. Trek de lijst zo omlaag: staat het bonnetje er niet, scan dan opnieuw.");
    }
    if (e instanceof ApiError && e.code === "scan_needs_review") {
      return {
        kind: "review",
        scanId: e.body.scanId,
        receipt: e.body.receipt,
        issues: e.body.issues ?? [],
        message: e.userMessage,
      };
    }
    throw e;
  }
}

export async function acceptScan(scanId: string): Promise<Receipt> {
  const res = await request<{ receipt: Receipt }>(`/api/scans/${scanId}/accept`, { method: "POST" });
  return res.receipt;
}

export async function discardScan(scanId: string): Promise<void> {
  try {
    await request(`/api/scans/${scanId}`, { method: "DELETE" });
  } catch {}
}

/** Deletes a scanned receipt and its photo from the server for good. Already gone counts as deleted. */
export async function deleteScannedReceipt(receiptId: string): Promise<void> {
  try {
    await request(`/api/scans/${receiptId.replace(/^scan_/, "")}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
}

// ── Shared data (server is the source of truth, phone keeps a cache) ──

let dataVersion = 0;
/** True while the newest local change has not reached the server (we were offline). */
let dirty = false;
/** The newest data we hold, so a failed save can be retried without help from the screens. */
let latestData: AppData | null = null;
let saveChain: Promise<unknown> = Promise.resolve();
let onRemoteChange: ((data: AppData) => void) | null = null;
let onSaveRejected: ((error: ApiError) => void) | null = null;
/** The rejection the user was last told about, so a retry that fails the same way does not ask again. */
let reportedRejection = "";
/** Bumped by forgetServer(): a save that was still running for the old server must then change nothing. */
let epoch = 0;

/** True while the newest change has not reached the server yet, so switching servers would lose it. */
export function hasUnsentChanges(): boolean {
  return dirty;
}

/** Forgets the server: address, key, cached data and payee. The data itself stays on the server. */
export async function forgetServer(): Promise<void> {
  epoch++;
  config = null;
  payee = null;
  dirty = false;
  latestData = null;
  dataVersion = 0;
  reportedRejection = "";
  await SecureStore.deleteItemAsync(URL_KEY);
  await SecureStore.deleteItemAsync(APP_KEY_KEY);
  try {
    await AsyncStorage.multiRemove([CACHE_KEY, PAYEE_KEY]);
  } catch {}
}

/**
 * Called when a save loses a race and the server's copy replaces ours.
 * The change that lost is not applied, so the screen should say so.
 */
export function setConflictHandler(fn: ((data: AppData) => void) | null) {
  onRemoteChange = fn;
}

/**
 * Called when the server refuses a save for a reason a retry will not fix by itself (wrong key, too large, ...).
 * The change stays on the phone and is sent again later; the screen should say it is not on the server yet.
 */
export function setSaveRejectedHandler(fn: ((error: ApiError) => void) | null) {
  onSaveRejected = fn;
}

async function writeCache(data: AppData) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ version: dataVersion, data, dirty }));
  } catch {}
}

async function readCache(): Promise<{ version: number; data: AppData; dirty: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    return { version: cached.version ?? 0, data: cached.data, dirty: !!cached.dirty };
  } catch {
    return null;
  }
}

export type LoadResult = {
  data: AppData;
  offline: boolean;
  /** Changes made offline could not be kept because the server changed in the meantime. */
  discardedOffline?: boolean;
};

/** Loads from the server; falls back to the local cache when offline. */
export async function loadData(): Promise<LoadResult> {
  try {
    const res = await request<{ data: AppData; version: number }>("/api/data");
    const cached = await readCache();
    dataVersion = res.version;

    if (cached?.dirty) {
      if (cached.version === res.version) {
        // Nobody else saved since our offline edits: send them now.
        const local = normalizeData(cached.data);
        latestData = local;
        dirty = true;
        const sent = await sendData(local);
        if (sent.status !== "conflict") return { data: sent.data, offline: sent.status === "offline" };
        return { data: sent.data, offline: false, discardedOffline: true };
      }
      // The server moved on while we were offline: its copy wins, and the user is told.
      const data = normalizeData(res.data);
      dirty = false;
      latestData = data;
      await writeCache(data);
      return { data, offline: false, discardedOffline: true };
    }

    const data = normalizeData(res.data);
    dirty = false;
    latestData = data;
    await writeCache(data);
    return { data, offline: false };
  } catch (e) {
    if (!isNoAnswer(e)) throw e;
    const cached = await readCache();
    if (cached) {
      dataVersion = cached.version;
      dirty = cached.dirty;
      latestData = normalizeData(cached.data);
      return { data: latestData, offline: true };
    }
    throw e;
  }
}

type SendResult = { status: "saved" | "conflict" | "offline"; data: AppData };

/** One save attempt. Never throws: a lost race or a network failure is reported in the status. */
async function sendData(data: AppData): Promise<SendResult> {
  const mine = epoch;
  const stale = { status: "offline" as const, data }; // the server was switched meanwhile: touch nothing
  try {
    const res = await request<{ version: number }>("/api/data", {
      method: "PUT",
      body: { data, baseVersion: dataVersion },
    });
    if (mine !== epoch) return stale;
    dataVersion = res.version;
    dirty = false;
    reportedRejection = "";
    await writeCache(data);
    return { status: "saved", data };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      try {
        const latest = await request<{ data: AppData; version: number }>("/api/data");
        if (mine !== epoch) return stale;
        dataVersion = latest.version;
        dirty = false;
        const remote = normalizeData(latest.data);
        latestData = remote;
        await writeCache(remote);
        onRemoteChange?.(remote);
        return { status: "conflict", data: remote };
      } catch {}
    }
    // Offline (or the server failed): keep the change and try again later.
    if (mine !== epoch) return stale;
    dirty = true;
    await writeCache(data);
    // Offline, busy (429, 5xx) or a lost race fix themselves; anything else the user has to know about.
    const transient = isNoAnswer(e) || !(e instanceof ApiError) || e.status === 409 || e.status === 429 || e.status >= 500;
    if (!transient && e.code !== reportedRejection) {
      reportedRejection = e.code;
      onSaveRejected?.(e);
    }
    return { status: "offline", data };
  }
}

/** Saves are sent one at a time so version numbers stay in order. */
export function saveData(data: AppData): Promise<void> {
  latestData = data;
  const mine = epoch;
  const run = async () => {
    if (mine !== epoch) return;
    dirty = true; // until the server confirms; a crash mid-save must not lose the change
    await writeCache(data);
    await sendData(data);
  };
  saveChain = saveChain.then(run, run);
  return saveChain as Promise<void>;
}

/** Retries a save that failed while offline. Call when the app comes back to the foreground. */
export function flushPending(): Promise<void> {
  const run = async () => {
    if (dirty && latestData) await sendData(latestData);
  };
  saveChain = saveChain.then(run, run);
  return saveChain as Promise<void>;
}
