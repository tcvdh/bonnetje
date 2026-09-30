import React from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import { Invoice } from "../types";
import { personColor } from "../constants";
import { colors, mono, radius, eur } from "../theme";
import { activeTotal, formatPaidAt } from "../utils/invoice";
import { BottomSheet } from "./Sheet";

interface Props {
  visible: boolean;
  invoices: Invoice[];
  onOpen: (invoice: Invoice) => void;
  onClose: () => void;
}

export default function InvoicesSheet({ visible, invoices, onOpen, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} tone="bg" maxHeightRatio={0.85}>
      <Text style={s.title}>Afrekeningen</Text>
      <Text style={s.sub}>
        {invoices.length === 0
          ? "Zodra je iemand als betaald markeert, komt de afrekening hier te staan."
          : "Wat iedereen heeft betaald, nieuwste eerst."}
      </Text>
      <FlatList
        data={invoices}
        keyExtractor={(i) => i.id}
        style={{ flexGrow: 0 }}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]} onPress={() => onOpen(item)}>
            <View style={{ flex: 1 }}>
              <Text style={[s.person, { color: personColor(item.person).fg }]}>{item.person}</Text>
              <Text style={s.meta}>
                {item.number}, {formatPaidAt(item.paidAt)}
              </Text>
              {item.voidedAt ? (
                <Text style={s.voided}>Betaling ingetrokken</Text>
              ) : item.receipts.some((r) => r.voidedAt) ? (
                <Text style={s.voided}>Deels ingetrokken</Text>
              ) : null}
            </View>
            <Text style={[s.amount, item.voidedAt && s.amountVoided]}>{eur(item.voidedAt ? item.total : activeTotal(item))}</Text>
          </Pressable>
        )}
      />
      <Pressable style={s.close} onPress={onClose}>
        <Text style={s.closeText}>Sluiten</Text>
      </Pressable>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  sub: { color: colors.sub, fontSize: 14, lineHeight: 21, marginTop: 4, marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 8 },
  person: { fontSize: 16, fontWeight: "700" },
  meta: { color: colors.faint, fontSize: 12, marginTop: 2 },
  voided: { color: colors.bad, fontSize: 12, marginTop: 2 },
  amount: { color: colors.text, fontFamily: mono, fontSize: 16, fontWeight: "700" },
  amountVoided: { textDecorationLine: "line-through", opacity: 0.5 },
  close: { paddingTop: 12, alignItems: "center" },
  closeText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
});
