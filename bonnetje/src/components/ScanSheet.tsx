import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { acceptScan, describeError, discardScan, scanReceipt } from "../api";
import { Receipt } from "../types";
import { prepareImage } from "../utils/image";
import { colors, eur, radius } from "../theme";
import { BottomSheet } from "./Sheet";

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanned: (receipt: Receipt) => void;
}

type Phase =
  | { name: "menu" }
  | { name: "busy" }
  | { name: "error"; message: string }
  | { name: "review"; scanId: string; receipt: Receipt; issues: string[] };

export default function ScanSheet({ visible, onClose, onScanned }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "menu" });

  function close() {
    if (phase.name === "review") discardScan(phase.scanId);
    setPhase({ name: "menu" });
    onClose();
  }

  async function pick(source: "camera" | "library") {
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setPhase({ name: "error", message: "Geen toegang tot de camera. Geef toestemming in de instellingen, of kies een foto uit je galerij." });
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.length) return;

      const asset = res.assets[0];
      setPhase({ name: "busy" });
      const { base64, mimeType } = await prepareImage(asset.uri, asset.width, asset.height);
      const outcome = await scanReceipt(base64, mimeType);
      if (outcome.kind === "saved") {
        setPhase({ name: "menu" });
        onScanned(outcome.receipt);
      } else {
        setPhase({ name: "review", scanId: outcome.scanId, receipt: outcome.receipt, issues: outcome.issues });
      }
    } catch (e) {
      setPhase({ name: "error", message: describeError(e) });
    }
  }

  async function keepAnyway() {
    if (phase.name !== "review") return;
    setPhase({ name: "busy" });
    try {
      const receipt = await acceptScan(phase.scanId);
      setPhase({ name: "menu" });
      onScanned(receipt);
    } catch (e) {
      setPhase({ name: "error", message: describeError(e) });
    }
  }

  function retry() {
    if (phase.name === "review") discardScan(phase.scanId);
    setPhase({ name: "menu" });
  }

  return (
    <BottomSheet visible={visible} onClose={close} dismissable={phase.name !== "busy"}>
      {phase.name === "menu" && (
        <>
          <Text style={s.title}>Bonnetje toevoegen</Text>
          <Text style={s.body}>Werkt met elke winkel. Zorg dat het hele bonnetje in beeld is en goed leesbaar.</Text>
          <Pressable style={({ pressed }) => [s.option, pressed && s.pressed]} onPress={() => pick("camera")}>
            <Text style={s.optionTitle}>Foto maken</Text>
            <Text style={s.optionSub}>Open de camera</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [s.option, pressed && s.pressed]} onPress={() => pick("library")}>
            <Text style={s.optionTitle}>Kies uit galerij</Text>
            <Text style={s.optionSub}>Upload een bestaande foto</Text>
          </Pressable>
          <Pressable style={s.link} onPress={close}>
            <Text style={s.linkText}>Annuleren</Text>
          </Pressable>
        </>
      )}

      {phase.name === "busy" && (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={s.title}>Bonnetje lezen…</Text>
          <Text style={s.body}>Dit duurt een paar seconden.</Text>
        </View>
      )}

      {phase.name === "error" && (
        <>
          <Text style={s.title}>Dat lukte niet</Text>
          <Text style={s.body}>{phase.message}</Text>
          <Pressable style={({ pressed }) => [s.primary, pressed && s.pressed]} onPress={() => setPhase({ name: "menu" })}>
            <Text style={s.primaryText}>Opnieuw proberen</Text>
          </Pressable>
          <Pressable style={s.link} onPress={close}>
            <Text style={s.linkText}>Sluiten</Text>
          </Pressable>
        </>
      )}

      {phase.name === "review" && (
        <>
          <Text style={s.title}>De bedragen kloppen niet</Text>
          <Text style={s.body}>
            {phase.receipt.storeName}, totaal {eur(phase.receipt.totalAmount.amount)}
          </Text>
          {phase.issues.map((issue, i) => (
            <Text key={i} style={s.issue}>{issue}</Text>
          ))}
          <Text style={s.body}>Scan opnieuw met een scherpere foto, of bewaar het bonnetje en controleer de producten zelf.</Text>
          <Pressable style={({ pressed }) => [s.primary, pressed && s.pressed]} onPress={retry}>
            <Text style={s.primaryText}>Opnieuw scannen</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [s.secondary, pressed && s.pressed]} onPress={keepAnyway}>
            <Text style={s.secondaryText}>Toch bewaren</Text>
          </Pressable>
          <Pressable style={s.link} onPress={close}>
            <Text style={s.linkText}>Weggooien</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  center: { alignItems: "center", paddingVertical: 24, gap: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 6 },
  body: { color: colors.sub, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  issue: { color: colors.bonus, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  option: { backgroundColor: colors.raised, borderRadius: radius.md, padding: 16, marginBottom: 8 },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  optionSub: { color: colors.faint, fontSize: 13, marginTop: 2 },
  pressed: { opacity: 0.7 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: "center", marginTop: 4 },
  primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  secondary: { backgroundColor: colors.raised, borderRadius: radius.md, padding: 15, alignItems: "center", marginTop: 8 },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  link: { paddingVertical: 14, alignItems: "center" },
  linkText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
});
