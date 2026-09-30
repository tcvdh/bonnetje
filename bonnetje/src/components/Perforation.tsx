import React from "react";
import { View, StyleProp, ViewStyle } from "react-native";
import { colors } from "../theme";

interface Props {
  vertical?: boolean;
  dotted?: boolean;
  style?: StyleProp<ViewStyle>;
}

// Dashed/dotted rule that renders identically on iOS and Android
// (single-side dashed borders don't on Android, so clip a full border).
export default function Perforation({ vertical, dotted, style }: Props) {
  const borderStyle = dotted ? "dotted" : "dashed";
  return (
    <View
      style={[
        vertical
          ? { width: 1, alignSelf: "stretch", overflow: "hidden" }
          : { height: 1, overflow: "hidden" },
        style,
      ]}
    >
      <View
        style={
          vertical
            ? { position: "absolute", top: 0, bottom: 0, left: 0, width: 2, borderWidth: 1, borderStyle, borderColor: colors.dash }
            : { height: 2, borderWidth: 1, borderStyle, borderColor: colors.dash }
        }
      />
    </View>
  );
}
