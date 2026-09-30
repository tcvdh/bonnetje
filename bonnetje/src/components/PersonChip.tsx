import React from "react";
import { Text, View } from "react-native";
import { personColor, PersonName } from "../constants";

export default function PersonChip({ name, small }: { name: PersonName; small?: boolean }) {
  const c = personColor(name);
  return (
    <View
      style={{
        backgroundColor: c.bg,
        paddingHorizontal: small ? 8 : 12,
        paddingVertical: small ? 2 : 5,
        borderRadius: 99,
      }}
    >
      <Text style={{ color: c.fg, fontSize: small ? 11 : 13, fontWeight: "700" }}>{name}</Text>
    </View>
  );
}
