import React, { useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet } from "react-native";
import { AppData, Receipt } from "../types";
import { colors, radius } from "../theme";
import ReceiptCard from "./ReceiptCard";
import { BottomSheet } from "./Sheet";
import ConfirmDialog from "./ConfirmDialog";
import { toggled } from "../utils/sets";
import { isScanned } from "../utils/receipts";

interface Props {
  visible: boolean;
  receipts: Receipt[];
  data: AppData;
  onRestore: (ids: string[]) => void;
  /** Deletes scanned receipts for good; resolves when done (also when some failed). */
  onDelete: (ids: string[]) => Promise<void>;
  onClose: () => void;
}

export default function HiddenSheet({ visible, receipts, data, onRestore, onDelete, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const hidden = receipts.filter((r) => data.hidden.includes(r.id));

  function close() {
    setSelected(new Set());
    onClose();
  }

  const toggle = (id: string) => setSelected((prev) => toggled(prev, id));

  function restore() {
    onRestore([...selected]);
    setSelected(new Set());
    if (selected.size >= hidden.length) onClose();
  }

  // Albert Heijn receipts come from Albert Heijn, so they can only be hidden; scanned ones can be deleted.
  const canDelete = selected.size > 0 && [...selected].every(isScanned);

  async function remove() {
    const ids = [...selected];
    setConfirming(false);
    await onDelete(ids);
    setSelected(new Set());
    if (ids.length >= hidden.length) onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={close} tone="bg" maxHeightRatio={0.85}>
      <Text style={s.title}>Verborgen bonnetjes</Text>
      <Text style={s.sub}>
        {hidden.length === 0
          ? "Je hebt geen verborgen bonnetjes."
          : "Kies welke bonnetjes je terug wilt zetten. Verdeling en betalingen blijven bewaard. Gescande bonnetjes kun je ook definitief verwijderen."}
      </Text>

      <FlatList
        data={hidden}
        keyExtractor={(r) => r.id}
        style={s.list}
        renderItem={({ item }) => (
          <ReceiptCard
            receipt={item}
            data={data}
            selectable
            selected={selected.has(item.id)}
            onPress={() => toggle(item.id)}
          />
        )}
      />

      {hidden.length > 0 && (
        <View style={s.actions}>
          <Pressable
            onPress={() =>
              setSelected(selected.size === hidden.length ? new Set() : new Set(hidden.map((r) => r.id)))
            }
            hitSlop={8}
          >
            <Text style={s.link}>{selected.size === hidden.length ? "Niets selecteren" : "Alles selecteren"}</Text>
          </Pressable>
          <Pressable
            disabled={selected.size === 0}
            style={({ pressed }) => [s.primary, selected.size === 0 && s.disabled, pressed && { opacity: 0.7 }]}
            onPress={restore}
          >
            <Text style={s.primaryText}>
              {selected.size > 0 ? `Terugzetten (${selected.size})` : "Terugzetten"}
            </Text>
          </Pressable>
        </View>
      )}

      {canDelete && (
        <Pressable style={({ pressed }) => [s.danger, pressed && { opacity: 0.7 }]} onPress={() => setConfirming(true)}>
          <Text style={s.dangerText}>{`Verwijderen (${selected.size})`}</Text>
        </Pressable>
      )}

      <ConfirmDialog
        visible={confirming}
        title={selected.size === 1 ? "Bonnetje verwijderen?" : `${selected.size} bonnetjes verwijderen?`}
        message="De foto, het gelezen bonnetje en de verdeling worden definitief van de server verwijderd. Afrekeningen die je al hebt gemaakt blijven staan. Dit kan niet ongedaan worden gemaakt."
        confirmLabel="Definitief verwijderen"
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />

      <Pressable style={s.closeRow} onPress={close}>
        <Text style={s.closeText}>Sluiten</Text>
      </Pressable>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  sub: { color: colors.sub, fontSize: 14, lineHeight: 21, marginTop: 4, marginBottom: 14 },
  list: { flexGrow: 0 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  link: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 20 },
  disabled: { opacity: 0.35 },
  primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  danger: { backgroundColor: "rgba(255,131,120,0.14)", borderRadius: radius.md, padding: 14, alignItems: "center", marginTop: 12 },
  dangerText: { color: colors.bad, fontSize: 15, fontWeight: "700" },
  closeRow: { paddingTop: 16, alignItems: "center" },
  closeText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
});
