import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Product } from "../types";
import { colors, mono, radius, eur } from "../theme";
import { BottomSheet } from "./Sheet";

interface Props {
  /** Name of the discount being linked; the sheet is closed when this is null. */
  discountName: string | null;
  products: Product[];
  selection: Set<number>;
  onToggle: (index: number) => void;
  /** Saves the selection. An empty selection unlinks the discount. */
  onSave: () => void;
  onClose: () => void;
}

/** Pick the products a discount applies to. */
export default function DiscountLinkSheet({ discountName, products, selection, onToggle, onSave, onClose }: Props) {
  return (
    <BottomSheet visible={!!discountName} onClose={onClose}>
      <Text style={s.title}>
        Op welke producten geldt <Text style={{ color: colors.good }}>{discountName}</Text>?
      </Text>
      <Text style={s.hint}>Kies één of meer producten. De korting wordt verdeeld naar prijs.</Text>
      <ScrollView style={{ maxHeight: 340 }}>
        {products.map((p, i) => {
          const on = selection.has(i);
          return (
            <Pressable key={i} style={({ pressed }) => [s.product, pressed && { opacity: 0.6 }]} onPress={() => onToggle(i)}>
              <View style={[s.check, on && s.checkOn]}>{on && <Text style={s.checkMark}>✓</Text>}</View>
              <Text style={s.name} numberOfLines={2}>{p.name}</Text>
              <Text style={s.amount}>{eur(p.amount.amount)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable style={({ pressed }) => [s.save, pressed && { opacity: 0.7 }]} onPress={onSave}>
        <Text style={s.saveText}>
          {selection.size === 0
            ? "Ontkoppelen"
            : `Koppelen aan ${selection.size} ${selection.size === 1 ? "product" : "producten"}`}
        </Text>
      </Pressable>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { color: colors.sub, fontSize: 14, textAlign: "center", marginBottom: 14 },
  hint: { color: colors.faint, fontSize: 13, textAlign: "center", marginTop: -6, marginBottom: 12 },
  product: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.faint, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.accentInk, fontSize: 13, fontWeight: "800", marginTop: -1 },
  name: { flex: 1, color: colors.text, fontSize: 15 },
  amount: { color: colors.sub, fontFamily: mono, fontSize: 14 },
  save: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: "center", marginTop: 14 },
  saveText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
});
