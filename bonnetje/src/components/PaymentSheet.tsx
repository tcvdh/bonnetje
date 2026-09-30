import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { PersonName } from "../constants";
import { getAuthStatus, getPayee, Payee } from "../api";
import { colors, mono, radius, eur } from "../theme";
import Perforation from "./Perforation";
import { CardDialog } from "./Sheet";

interface Props {
  visible: boolean;
  person: PersonName | "";
  amount: number;
  /** Invoice number that Betaald will create, so the transfer description matches it. */
  invoiceNumber: string;
  /** Hands out the next unused number instead of the one locked in now. */
  onRefreshNumber: () => void;
  onPaid: () => void;
  onClose: () => void;
}

function buildEpcString(iban: string, name: string, amount: number, desc: string): string {
  return ["BCD", "002", "1", "SCT", "", name, iban, `EUR${amount.toFixed(2)}`, "", "", desc, ""].join("\n");
}

export default function PaymentSheet({ visible, person, amount, invoiceNumber, onRefreshNumber, onPaid, onClose }: Props) {
  const [payee, setPayee] = useState<Payee | null>(getPayee());

  // The server sends the account. If it hasn't yet (or the server is older), ask again when the sheet opens.
  useEffect(() => {
    if (!visible || getPayee()) return;
    getAuthStatus()
      .then(() => setPayee(getPayee()))
      .catch(() => {});
  }, [visible]);

  return (
    <CardDialog visible={visible} onClose={onClose} style={s.card}>
      <Text style={s.person}>{person} betaalt</Text>
      <Text style={s.amount}>{eur(amount)}</Text>

      {payee ? (
        <>
          <View style={s.qrContainer}>
            <QRCode
              value={buildEpcString(payee.iban, payee.name, amount, `Bonnetje Splitter ${invoiceNumber}`)}
              size={196}
              backgroundColor="#fff"
            />
          </View>

          <Text style={s.hint}>Scan met je bankapp</Text>
          <Text style={s.iban}>{payee.iban.replace(/(.{4})/g, "$1 ").trim()}</Text>
          <View style={s.descRow}>
            <Text style={s.desc}>Bonnetje Splitter {invoiceNumber}</Text>
            <Pressable
              accessibilityLabel="Nieuw nummer"
              hitSlop={10}
              style={({ pressed }) => [s.refresh, pressed && s.pressed]}
              onPress={onRefreshNumber}
            >
              <Text style={s.refreshText}>↻</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={s.missing}>
          <Text style={s.missingTitle}>Betaalgegevens ontbreken</Text>
          <Text style={s.missingText}>
            De server heeft geen rekeningnummer doorgegeven. Werk de server bij en stel RECEIPT_IBAN en RECEIPT_NAME in (zie de README van de server). Je kunt nu wel op Markeer als betaald tikken.
          </Text>
        </View>
      )}
      <Perforation style={{ alignSelf: "stretch", marginVertical: 16 }} />

      <View style={s.actions}>
        <Pressable style={({ pressed }) => [s.paidBtn, pressed && s.pressed]} onPress={onPaid}>
          <Text style={s.paidText}>Markeer als betaald</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [s.closeBtn, pressed && s.pressed]} onPress={onClose}>
          <Text style={s.closeText}>Sluiten</Text>
        </Pressable>
      </View>
    </CardDialog>
  );
}

const s = StyleSheet.create({
  card: { padding: 24, width: "90%", maxWidth: 400, alignItems: "center" },
  person: { color: colors.sub, fontSize: 15 },
  amount: { color: colors.text, fontFamily: mono, fontSize: 40, fontWeight: "700", marginVertical: 10, letterSpacing: -1 },
  missing: { backgroundColor: colors.bonusSoft, borderRadius: radius.md, padding: 14, marginVertical: 10, alignSelf: "stretch" },
  missingTitle: { color: colors.bonus, fontSize: 14, fontWeight: "700" },
  missingText: { color: colors.sub, fontSize: 13, lineHeight: 19, marginTop: 4 },
  qrContainer: { backgroundColor: "#fff", borderRadius: radius.md, padding: 14, marginVertical: 10 },
  hint: { color: colors.faint, fontSize: 12, marginTop: 4 },
  iban: { color: colors.sub, fontSize: 14, fontFamily: mono, marginTop: 6, letterSpacing: 0.5 },
  descRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  desc: { color: colors.faint, fontSize: 12 },
  refresh: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" },
  refreshText: { color: colors.sub, fontSize: 15, lineHeight: 18 },
  actions: { width: "100%", gap: 8 },
  pressed: { opacity: 0.7 },
  paidBtn: { backgroundColor: colors.accent, padding: 14, borderRadius: radius.md, alignItems: "center" },
  paidText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  closeBtn: { padding: 12, borderRadius: radius.md, alignItems: "center" },
  closeText: { color: colors.sub, fontSize: 15, fontWeight: "600" },
});
