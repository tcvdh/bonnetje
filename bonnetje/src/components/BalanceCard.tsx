import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { personColor, PersonName } from "../constants";
import { AppData } from "../types";
import { orderPeople } from "../utils/people";
import { owedByPerson } from "../utils/balance";
import { colors, mono, radius, eur } from "../theme";
import Perforation from "./Perforation";

interface Props {
  data: AppData;
  onPayPress: (person: PersonName, amount: number) => void;
  onPaidPress: (person: PersonName) => void;
}

export default function BalanceCard({ data, onPayPress, onPaidPress }: Props) {
  const owed = owedByPerson(data); // cents, the same amounts the invoices are made from
  const others = orderPeople(Object.keys(owed), data.people).filter((p) => owed[p] > 0);
  const grandTotal = others.reduce((sum, p) => sum + owed[p], 0);
  if (grandTotal <= 0) return null;

  return (
    <View style={s.card}>
      <Text style={s.label}>Nog te ontvangen</Text>
      <Text style={s.grand}>{eur(grandTotal / 100)}</Text>
      <Perforation style={{ marginVertical: 14 }} />
      {others.map((p) => (
        <View style={s.row} key={p}>
          <View style={[s.dot, { backgroundColor: personColor(p).fg }]} />
          <Text style={s.name}>{p}</Text>
          <Perforation dotted style={s.leader} />
          <Text style={[s.amount, { color: personColor(p).fg }]}>{eur(owed[p] / 100)}</Text>
          <Pressable
            accessibilityLabel={`Betaalgegevens voor ${p}`}
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            onPress={() => onPayPress(p, owed[p] / 100)}
          >
            <Text style={s.btnText}>💶</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`${p} heeft betaald`}
            style={({ pressed }) => [s.btn, s.btnPrimary, pressed && s.btnPressed]}
            onPress={() => onPaidPress(p)}
          >
            <Text style={[s.btnText, s.btnPrimaryText]}>Betaald</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, marginBottom: 20 },
  label: { color: colors.sub, fontSize: 13 },
  grand: { color: colors.text, fontFamily: mono, fontSize: 38, fontWeight: "700", marginTop: 4, letterSpacing: -1 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  leader: { flex: 1, marginHorizontal: 8, marginTop: 8 },
  amount: { fontFamily: mono, fontSize: 15, fontWeight: "700", marginRight: 10 },
  btn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 99, backgroundColor: colors.raised, marginLeft: 4 },
  btnPrimary: { backgroundColor: colors.accentSoft },
  btnPressed: { opacity: 0.6 },
  btnText: { color: colors.sub, fontSize: 12, fontWeight: "700" },
  btnPrimaryText: { color: colors.accent },
});
