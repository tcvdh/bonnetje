import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from "react-native";
import { colors, radius } from "../theme";

const CLOSE_DISTANCE = 90;
const CLOSE_VELOCITY = 0.8;
const noop = () => {};

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Colour of the sheet: "surface" by default, "bg" for sheets that hold cards of their own. */
  tone?: "surface" | "bg";
  /** Share of the screen height the sheet may take. */
  maxHeightRatio?: number;
  /** False while something is running that must not be interrupted: no backdrop tap, drag or back button. */
  dismissable?: boolean;
  children: React.ReactNode;
}

/**
 * The one bottom sheet of the app: a modal with a dimmed backdrop and a pill you can pull down to
 * dismiss. Put a `ConfirmDialog` inside `children` if the sheet needs one, so it opens on top of the sheet.
 */
export function BottomSheet({ visible, onClose, tone = "surface", maxHeightRatio = 0.92, dismissable = true, children }: BottomSheetProps) {
  const { height } = useWindowDimensions();
  const [y] = useState(() => new Animated.Value(0));
  const latest = useRef({ onClose, dismissable });

  useEffect(() => {
    latest.current = { onClose, dismissable };
  }, [onClose, dismissable]);

  // Back to the resting position only when the sheet opens again. Resetting right after a
  // dismiss would show the sheet for a moment while the modal is still animating away.
  useEffect(() => {
    if (visible) y.setValue(0);
  }, [visible, y]);

  // Created once; the callbacks only touch refs/animated values when a gesture happens.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.dismissable,
      onMoveShouldSetPanResponder: () => latest.current.dismissable,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) {
          Animated.timing(y, { toValue: 900, duration: 180, useNativeDriver: true }).start(() => {
            latest.current.onClose();
          });
        } else {
          Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  );

  const close = dismissable ? onClose : noop;
  const maxHeight = height * maxHeightRatio;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      {/* No Pressable around the content: on iOS a Pressable parent can keep a ScrollView inside from scrolling.
          The backdrop is a sibling behind the sheet instead. */}
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Sluiten" />
        <Animated.View style={{ transform: [{ translateY: y }], maxHeight, flexShrink: 1 }}>
          <View style={[s.sheet, tone === "bg" ? s.sheetBg : s.sheetSurface, { maxHeight }]}>
            <View {...pan.panHandlers} style={s.grab} accessibilityLabel="Sleep omlaag om te sluiten">
              <View style={s.pill} />
            </View>
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

interface CardDialogProps {
  visible: boolean;
  onClose: () => void;
  /** Overrides for the card, e.g. a different width. */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** A centred card on a dimmed backdrop: confirmations, small forms and the payment QR. */
export function CardDialog({ visible, onClose, style, children }: CardDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Lifts the card above the keyboard (the add-person dialog has a text field). */}
      <KeyboardAvoidingView style={s.fill} behavior="padding">
        <Pressable style={s.center} onPress={onClose}>
          <Pressable style={[s.card, style]} onPress={noop}>
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" },
  sheet: { flexShrink: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetSurface: { backgroundColor: colors.surface, padding: 20, paddingBottom: 36 },
  sheetBg: { backgroundColor: colors.bg, padding: 16, paddingBottom: 28 },
  // taller than the pill so it is easy to hit with a thumb
  grab: { alignItems: "center", paddingTop: 2, paddingBottom: 16, marginTop: -2 },
  pill: { width: 40, height: 4, backgroundColor: colors.dash, borderRadius: 2 },
  center: { flex: 1, backgroundColor: colors.scrim, justifyContent: "center", alignItems: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22, width: "88%", maxWidth: 380 },
});
