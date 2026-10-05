import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { personColor } from "../constants";
import { Product, Assignment } from "../types";
import { colors, mono, eur } from "../theme";
import { splitCounts } from "../utils/settle";
import PersonChip from "./PersonChip";
import Perforation from "./Perforation";

interface Props {
  product: Product;
  index: number;
  assignment?: Assignment;
  discount: number;
  isPaid: boolean;
  selected: boolean;
  onPress: () => void;
}

export default function ProductItem({ product, assignment, discount, isPaid, selected, onPress }: Props) {
  const deposit = product.deposit ? product.deposit.amount : 0;
  const originalPrice = product.amount.amount + deposit;
  const actualPrice = originalPrice + discount;
  const hasDiscount = discount < -0.005;

  const parts = assignment ? splitCounts("person" in assignment ? [assignment.person] : assignment.split) : {};
  const owners = Object.keys(parts);
  const barColor = owners.length ? personColor(owners[0]).fg : "transparent";

  return (
    <View style={s.wrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [s.row, selected && s.selected, pressed && s.pressed, isPaid && s.paid]}
      >
        <View style={[s.bar, { backgroundColor: selected ? colors.accent : barColor }]} />
        <Text style={s.qty}>{product.quantity}×</Text>
        <View style={s.main}>
          <Text style={[s.name, isPaid && s.struck]} numberOfLines={2}>
            {product.emoji ? `${product.emoji} ` : ""}{product.name}
          </Text>
          {(owners.length > 0 || hasDiscount) && (
            <View style={s.meta}>
              {owners.map((p) => (
                <PersonChip key={p} name={p} count={parts[p]} small />
              ))}
              {hasDiscount && <Text style={s.bonusTag}>Bonus</Text>}
            </View>
          )}
        </View>
        <View style={s.priceCol}>
          {hasDiscount ? (
            <>
              <Text style={s.priceOriginal}>{eur(originalPrice)}</Text>
              <Text style={s.priceBonus}>{eur(actualPrice)}</Text>
            </>
          ) : (
            <Text style={s.price}>{eur(originalPrice)}</Text>
          )}
        </View>
      </Pressable>
      <Perforation style={s.rule} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 13, paddingRight: 16, paddingLeft: 16, gap: 10 },
  rule: { marginHorizontal: 16 },
  selected: { backgroundColor: colors.accentSoft },
  pressed: { backgroundColor: colors.raised },
  paid: { opacity: 0.45 },
  bar: { position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  qty: { color: colors.faint, fontFamily: mono, fontSize: 12, minWidth: 26 },
  main: { flex: 1 },
  name: { color: colors.text, fontSize: 15, lineHeight: 20 },
  struck: { textDecorationLine: "line-through", color: colors.sub },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 5 },
  bonusTag: { color: colors.bonus, fontSize: 11, fontWeight: "700" },
  priceCol: { alignItems: "flex-end", minWidth: 64 },
  price: { color: colors.text, fontFamily: mono, fontSize: 14, fontWeight: "600" },
  priceOriginal: { color: colors.faint, fontFamily: mono, fontSize: 11, textDecorationLine: "line-through" },
  priceBonus: { color: colors.bonus, fontFamily: mono, fontSize: 14, fontWeight: "700" },
});
