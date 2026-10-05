import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import appJson from "../../app.json";
import { RELEASES_URL } from "../constants";
import { updateLevel, UpdateLevel } from "../utils/version";

export const APP_VERSION: string = appJson.expo.version;

export interface UpdateInfo {
  level: UpdateLevel;
  latest: string;
}

/** The newest released version, or null when it cannot be fetched (offline, no file yet). */
async function fetchLatest(): Promise<string | null> {
  try {
    // The query string gets past any cache between here and GitHub Pages.
    const res = await fetch(`${RELEASES_URL}version.txt?t=${Date.now()}`);
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

/** Looks for a newer release on start, whenever the app comes back to the front, and on `check()`. */
export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo>({ level: "none", latest: APP_VERSION });

  const check = useCallback(() => {
    fetchLatest().then((latest) => {
      if (latest) setUpdate({ level: updateLevel(APP_VERSION, latest), latest });
    });
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  return { update, check };
}
