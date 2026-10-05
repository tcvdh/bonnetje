import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { personColor, PersonName } from "../constants";
import { colors, mono, radius } from "../theme";
import { orderPeople } from "../utils/people";
import { splitOf } from "../utils/settle";

interface Props {
  people: PersonName[];
  /** Parts per person to start from (an existing split). */
  initial?: Record<PersonName, number>;
  /** The product's quantity; with several items, a warning shows when the parts don't match it. */
  quantity?: number;
  onSplit: (split: PersonName[]) => void;
}

/**
 * Pick any number of people and how many parts each pays: tap a name to add or remove them, use
 * − and + for more parts (5 beers: 3 for Ik, 1 for Alice, 1 for Bob).
 */
export default function SplitPicker({ people, initial = {}, quantity = 1, onSplit }: Props) {
  const [counts, setCounts] = useState<Record<PersonName, number>>(initial);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chosen = Object.values(counts).filter((n) => n > 0).length;
  // Someone removed from the list but still in this split keeps a row, so they can be seen and taken out.
  const rows = orderPeople(new Set([...people, ...Object.keys(initial)]), people);
  // Parts are a ratio, so a mismatch still saves; it is only a hint (3 + 1 of 5 beers pays 75% / 25%).
  const mismatch = Number.isInteger(quantity) && quantity > 1 && total > 0 && total !== quantity;
  const set = (p: PersonName, n: number) => setCounts((c) => ({ ...c, [p]: Math.max(0, n) }));

  return (
    <View style={s.wrap}>
      {rows.map((p) => {
        const n = counts[p] ?? 0;
        const c = personColor(p);
        return (
          <View key={p} style={s.row}>
            <Pressable
              style={({ pressed }) => [s.name, n > 0 && { backgroundColor: c.bg }, pressed && s.pressed]}
              onPress={() => set(p, n > 0 ? 0 : 1)}
              accessibilityState={{ selected: n > 0 }}
            >
              <Text style={[s.nameText, { color: n > 0 ? c.fg : colors.sub }]}>{p}</Text>
              {n > 0 && <Text style={s.percent}>{Math.round((n / total) * 100)}%</Text>}
            </Pressable>
            <Pressable
              style={s.step}
              onPress={() => set(p, n - 1)}
              hitSlop={4}
              disabled={n === 0}
              accessibilityLabel={`Eén deel minder voor ${p}`}
            >
              <Text style={[s.stepText, n === 0 && s.off]}>−</Text>
            </Pressable>
            <Text style={s.count}>{n}</Text>
            <Pressable style={s.step} onPress={() => set(p, n + 1)} hitSlop={4} accessibilityLabel={`Eén deel meer voor ${p}`}>
              <Text style={s.stepText}>+</Text>
            </Pressable>
          </View>
        );
      })}
      {mismatch && (
        <Text style={s.warning}>
          {total < quantity
            ? `Nog niet alles verdeeld: ${total} van ${quantity} stuks`
            : `${total} delen, maar er zijn ${quantity} stuks`}
        </Text>
      )}
      <Pressable
        style={({ pressed }) => [s.confirm, chosen < 2 && s.confirmOff, pressed && s.pressed]}
        disabled={chosen < 2}
        onPress={() => onSplit(splitOf(counts))}
      >
        <Text style={[s.confirmText, chosen < 2 && s.confirmTextOff]}>{chosen < 2 ? "Kies minstens twee personen" : `Splitsen (${total} delen)`}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.line,
  },
  nameText: { fontSize: 14, fontWeight: "700" },
  percent: { color: colors.sub, fontFamily: mono, fontSize: 12 },
  pressed: { opacity: 0.6 },
  step: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.line, alignItems: "center", justifyContent: "center" },
  stepText: { color: colors.text, fontSize: 18, fontWeight: "700" },
  off: { color: colors.faint },
  count: { color: colors.text, fontFamily: mono, fontSize: 14, minWidth: 22, textAlign: "center" },
  confirm: { marginTop: 4, paddingVertical: 12, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: "center" },
  warning: { color: colors.bonus, fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 2 },
  confirmOff: { backgroundColor: colors.line },
  confirmText: { color: colors.accentInk, fontSize: 14, fontWeight: "700" },
  confirmTextOff: { color: colors.faint },
});
