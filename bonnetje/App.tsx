import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "./src/theme";
import { AppContext, DataUpdate, emptyData } from "./src/context";
import { AppData, Receipt } from "./src/types";
import { RootStackParamList } from "./src/navigation";
import { flushPending, forgetServer, getAuthStatus, loadData, loadServerConfig, saveData, setConflictHandler } from "./src/api";
import SetupScreen from "./src/screens/SetupScreen";
import ReceiptListScreen from "./src/screens/ReceiptListScreen";
import ReceiptDetailScreen from "./src/screens/ReceiptDetailScreen";
import UpdateRequired from "./src/components/UpdateRequired";
import { APP_VERSION, useUpdateCheck } from "./src/hooks/useUpdateCheck";

const Stack = createNativeStackNavigator<RootStackParamList>();

const LOST_CHANGE = {
  title: "Wijziging niet opgeslagen",
  message: "Iemand anders was je voor: de server had nieuwere gegevens. Die zie je nu, en je laatste wijziging is niet bewaard. Doe hem opnieuw als dat nodig is.",
};
const LOST_OFFLINE = {
  title: "Offline wijzigingen kwijt",
  message: "Terwijl je offline was, zijn de gegevens op de server veranderd. Je ziet nu de versie van de server; wat je offline deed is niet bewaard.",
};

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AppData>(emptyData);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  // Always the newest data, so an update function never starts from a stale render.
  const dataRef = useRef<AppData>(emptyData);
  const { update, check: checkForUpdate } = useUpdateCheck();

  const applyData = useCallback((next: AppData) => {
    dataRef.current = next;
    setData(next);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (await loadServerConfig()) {
          const { data: saved, discardedOffline } = await loadData();
          applyData(saved);
          if (discardedOffline) Alert.alert(LOST_OFFLINE.title, LOST_OFFLINE.message);
          // Signed in to the server; AH login state is shown by the list screen.
          try { await getAuthStatus(); } catch {}
          setAuthed(true);
        }
      } catch {}
      setLoading(false);
    })();
    setConflictHandler((remote) => {
      applyData(remote);
      Alert.alert(LOST_CHANGE.title, LOST_CHANGE.message);
    });
    return () => setConflictHandler(null);
  }, [applyData]);

  // A save that failed while offline is tried again when the app comes back.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") flushPending();
    });
    return () => sub.remove();
  }, []);

  async function handleConnected() {
    try {
      const { data: saved } = await loadData();
      applyData(saved);
    } catch {}
    setAuthed(true);
  }

  const persistData = useCallback(
    (update: DataUpdate) => {
      const next = typeof update === "function" ? update(dataRef.current) : update;
      if (next === dataRef.current) return; // an updater that changed nothing is not a save
      applyData(next);
      saveData(next);
    },
    [applyData]
  );

  const disconnect = useCallback(async () => {
    await forgetServer();
    applyData(emptyData);
    setReceipts([]);
    setAuthed(false);
  }, [applyData]);

  const context = useMemo(
    () => ({ data, persistData, receipts, setReceipts, disconnect, update, checkForUpdate }),
    [data, persistData, receipts, disconnect, update, checkForUpdate]
  );

  if (loading) return null;

  // Drawn last, over everything, so nothing below it can be tapped.
  const blocker = update.level === "required" && <UpdateRequired current={APP_VERSION} latest={update.latest} />;

  if (!authed) {
    return (
      <>
        <StatusBar style="light" />
        <SetupScreen onConnected={handleConnected} />
        {blocker}
      </>
    );
  }

  return (
    <AppContext.Provider value={context}>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen
            name="List"
            component={ReceiptListScreen}
            options={{ title: "Bonnetjes" }}
          />
          <Stack.Screen
            name="Detail"
            component={ReceiptDetailScreen}
            options={{ title: "", headerBackTitle: "Terug" }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      {blocker}
    </AppContext.Provider>
  );
}
