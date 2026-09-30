import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ME, personColor, PersonName } from "../constants";
import { Product, Discount, AppData } from "../types";
import { netCents, receiptCents, sumCents, unlinkedCents } from "../utils/settle";
import { orderPeople } from "../utils/people";
import { colors, mono, radius, eur } from "../theme";
import Perforation from "./Perforation";
import { CardDialog } from "./Sheet";

interface Props {
  receiptId: string;
  products: Product[];
  discountMap: Record<number, number>;
  unmatchedDiscounts: Discount[];
  data: AppData;
  /** Mark a person as paid (true) or undo it (false) for this receipt. */
  onSetPaid?: (person: PersonName, paid: boolean) => void;
}

export default function TallySection({
  receiptId,
  products,
  discountMap,
  unmatchedDiscounts,
  data,
  onSetPaid,
}: Props) {
  const [sheetPerson, setSheetPerson] = useState<PersonName | null>(null);
  const receiptPaid = data.paid[receiptId] || {};

  // Cents per person from the stored, settled amounts: the same numbers the balance and invoices use.
  const assigned = Object.fromEntries(
    Object.entries(data.assignments[receiptId] || {}).filter(([i]) => products[Number(i)])
  );
  const totals = receiptCents(assigned);
  const assignedCents = sumCents(Object.values(totals));
  const receiptCentsTotal = sumCents(products.map((p, i) => netCents(p, discountMap[i] || 0))) + unlinkedCents(unmatchedDiscounts);
  const unassigned = receiptCentsTotal - assignedCents;

  const people = orderPeople(Object.keys(totals), data.people).filter((p) => totals[p] !== 0);

  return (
    <View style={s.tally}>
      <Text style={s.header}>Verdeling van dit bonnetje</Text>
      {people.length === 0 && (
        <Text style={s.empty}>Tik op een product om het aan iemand toe te wijzen.</Text>
      )}
      {people.some((p) => p !== ME) && onSetPaid && (
        <Text style={s.hint}>Tik op een naam om een betaling aan te passen.</Text>
      )}
      {people.map((p) => {
        const paid = !!receiptPaid[p];
        const canEdit = !!onSetPaid && p !== ME;
        return (
          <Pressable
            style={({ pressed }) => [s.row, canEdit && pressed && s.rowPressed]}
            key={p}
            disabled={!canEdit}
            onPress={() => setSheetPerson(p)}
            accessibilityLabel={canEdit ? `${p}: betaling aanpassen` : undefined}
          >
            <View style={[s.dot, { backgroundColor: personColor(p).fg }]} />
            <Text style={[s.name, paid && s.paidText]}>{p}</Text>
            <Perforation dotted style={s.leader} />
            {paid && <Text style={s.paidTag}>betaald</Text>}
            <Text style={[s.amount, { color: personColor(p).fg }, paid && s.paidText]}>{eur(totals[p] / 100)}</Text>
          </Pressable>
        );
      })}
      {unassigned > 0 && (
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: colors.dash }]} />
          <Text style={s.unassignedText}>Nog niet verdeeld</Text>
          <Perforation dotted style={s.leader} />
          <Text style={[s.amount, { color: colors.faint }]}>{eur(unassigned / 100)}</Text>
        </View>
      )}

      <CardDialog visible={!!sheetPerson} onClose={() => setSheetPerson(null)}>
        {sheetPerson && (
          <>
            <Text style={s.cardTitle}>{sheetPerson}, {eur((totals[sheetPerson] || 0) / 100)}</Text>
            <Text style={s.cardBody}>
              {receiptPaid[sheetPerson]
                ? "Dit bedrag staat als betaald. Zet het terug als het per ongeluk is aangevinkt."
                : "Dit bedrag staat nog open."}
            </Text>
            {receiptPaid[sheetPerson] ? (
              <Pressable
                style={({ pressed }) => [s.danger, pressed && { opacity: 0.7 }]}
                onPress={() => {
                  onSetPaid?.(sheetPerson, false);
                  setSheetPerson(null);
                }}
              >
                <Text style={s.dangerText}>Betaling ongedaan maken</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [s.primary, pressed && { opacity: 0.7 }]}
                onPress={() => {
                  onSetPaid?.(sheetPerson, true);
                  setSheetPerson(null);
                }}
              >
                <Text style={s.primaryText}>Markeer als betaald</Text>
              </Pressable>
            )}
            <Pressable style={s.close} onPress={() => setSheetPerson(null)}>
              <Text style={s.closeText}>Sluiten</Text>
            </Pressable>
          </>
        )}
      </CardDialog>
    </View>
  );
}

const s = StyleSheet.create({
  hint: { color: colors.faint, fontSize: 12, marginBottom: 4 },
  rowPressed: { opacity: 0.6 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  cardBody: { color: colors.sub, fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  danger: { backgroundColor: "rgba(255,131,120,0.14)", borderRadius: radius.md, padding: 15, alignItems: "center" },
  dangerText: { color: colors.bad, fontSize: 15, fontWeight: "700" },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: "center" },
  primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  close: { paddingTop: 16, alignItems: "center" },
  closeText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
  tally: { marginTop: 20, padding: 18, backgroundColor: colors.surface, borderRadius: radius.lg },
  header: { fontSize: 13, color: colors.sub, marginBottom: 8 },
  empty: { color: colors.faint, fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  leader: { flex: 1, marginHorizontal: 8, marginTop: 8 },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  amount: { fontFamily: mono, fontSize: 16, fontWeight: "700" },
  paidTag: { color: colors.good, fontSize: 11, fontWeight: "700", marginRight: 8 },
  paidText: { textDecorationLine: "line-through", opacity: 0.5 },
  unassignedText: { color: colors.faint, fontSize: 15 },
});
