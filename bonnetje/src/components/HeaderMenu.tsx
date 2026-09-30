import React from "react";
import { View, Text, Pressable, Modal, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";

// react-navigation web headers have no right padding of their own
export const headerButtonStyle = Platform.OS === "web" ? { marginRight: 16 } : undefined;

export function HamburgerIcon() {
  return (
    <View style={{ gap: 4, padding: 6 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: colors.text }} />
      ))}
    </View>
  );
}

export interface MenuItem {
  label: string;
  /** Small count shown at the right, e.g. number of hidden receipts. */
  badge?: number;
  /** Shown in red, for things that cut a connection or remove something. */
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  items: MenuItem[];
  onClose: () => void;
}

/** Dropdown anchored under the top-right header button. */
export default function HeaderMenu({ visible, items, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <View style={[s.menu, { top: insets.top + 52 }]}>
          {items.map((item, i) => (
            <Pressable
              key={item.label}
              style={({ pressed }) => [s.item, i > 0 && s.itemBorder, pressed && { backgroundColor: colors.line }]}
              onPress={() => {
                onClose();
                item.onPress();
              }}
            >
              <Text style={[s.label, item.destructive && s.labelDestructive]}>{item.label}</Text>
              {item.badge !== undefined && item.badge > 0 && <Text style={s.badge}>{item.badge}</Text>}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  menu: {
    position: "absolute",
    right: 12,
    minWidth: 190,
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dash,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingHorizontal: 16, paddingVertical: 14 },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { color: colors.text, fontSize: 15, fontWeight: "600" },
  labelDestructive: { color: colors.bad },
  badge: { color: colors.sub, fontSize: 13, fontWeight: "700" },
});
