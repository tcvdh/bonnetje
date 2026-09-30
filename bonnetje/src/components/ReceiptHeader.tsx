import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Receipt } from "../types";
import { colors, mono, radius, eur } from "../theme";
import Perforation from "./Perforation";

interface Props {
  receipt?: Receipt;
  productCount: number;
  assignedCount: number;
  isDone: boolean;
  /** Whether "Meerdere kiezen" is on. */
  batchActive: boolean;
  onToggleBatch: () => void;
}

/** Top of the receipt page: scanner warnings, then the paper strip with store, total, date and progress. */
export default function ReceiptHeader({ receipt, productCount, assignedCount, isDone, batchActive, onToggleBatch }: Props) {
  const warnings = receipt?.warnings ?? [];
  const date = receipt ? new Date(receipt.dateTime) : new Date();
  const sourceLabel = (receipt?.source || "ah") === "ah" ? "🔗 Albert Heijn" : `📸 ${receipt?.storeName || "Scan"}`;

  return (
    <View>
      {warnings.length > 0 && (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>Controleer dit bonnetje</Text>
          {warnings.map((w, i) => (
            <Text key={i} style={s.noticeText}>{w}</Text>
          ))}
        </View>
      )}
      <View style={s.strip}>
        <View style={s.top}>
          <Text style={s.source}>{sourceLabel}</Text>
          <Text style={s.total}>{eur(receipt?.totalAmount.amount ?? 0)}</Text>
          <Text style={s.date}>
            {date.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </Text>
          {isDone && <Text style={s.done}>Afgerond</Text>}
        </View>
        <Perforation style={s.rule} />
        <View style={s.progress}>
          <Text style={s.progressText}>
            {assignedCount} van {productCount} verdeeld
          </Text>
          <Pressable hitSlop={8} style={[s.batchToggle, batchActive && s.batchToggleOn]} onPress={onToggleBatch}>
            <Text style={[s.batchToggleText, batchActive && { color: colors.accent }]}>
              {batchActive ? "Klaar" : "Meerdere kiezen"}
            </Text>
          </Pressable>
        </View>
        <Perforation style={s.rule} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  notice: { backgroundColor: colors.bonusSoft, borderRadius: radius.md, padding: 14, marginBottom: 12, gap: 4 },
  noticeTitle: { color: colors.bonus, fontSize: 14, fontWeight: "700" },
  noticeText: { color: colors.sub, fontSize: 13, lineHeight: 19 },
  strip: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  top: { alignItems: "center", paddingTop: 26, paddingBottom: 22, paddingHorizontal: 16 },
  source: { color: colors.sub, fontSize: 14, fontWeight: "600" },
  total: { color: colors.text, fontFamily: mono, fontSize: 44, fontWeight: "700", letterSpacing: -1.5, marginVertical: 6 },
  date: { color: colors.faint, fontSize: 13 },
  done: { color: colors.good, fontSize: 13, fontWeight: "600", marginTop: 8 },
  rule: { marginHorizontal: 16 },
  progress: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  progressText: { fontSize: 13, color: colors.sub },
  batchToggle: { borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.raised },
  batchToggleOn: { backgroundColor: colors.accentSoft },
  batchToggleText: { color: colors.sub, fontSize: 12, fontWeight: "700" },
});
