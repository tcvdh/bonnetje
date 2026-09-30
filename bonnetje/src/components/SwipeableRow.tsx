import React, { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, Text, View, StyleSheet, ViewStyle } from "react-native";

export interface SwipeAction {
  label: string;
  glyph: string;
  background: string;
  color: string;
  onPress: () => void;
}

interface Props {
  actions: SwipeAction[];
  /** Whether this row is the open one. The parent closes others by passing false. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

// react-native-web understands userSelect; the RN types don't list it. On web a text selection cancels a swipe.
const noSelect = { userSelect: "none" } as unknown as ViewStyle;

const SIZE = 54;
const GAP = 10;

/** Swipe left to reveal round action buttons, like the iOS Mail app. */
export default function SwipeableRow({ actions, open, onOpenChange, disabled, children }: Props) {
  const width = actions.length * (SIZE + GAP) + 6;
  const [x] = useState(() => new Animated.Value(0));
  // Latest props for the gesture callbacks, which are created once.
  const latest = useRef({ open, onOpenChange, width });
  const startX = useRef(0);

  useEffect(() => {
    latest.current = { open, onOpenChange, width };
    Animated.spring(x, { toValue: open ? -width : 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  }, [open, onOpenChange, width, x]);

  // The responder is created once; its callbacks only read `latest` when a gesture happens.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    const snap = (toOpen: boolean) =>
      Animated.spring(x, { toValue: toOpen ? -latest.current.width : 0, useNativeDriver: true, bounciness: 0 }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        x.stopAnimation((v) => (startX.current = v));
      },
      onPanResponderMove: (_, g) => {
        const w = latest.current.width;
        x.setValue(Math.max(-w - 24, Math.min(0, startX.current + g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        const { open: wasOpen, onOpenChange: notify, width: w } = latest.current;
        const end = startX.current + g.dx;
        const toOpen = g.vx < -0.3 || (g.vx < 0.3 && end < -w / 2);
        if (toOpen === wasOpen) snap(toOpen); // parent state won't change, so animate back here
        notify(toOpen);
      },
      onPanResponderTerminate: () => snap(latest.current.open),
    });
  });

  if (disabled) return <>{children}</>;

  return (
    <View style={s.wrap}>
      <Animated.View
        style={[s.actions, { width, opacity: x.interpolate({ inputRange: [-24, 0], outputRange: [1, 0], extrapolate: "clamp" }) }]}
        pointerEvents={open ? "auto" : "none"}
      >
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityLabel={a.label}
            style={({ pressed }) => [s.circle, { backgroundColor: a.background }, pressed && { opacity: 0.7 }]}
            onPress={() => {
              onOpenChange(false);
              a.onPress();
            }}
          >
            <Text style={[s.glyph, { color: a.color }]}>{a.glyph}</Text>
          </Pressable>
        ))}
      </Animated.View>
      <Animated.View style={[noSelect, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
        {children}
        {open && <Pressable style={StyleSheet.absoluteFill} onPress={() => onOpenChange(false)} accessibilityLabel="Sluiten" />}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {}, // the card itself carries the bottom margin
  actions: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 10, // same as the card margin, so the circles centre on the card
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: GAP,
    paddingRight: 4,
  },
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: "center", justifyContent: "center" },
  glyph: { fontSize: 24, fontWeight: "800", marginTop: -1 },
});
