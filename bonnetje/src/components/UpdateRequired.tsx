import React from "react";
import { View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { RELEASES_URL } from "../constants";
import { colors, radius } from "../theme";

/**
 * Covers the whole app when a new major or minor version is out: that version may store the shared data
 * differently, so this one must not keep using it. Only the download button works.
 */
export default function UpdateRequired({ current, latest }: { current: string; latest: string }) {
  return (
    // Its own provider: it is drawn outside the navigator, which provides one for the screens only.
    <SafeAreaProvider style={s.cover}>
      <SafeAreaView edges={["top"]}>
        <View style={s.card}>
          <Text style={s.title}>Update nodig</Text>
          <Text style={s.text}>
            Versie {latest} is uit en werkt niet samen met deze versie ({current}). Installeer de nieuwe versie om de
            app weer te gebruiken; je gegevens staan op de server en blijven bewaard.
          </Text>
          <Pressable style={({ pressed }) => [s.button, pressed && { opacity: 0.7 }]} onPress={() => Linking.openURL(RELEASES_URL)}>
            <Text style={s.buttonText}>Nieuwe versie downloaden</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim, padding: 16 },
  card: { marginTop: 12, backgroundColor: colors.bad, borderRadius: radius.lg, padding: 18, gap: 10 },
  title: { color: colors.bg, fontSize: 20, fontWeight: "800" },
  text: { color: colors.bg, fontSize: 14, lineHeight: 20 },
  button: { marginTop: 4, backgroundColor: colors.bg, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: "700" },
});
