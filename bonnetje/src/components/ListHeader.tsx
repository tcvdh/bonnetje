import React from "react";
import { View, Text, Pressable, TouchableOpacity, StyleSheet } from "react-native";
import { PersonName } from "../constants";
import { colors, radius } from "../theme";
import PersonChip from "./PersonChip";

export type ListTab = "open" | "done";

/** A message strip above the list. Tap to dismiss when `onPress` is given. */
export function Banner({ text, onPress }: { text: string; onPress?: () => void }) {
  const body = <Text style={s.bannerText}>{text}</Text>;
  return onPress ? (
    <Pressable style={s.banner} onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    <View style={s.banner}>{body}</View>
  );
}

/** Explains why the receipts may be old or missing when Albert Heijn cannot be reached. */
export function AhBanner({ error, cachedAt }: { error: string; cachedAt: number }) {
  if (error === "") return null;
  const problem =
    error === "ah_not_logged_in"
      ? "Albert Heijn is niet verbonden. Log in via de beheerpagina van de server voor nieuwe bonnetjes."
      : "Albert Heijn is nu niet bereikbaar.";
  const effect =
    cachedAt > 0
      ? " Je ziet de laatst opgehaalde bonnetjes; alles wat je hebt verdeeld blijft bewaard."
      : " Gescande bonnetjes staan er wel.";
  return <Banner text={problem + effect} />;
}

interface LegendProps {
  people: PersonName[];
  onPerson: (person: PersonName) => void;
  onAdd: () => void;
}

/** Everyone who takes part, as chips. Tap one for its options, or + to add someone. */
export function PeopleLegend({ people, onPerson, onAdd }: LegendProps) {
  return (
    <View style={s.legend}>
      {people.map((p) => (
        <Pressable key={p} onPress={() => onPerson(p)} accessibilityLabel={`${p}: opties`}>
          <PersonChip name={p} />
        </Pressable>
      ))}
      <Pressable accessibilityLabel="Persoon toevoegen" style={s.addChip} onPress={onAdd}>
        <Text style={s.addChipText}>+</Text>
      </Pressable>
    </View>
  );
}

interface TabsProps {
  tab: ListTab;
  onChange: (tab: ListTab) => void;
  counts: Record<ListTab, number>;
}

const TAB_LABELS: Record<ListTab, string> = { open: "Open", done: "Afgerond" };

export function ReceiptTabs({ tab, onChange, counts }: TabsProps) {
  return (
    <View style={s.tabs}>
      {(["open", "done"] as const).map((t) => {
        const active = tab === t;
        return (
          <TouchableOpacity key={t} style={[s.tab, active && s.tabActive]} onPress={() => onChange(t)} activeOpacity={0.7}>
            <Text style={[s.tabText, active && s.tabTextActive]}>
              {TAB_LABELS[t]}
              <Text style={s.tabCount}>  {counts[t]}</Text>
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  banner: { backgroundColor: colors.bonusSoft, borderRadius: radius.md, padding: 14, marginBottom: 14 },
  bannerText: { color: colors.bonus, fontSize: 13, lineHeight: 19 },
  legend: { flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 16 },
  addChip: { paddingHorizontal: 12, paddingVertical: 3, borderRadius: 99, borderWidth: 1, borderColor: colors.dash, borderStyle: "dashed" },
  addChipText: { color: colors.sub, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  tabs: { flexDirection: "row", gap: 6, marginBottom: 14 },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99, backgroundColor: colors.surface },
  tabActive: { backgroundColor: colors.text },
  tabText: { color: colors.sub, fontSize: 14, fontWeight: "700" },
  tabTextActive: { color: colors.bg },
  tabCount: { fontWeight: "500", opacity: 0.6 },
});
