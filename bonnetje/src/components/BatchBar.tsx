import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { personColor, PersonName } from "../constants";
import { useAppData } from "../context";
import { colors, radius } from "../theme";
import SplitPicker from "./SplitPicker";

interface Props {
  count: number;
  onAssign: (person: PersonName) => void;
  onSplit: (people: PersonName[]) => void;
  onClear: () => void;
  onCancel: () => void;
}

export default function BatchBar({ count, onAssign, onSplit, onClear, onCancel }: Props) {
  const [showSplit, setShowSplit] = useState(false);
  const { data } = useAppData();
  if (count === 0) return null;

  return (
    <View style={s.bar}>
      <Text style={s.info}>
        {count} {count > 1 ? "producten" : "product"} geselecteerd
      </Text>
      <View style={s.buttons}>
        {data.people.map((p) => (
          <Pressable
            key={p}
            style={({ pressed }) => [s.btn, { backgroundColor: personColor(p).bg }, pressed && s.pressed]}
            onPress={() => onAssign(p)}
          >
            <Text style={[s.btnText, { color: personColor(p).fg }]}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={s.splitToggle} onPress={() => setShowSplit(!showSplit)} hitSlop={6}>
        <Text style={s.splitToggleText}>{showSplit ? "Splitsen verbergen" : "Splitsen tussen meerdere personen"}</Text>
      </Pressable>
      {showSplit && (
        <View style={s.split}>
          <SplitPicker people={data.people} onSplit={onSplit} />
        </View>
      )}
      <View style={s.secondary}>
        <Pressable onPress={onClear} hitSlop={8}>
          <Text style={s.secondaryText}>Toewijzing wissen</Text>
        </Pressable>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text style={s.secondaryText}>Annuleren</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 24,
    left: 12,
    right: 12,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.dash,
    borderRadius: radius.lg,
    padding: 14,
  },
  info: { textAlign: "center", color: colors.sub, fontSize: 13, marginBottom: 10 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  btn: { flexGrow: 1, minWidth: 64, paddingVertical: 12, borderRadius: radius.sm, alignItems: "center" },
  pressed: { opacity: 0.6 },
  btnText: { fontSize: 14, fontWeight: "700" },
  splitToggle: { alignItems: "center", paddingTop: 12 },
  splitToggleText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  split: { marginTop: 10 },
  secondary: { flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 4 },
  secondaryText: { color: colors.faint, fontSize: 13, fontWeight: "600" },
});
