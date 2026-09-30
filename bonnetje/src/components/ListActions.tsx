import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors, radius } from "../theme";
import { ListTab } from "./ListHeader";

interface SelectBarProps {
  count: number;
  total: number;
  tab: ListTab;
  onToggleAll: () => void;
  onFinish: () => void;
  onHide: () => void;
}

/** Bar at the bottom while picking several receipts. */
export function SelectBar({ count, total, tab, onToggleAll, onFinish, onHide }: SelectBarProps) {
  const none = count === 0;
  return (
    <View style={s.bar}>
      <Pressable hitSlop={8} onPress={onToggleAll}>
        <Text style={s.link}>{count === total && total > 0 ? "Niets" : "Alles"}</Text>
      </Pressable>
      <View style={s.actions}>
        {tab === "open" && (
          <Pressable
            disabled={none}
            style={({ pressed }) => [s.finishBtn, none && s.disabled, pressed && s.pressed]}
            onPress={onFinish}
          >
            <Text style={s.finishText}>{none ? "Afronden" : `Afronden (${count})`}</Text>
          </Pressable>
        )}
        <Pressable disabled={none} style={({ pressed }) => [s.hideBtn, none && s.disabled, pressed && s.pressed]} onPress={onHide}>
          <Text style={s.hideText}>{none ? "Verberg" : `Verberg (${count})`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Round "+" button that adds a receipt. */
export function AddFab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityLabel="Bonnetje toevoegen" style={({ pressed }) => [s.fab, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <Text style={s.fabText}>+</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.dash,
    borderRadius: radius.lg,
    padding: 12,
    paddingLeft: 18,
  },
  link: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8 },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  finishBtn: { backgroundColor: "rgba(120,220,160,0.14)", borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 18 },
  finishText: { color: colors.good, fontSize: 15, fontWeight: "700" },
  hideBtn: { backgroundColor: "rgba(255,131,120,0.14)", borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 20 },
  hideText: { color: colors.bad, fontSize: 15, fontWeight: "700" },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 28,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: colors.accentInk, fontSize: 32, fontWeight: "400", marginTop: -3 },
});
