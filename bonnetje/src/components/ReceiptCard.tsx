import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Receipt, AppData } from "../types";
import { colors, mono, radius, eur } from "../theme";
import Perforation from "./Perforation";
import { receiptBalance } from "../utils/balance";

interface Props {
  receipt: Receipt;
  data: AppData;
  onPress: () => void;
  /** Present while selecting: shows a check circle and highlights when selected. */
  selectable?: boolean;
  selected?: boolean;
}

const STUB = 66;

export default function ReceiptCard({ receipt, data, onPress, selectable, selected }: Props) {
  const d = new Date(receipt.dateTime);
  const day = d.getDate();
  const month = d.toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
  const weekday = d.toLocaleDateString("nl-NL", { weekday: "short" }).replace(".", "");
  const isDone = data.completed.includes(receipt.id);
  const source = receipt.source || "ah";
  const sourceLabel = source === "ah" ? "Albert Heijn" : receipt.storeName || "Scan";
  const sourceBadge = source === "ah" ? "🔗 Online" : "📸 Gescand";
  const total = receipt.totalAmount.amount;
  const balance = receiptBalance(receipt.id, data);
  const itemCount = Object.keys(data.assignments[receipt.id] || {}).length;

  let status = "";
  let statusColor: string = colors.faint;
  if (isDone) { status = "Afgerond"; statusColor = colors.good; }
  else if (balance.owed > 0 && balance.open === 0) { status = "Betaald"; statusColor = colors.good; }
  else if (balance.open > 0) { status = `${eur(balance.open)} open`; statusColor = colors.bad; }
  else if (itemCount > 0) status = `${itemCount} verdeeld`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityState={selectable ? { selected: !!selected } : undefined}
      style={({ pressed }) => [s.card, selected && s.cardSelected, pressed && s.pressed]}
    >
      <View style={[s.content, isDone && s.contentDone]}>
      <View style={s.stub}>
        {selectable ? (
          <View style={[s.check, selected && s.checkOn]}>
            {selected && <Text selectable={false} style={s.checkMark}>✓</Text>}
          </View>
        ) : (
          <Text selectable={false} style={s.weekday}>{weekday}</Text>
        )}
        <Text selectable={false} style={s.day}>{day}</Text>
        <Text selectable={false} style={s.month}>{month}</Text>
      </View>
      <Perforation vertical />
      <View style={s.body}>
        <View style={{ flex: 1 }}>
          <Text selectable={false} style={s.source} numberOfLines={1}>{sourceLabel}</Text>
          <Text selectable={false} style={s.badge}>{sourceBadge}</Text>
        </View>
        <View style={s.right}>
          <Text selectable={false} style={s.total}>{eur(total)}</Text>
          {status !== "" && <Text selectable={false} style={[s.status, { color: statusColor }]}>{status}</Text>}
        </View>
      </View>
      </View>
      <View style={[s.notch, s.notchTop]} />
      <View style={[s.notch, s.notchBottom]} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: 10,
    overflow: "hidden",
    minHeight: 72,
  },
  // dim only the content: a see-through card would show the swipe buttons behind it
  content: { flex: 1, flexDirection: "row", alignItems: "stretch" },
  contentDone: { opacity: 0.55 },
  cardSelected: { backgroundColor: colors.accentSoft },
  pressed: { backgroundColor: colors.raised },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginBottom: 1,
    borderWidth: 1.5,
    borderColor: colors.faint,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.accentInk, fontSize: 12, fontWeight: "800", marginTop: -1 },
  stub: { width: STUB, alignItems: "center", justifyContent: "center" },
  day: { color: colors.text, fontFamily: mono, fontSize: 26, fontWeight: "700", lineHeight: 30 },
  month: { color: colors.sub, fontSize: 12, marginTop: 1 },
  body: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  source: { color: colors.text, fontSize: 15, fontWeight: "600" },
  weekday: { color: colors.faint, fontSize: 12, marginBottom: 1 },
  badge: { color: colors.sub, fontSize: 12, marginTop: 3 },
  right: { alignItems: "flex-end" },
  total: { color: colors.text, fontFamily: mono, fontSize: 17, fontWeight: "700" },
  status: { fontSize: 12, marginTop: 3 },
  notch: { position: "absolute", left: STUB - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.bg },
  notchTop: { top: -7 },
  notchBottom: { bottom: -7 },
});
