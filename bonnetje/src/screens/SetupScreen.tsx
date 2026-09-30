import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { colors, mono, radius } from "../theme";
import Perforation from "../components/Perforation";
import { connect, describeError } from "../api";

interface Props {
  onConnected: () => void;
}

export default function SetupScreen({ onConnected }: Props) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function connectToServer() {
    if (!url.trim() || !key.trim()) {
      setError("Vul het serveradres en de sleutel in.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await connect({ url, key });
      onConnected();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    // Padding for the keyboard on both platforms (Android is edge-to-edge and does not resize the window itself),
    // and a ScrollView so the fields stay reachable on a small screen with the keyboard open.
    <KeyboardAvoidingView style={s.root} behavior="padding">
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Bonnetje{"\n"}Splitter</Text>
        <Perforation style={{ marginVertical: 18 }} />
        <Text style={s.subtitle}>
          Verbind met je Bonnetje-server. Je bonnetjes en verdeling staan daar, dus ze blijven bewaard als je de app opnieuw installeert.
        </Text>

        <Text style={s.label}>Serveradres</Text>
        <TextInput
          style={[s.input, s.field]}
          value={url}
          onChangeText={setUrl}
          placeholder="bonnetje.example.com"
          placeholderTextColor={colors.faint}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={s.label}>Sleutel</Text>
        <TextInput
          style={[s.input, s.field]}
          value={key}
          onChangeText={setKey}
          placeholder="RECEIPT_APP_KEY"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <TouchableOpacity style={[s.btn, loading && { opacity: 0.6 }]} onPress={connectToServer} disabled={loading} activeOpacity={0.8}>
          {loading ? <ActivityIndicator color={colors.accentInk} /> : <Text style={s.btnText}>Verbinden</Text>}
        </TouchableOpacity>

        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: "center", padding: 32 },
  title: { color: colors.text, fontSize: 44, fontWeight: "800", letterSpacing: -1.5, lineHeight: 46 },
  subtitle: { color: colors.sub, fontSize: 15, lineHeight: 22, marginBottom: 32 },
  label: { color: colors.sub, fontSize: 13, marginBottom: 8 },
  field: { marginBottom: 16 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    color: colors.text,
    fontSize: 16,
    fontFamily: mono,
  },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: 16, alignItems: "center" },
  btnText: { color: colors.accentInk, fontSize: 16, fontWeight: "700" },
  error: { color: colors.bad, marginTop: 16, fontSize: 14, lineHeight: 21 },
});
