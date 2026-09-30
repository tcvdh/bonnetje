import React from "react";
import { Text, Pressable, StyleSheet } from "react-native";
import { colors, radius } from "../theme";
import { CardDialog } from "./Sheet";

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Works on web too, unlike Alert.alert with buttons. */
export default function ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <CardDialog visible={visible} onClose={onCancel}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.message}>{message}</Text>
      <Pressable style={({ pressed }) => [s.danger, pressed && { opacity: 0.7 }]} onPress={onConfirm}>
        <Text style={s.dangerText}>{confirmLabel}</Text>
      </Pressable>
      <Pressable style={s.cancel} onPress={onCancel}>
        <Text style={s.cancelText}>Annuleren</Text>
      </Pressable>
    </CardDialog>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  message: { color: colors.sub, fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  danger: { backgroundColor: "rgba(255,131,120,0.14)", borderRadius: radius.md, padding: 15, alignItems: "center" },
  dangerText: { color: colors.bad, fontSize: 15, fontWeight: "700" },
  cancel: { paddingTop: 16, alignItems: "center" },
  cancelText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
});
