import React, { useState } from "react";
import { Text, TextInput, Pressable, StyleSheet } from "react-native";
import { AppData } from "../types";
import { personColor } from "../constants";
import { MAX_NAME_LENGTH, nameError, removeBlocker } from "../utils/people";
import { colors, radius } from "../theme";
import { CardDialog } from "./Sheet";

interface AddProps {
  visible: boolean;
  people: string[];
  onAdd: (name: string) => void;
  onClose: () => void;
}

/** Adds a person by name, e.g. a friend on holiday. */
export function AddPersonSheet({ visible, people, onAdd, onClose }: AddProps) {
  // The form only exists while open, so it starts empty every time.
  if (!visible) return null;
  return <AddPersonForm people={people} onAdd={onAdd} onClose={onClose} />;
}

function AddPersonForm({ people, onAdd, onClose }: Omit<AddProps, "visible">) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  const error = nameError(name, people);

  function submit() {
    setTouched(true);
    if (!error) onAdd(name.trim());
  }

  return (
    <CardDialog visible onClose={onClose}>
      <Text style={s.title}>Persoon toevoegen</Text>
      <TextInput
        style={s.input}
        value={name}
        onChangeText={(t) => {
          setName(t);
          setTouched(true);
        }}
        placeholder="Naam"
        placeholderTextColor={colors.faint}
        autoFocus
        maxLength={MAX_NAME_LENGTH + 5}
        returnKeyType="done"
        onSubmitEditing={submit}
        accessibilityLabel="Naam"
      />
      {touched && error !== "" && name !== "" && <Text style={s.error}>{error}</Text>}
      <Pressable
        style={({ pressed }) => [s.primary, !!error && s.disabled, pressed && { opacity: 0.7 }]}
        onPress={submit}
        disabled={!!error}
      >
        <Text style={s.primaryText}>Toevoegen</Text>
      </Pressable>
      <Pressable style={s.close} onPress={onClose}>
        <Text style={s.closeText}>Annuleren</Text>
      </Pressable>
    </CardDialog>
  );
}

interface PersonProps {
  name: string | null;
  data: AppData;
  onRemove: (name: string) => void;
  onClose: () => void;
}

/** Options for one person; removing is refused while they still owe something. */
export function PersonSheet({ name, data, onRemove, onClose }: PersonProps) {
  if (!name) return null;
  const shown = name;
  const blocker = removeBlocker(shown, data);

  return (
    <CardDialog visible onClose={onClose}>
      <Text style={[s.title, { color: personColor(shown).fg }]}>{shown}</Text>
      <Text style={s.body}>
        {blocker ||
          "Verwijderen haalt de naam van dit scherm. Al afgeronde bonnetjes en afrekeningen houden de naam. Je kunt hem later opnieuw toevoegen."}
      </Text>
      {!blocker && (
        <Pressable style={({ pressed }) => [s.danger, pressed && { opacity: 0.7 }]} onPress={() => onRemove(shown)}>
          <Text style={s.dangerText}>Verwijderen</Text>
        </Pressable>
      )}
      <Pressable style={s.close} onPress={onClose}>
        <Text style={s.closeText}>Sluiten</Text>
      </Pressable>
    </CardDialog>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  body: { color: colors.sub, fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  input: {
    backgroundColor: colors.raised,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    marginTop: 14,
    marginBottom: 12,
  },
  error: { color: colors.bad, fontSize: 13, marginBottom: 12 },
  primary: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 15, alignItems: "center" },
  primaryText: { color: colors.accentInk, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.35 },
  danger: { backgroundColor: "rgba(255,131,120,0.14)", borderRadius: radius.md, padding: 15, alignItems: "center" },
  dangerText: { color: colors.bad, fontSize: 15, fontWeight: "700" },
  close: { paddingTop: 16, alignItems: "center" },
  closeText: { color: colors.faint, fontSize: 14, fontWeight: "600" },
});
