import { Platform } from "react-native";

// Thermal-printer look: near-black green "counter", receipt-style mono numerals.
export const colors = {
  bg: "#0D100F",
  surface: "#151917",
  raised: "#1D2220",
  line: "#262C29",
  dash: "#3A423E",
  text: "#E8EBE6",
  sub: "#9BA39E",
  faint: "#66706A",
  accent: "#5CC8FF",
  accentInk: "#04222F",
  accentSoft: "rgba(92,200,255,0.12)",
  good: "#7BE0A4",
  bad: "#FF8378",
  bonus: "#FFB35C",
  bonusSoft: "rgba(255,179,92,0.10)",
  scrim: "rgba(5,7,6,0.72)",
};

export const mono = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

export const radius = { sm: 8, md: 12, lg: 18 };

export { eur } from "./utils/money";
