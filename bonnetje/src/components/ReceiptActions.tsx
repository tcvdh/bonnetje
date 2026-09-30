import React from "react";
import { Text, Pressable, StyleSheet, View } from "react-native";
import { colors, radius } from "../theme";

interface Props {
  isDone: boolean;
  onFinish: () => void;
  onReopen: () => void;
  onHide: () => void;
}

/** The two buttons under the receipt: finish (or reopen) and hide. */
export default function ReceiptActions({ isDone, onFinish, onReopen, onHide }: Props) {
  return (
    <View style={s.row}>
      {isDone ? (
        <Pressable style={({ pressed }) => [s.btn, s.secondary, pressed && s.pressed]} onPress={onReopen}>
          <Text style={s.secondaryText}>Heropenen</Text>
        </Pressable>
      ) : (
        <Pressable style={({ pressed }) => [s.btn, s.primary, pressed && s.pressed]} onPress={onFinish}>
          <Text style={s.primaryText}>Afronden</Text>
        </Pressable>
      )}
      <Pressable style={({ pressed }) => [s.btn, s.danger, pressed && s.pressed]} onPress={onHide}>
        <Text style={s.dangerText}>Verbergen</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginTop: 20, marginBottom: 32 },
  btn: { flex: 1, paddingVertical: 15, borderRadius: radius.md, alignItems: "center" },
  pressed: { opacity: 0.7 },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  secondary: { backgroundColor: colors.raised },
  secondaryText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  danger: { backgroundColor: "rgba(255,131,120,0.10)" },
  dangerText: { color: colors.bad, fontSize: 15, fontWeight: "700" },
});
