import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Discount, Product } from "../types";
import { LinkedDiscount } from "../utils/discounts";
import { colors, mono, radius, eur } from "../theme";

/** Orange banner at the top of the receipt while some discounts are not linked to a product. */
export function UnlinkedBanner({ count, onPress }: { count: number; onPress: () => void }) {
  if (count === 0) return null;
  return (
    <Pressable style={({ pressed }) => [s.banner, pressed && { opacity: 0.7 }]} onPress={onPress} accessibilityLabel="Korting koppelen">
      <View style={s.badge}>
        <Text style={s.badgeText}>!</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.bannerTitle}>
          {count === 1 ? "1 korting is nog niet gekoppeld" : `${count} kortingen zijn nog niet gekoppeld`}
        </Text>
        <Text style={s.bannerText}>Tik om te koppelen. Anders wordt de korting verdeeld over iedereen die meebetaalt.</Text>
      </View>
    </Pressable>
  );
}

interface Props {
  unmatched: Discount[];
  linked: LinkedDiscount[];
  products: Product[];
  /** Opens the link sheet for a discount, with the products it is linked to now. */
  onOpen: (discountName: string, linked?: number[]) => void;
}

/** The lists under the products: discounts still to link, and those already linked. */
export function DiscountSections({ unmatched, linked, products, onOpen }: Props) {
  return (
    <>
      {unmatched.length > 0 && (
        <View style={s.section}>
          <Text style={s.todoTitle}>Nog te koppelen</Text>
          {unmatched.map((disc, i) => (
            <Pressable key={i} style={({ pressed }) => [s.todo, pressed && { opacity: 0.6 }]} onPress={() => onOpen(disc.name)}>
              <View style={s.badge}>
                <Text style={s.badgeText}>!</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.todoName} numberOfLines={1}>{disc.name}</Text>
                <Text style={s.sub}>Tik om aan een product te koppelen</Text>
              </View>
              <Text style={s.todoAmount}>−{eur(Math.abs(disc.amount.amount))}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {linked.length > 0 && (
        <View style={s.section}>
          <Text style={s.title}>Gekoppeld</Text>
          {linked.map(({ discount, indices }) => (
            <Pressable key={discount.name} style={({ pressed }) => [s.done, pressed && { opacity: 0.6 }]} onPress={() => onOpen(discount.name, indices)}>
              <View style={s.doneBadge}>
                <Text style={s.doneBadgeText}>✓</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.doneName} numberOfLines={1}>{discount.name}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {indices.map((i) => products[i]?.name).join(", ")}
                </Text>
              </View>
              <Text style={s.doneAmount}>−{eur(Math.abs(discount.amount.amount))}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,179,92,0.14)",
    borderWidth: 1.5,
    borderColor: colors.bonus,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
  },
  bannerTitle: { color: colors.bonus, fontSize: 15, fontWeight: "700" },
  bannerText: { color: colors.sub, fontSize: 13, lineHeight: 19, marginTop: 2 },
  badge: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.bonus, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#3A2100", fontSize: 15, fontWeight: "900", marginTop: -1 },
  section: { marginTop: 20 },
  title: { fontSize: 13, color: colors.sub },
  todoTitle: { fontSize: 13, color: colors.bonus, fontWeight: "700", marginVertical: 8 },
  todo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginTop: 6,
    borderRadius: radius.md,
    backgroundColor: colors.bonusSoft,
    borderWidth: 1.5,
    borderColor: colors.bonus,
    borderStyle: "dashed",
  },
  todoName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  todoAmount: { color: colors.bonus, fontFamily: mono, fontSize: 15, fontWeight: "700" },
  done: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginTop: 6,
    borderRadius: radius.md,
    backgroundColor: "rgba(123,224,164,0.08)",
    opacity: 0.85,
  },
  doneBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(123,224,164,0.2)", alignItems: "center", justifyContent: "center" },
  doneBadgeText: { color: colors.good, fontSize: 14, fontWeight: "900" },
  doneName: { flex: 1, color: colors.sub, fontSize: 14 },
  doneAmount: { color: colors.good, fontFamily: mono, fontSize: 14, fontWeight: "700" },
  sub: { color: colors.faint, fontSize: 12, marginTop: 2 },
});
