import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Share, Platform, StyleSheet, useWindowDimensions } from "react-native";
import { Invoice } from "../types";
import { personColor } from "../constants";
import { colors, mono, radius, eur } from "../theme";
import { activeTotal, formatPaidAt, formatReceiptDate, invoiceText, shareLabel } from "../utils/invoice";
import Perforation from "./Perforation";
import { BottomSheet } from "./Sheet";
import ConfirmDialog from "./ConfirmDialog";

/** Room the pill, padding and the three buttons under the invoice need. */
const SHEET_CHROME = 260;

interface Props {
  invoice: Invoice | null;
  onClose: () => void;
  /** Removes the invoice record. Payments stay as they are. */
  onDelete: (invoice: Invoice) => void;
}

export default function InvoiceSheet({ invoice, onClose, onDelete }: Props) {
  const { height } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function share() {
    if (!invoice) return;
    const message = invoiceText(invoice);
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        await Share.share({ message });
      }
    } catch {}
  }

  return (
    <BottomSheet visible={!!invoice} onClose={onClose} tone="bg">
      {invoice && (
        <>
          {/* Explicit cap: the buttons below take ~250px, the paper scrolls in what is left. */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flexGrow: 0, maxHeight: Math.max(160, height * 0.92 - SHEET_CHROME) }}
            contentContainerStyle={{ flexGrow: 0 }}
            nestedScrollEnabled
          >
            <View style={s.paper}>
              <Text style={s.kicker}>Afrekening {invoice.number}</Text>
              <Text style={[s.person, { color: personColor(invoice.person).fg }]}>{invoice.person}</Text>
              <Text style={invoice.voidedAt ? s.voided : s.paidAt}>
                {invoice.voidedAt
                  ? `Betaling ingetrokken op ${formatPaidAt(invoice.voidedAt)}`
                  : `Betaald op ${formatPaidAt(invoice.paidAt)}`}
              </Text>

              {invoice.receipts.map((r) => (
                <View key={r.receiptId} style={s.receipt}>
                  <Perforation style={{ marginBottom: 14 }} />
                  <Text style={s.store}>{r.store}</Text>
                  <Text style={s.date}>{formatReceiptDate(r.dateTime)}</Text>
                  {r.voidedAt && <Text style={s.voidedReceipt}>Betaling ingetrokken op {formatPaidAt(r.voidedAt)}</Text>}
                  {r.lines.map((l, i) => (
                    <View key={i} style={[s.line, r.voidedAt && s.lineVoided]}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.lineName}>
                          {l.emoji ? `${l.emoji} ` : ""}
                          {l.quantity !== 1 ? `${l.quantity}× ` : ""}
                          {l.name}
                        </Text>
                        {l.share < 1 && (
                          <Text style={s.lineShare}>
                            {shareLabel(l)}
                            {shareLabel(l).endsWith("%") ? " van dit product" : ""}
                          </Text>
                        )}
                      </View>
                      <Text style={s.lineAmount}>{eur(l.amount)}</Text>
                    </View>
                  ))}
                  {invoice.receipts.length > 1 && (
                    <View style={s.subtotal}>
                      <Text style={s.subtotalLabel}>Subtotaal</Text>
                      <Text style={s.subtotalAmount}>{eur(r.subtotal)}</Text>
                    </View>
                  )}
                </View>
              ))}

              <Perforation style={{ marginVertical: 16 }} />
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Totaal</Text>
                <Text style={s.totalAmount}>{eur(activeTotal(invoice))}</Text>
              </View>
            </View>
          </ScrollView>

          <Pressable style={({ pressed }) => [s.primary, pressed && { opacity: 0.7 }]} onPress={share}>
            <Text style={s.primaryText}>
              {Platform.OS === "web" ? (copied ? "Gekopieerd" : "Kopieer als tekst") : "Delen"}
            </Text>
          </Pressable>
          <Pressable style={s.close} onPress={onClose}>
            <Text style={s.closeText}>Sluiten</Text>
          </Pressable>
          <Pressable style={s.delete} onPress={() => setConfirmDelete(true)}>
            <Text style={s.deleteText}>Afrekening verwijderen</Text>
          </Pressable>
        </>
      )}
      <ConfirmDialog
        visible={confirmDelete}
        title="Afrekening verwijderen?"
        message="Alleen deze afrekening verdwijnt uit de lijst. Wie als betaald staat gemarkeerd, blijft betaald. Dit kan niet ongedaan worden gemaakt."
        confirmLabel="Verwijderen"
        onConfirm={() => {
          setConfirmDelete(false);
          if (invoice) setTimeout(() => onDelete(invoice), 0);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  paper: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20 },
  kicker: { color: colors.sub, fontSize: 13 },
  person: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5, marginTop: 2 },
  paidAt: { color: colors.good, fontSize: 14, marginTop: 4, marginBottom: 18 },
  voided: { color: colors.bad, fontSize: 14, marginTop: 4, marginBottom: 18 },
  receipt: { marginBottom: 6 },
  store: { color: colors.text, fontSize: 16, fontWeight: "700" },
  date: { color: colors.faint, fontSize: 13, marginTop: 1, marginBottom: 10 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 6 },
  voidedReceipt: { color: colors.bad, fontSize: 12, marginBottom: 8, marginTop: -6 },
  lineVoided: { opacity: 0.4 },
  lineName: { color: colors.text, fontSize: 15, lineHeight: 20 },
  lineShare: { color: colors.faint, fontSize: 12, marginTop: 1 },
  lineAmount: { color: colors.text, fontFamily: mono, fontSize: 14, fontWeight: "600", marginTop: 1 },
  subtotal: { flexDirection: "row", justifyContent: "space-between", paddingTop: 8, marginBottom: 10 },
  subtotalLabel: { color: colors.sub, fontSize: 13 },
  subtotalAmount: { color: colors.sub, fontFamily: mono, fontSize: 13, fontWeight: "600" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  totalLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  totalAmount: { color: colors.text, fontFamily: mono, fontSize: 28, fontWeight: "700", letterSpacing: -1 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: "center", marginTop: 14 },
  primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  close: { paddingTop: 14, alignItems: "center" },
  delete: { paddingTop: 18, alignItems: "center" },
  deleteText: { color: colors.bad, fontSize: 14, fontWeight: "600" },
  closeText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
});
