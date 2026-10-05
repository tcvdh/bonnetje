import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { personColor, PersonName } from "../constants";
import { useAppData } from "../context";
import { colors, radius } from "../theme";
import { Assignment } from "../types";
import { splitCounts } from "../utils/settle";
import { BottomSheet } from "./Sheet";
import SplitPicker from "./SplitPicker";

interface Props {
  visible: boolean;
  productName: string;
  /** The item's current assignment, so an existing split opens as it is. */
  current?: Assignment;
  quantity?: number;
  onAssign: (person: PersonName) => void;
  onSplit: (people: PersonName[]) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function PersonPicker({ visible, productName, current, quantity, onAssign, onSplit, onClear, onClose }: Props) {
  const [showSplit, setShowSplit] = useState(false);
  const { data } = useAppData();

  function handleClose() {
    setShowSplit(false);
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose}>
      <Text style={s.caption}>Wie betaalt hiervoor?</Text>
      <Text style={s.title} numberOfLines={2}>{productName}</Text>

      <View style={s.grid}>
        {data.people.map((p) => (
          <Pressable
            key={p}
            style={({ pressed }) => [s.tile, { backgroundColor: personColor(p).bg }, pressed && s.pressed]}
            onPress={() => {
              onAssign(p);
              handleClose();
            }}
          >
            <Text style={[s.tileText, { color: personColor(p).fg }]}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={s.linkRow} onPress={() => setShowSplit(!showSplit)}>
        <Text style={s.linkText}>{showSplit ? "Splitsen verbergen" : "Splitsen tussen meerdere personen"}</Text>
      </Pressable>

      {showSplit && (
        <SplitPicker
          people={data.people}
          initial={current && "split" in current ? splitCounts(current.split) : {}}
          quantity={quantity}
          onSplit={(split) => {
            onSplit(split);
            handleClose();
          }}
        />
      )}

      <Pressable
        style={s.linkRow}
        onPress={() => {
          onClear();
          handleClose();
        }}
      >
        <Text style={[s.linkText, { color: colors.faint }]}>Toewijzing wissen</Text>
      </Pressable>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  caption: { color: colors.faint, fontSize: 13 },
  title: { color: colors.text, fontSize: 18, fontWeight: "600", marginTop: 2, marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "48.5%", paddingVertical: 20, borderRadius: radius.md, alignItems: "center" },
  tileText: { fontSize: 17, fontWeight: "700" },
  pressed: { opacity: 0.6 },
  linkRow: { paddingVertical: 14, alignItems: "center" },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
});
