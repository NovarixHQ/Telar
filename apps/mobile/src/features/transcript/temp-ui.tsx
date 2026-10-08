import { Host, Image } from "@expo/ui/swift-ui";
import { font } from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { AccessibilityInfo, DynamicColorIOS, StyleSheet, View, type ColorValue } from "react-native";

export type SFSymbol = NonNullable<ComponentProps<typeof Image>["systemName"]>;

// Temporary: replaced by apps/mobile/src/ui once the design foundation lands. Values from apps/ios UI/Theme.swift.
const hex = (value: number) => `#${value.toString(16).padStart(6, "0")}`;
const adaptive = (light: number, dark: number): ColorValue => DynamicColorIOS({ light: hex(light), dark: hex(dark) });

export const Theme = {
  canvas: adaptive(0xfcfcfc, 0x0a0a0a),
  card: adaptive(0xffffff, 0x161616),
  messageSurface: adaptive(0xf1f1f3, 0x252525),
  codeBackground: adaptive(0xf4f4f5, 0x252525),
  subtle: adaptive(0xf1f1f3, 0x252525),
  text: adaptive(0x27272a, 0xf5f5f5),
  textMuted: adaptive(0x696973, 0xa1a1a1),
  accent: adaptive(0x2f58b9, 0x6594fa),
  amber: adaptive(0x8e5b01, 0xf2a635),
  sky: adaptive(0x007386, 0x22bedc),
  red: adaptive(0xb71822, 0xff645e),
  emerald: adaptive(0x02744e, 0x2ac48a),
  border: DynamicColorIOS({ light: "#E4E4E7", dark: "rgba(255,255,255,0.10)" }),
  borderSubtle: DynamicColorIOS({ light: "rgba(228,228,231,0.6)", dark: "rgba(255,255,255,0.06)" }),
  radiusRow: 8,
  radiusBubble: 18,
};

/** Dynamic Type base sizes at the default content size. */
export const TextSize = { body: 17, subheadline: 15, footnote: 13, caption: 12, caption2: 11 };
export const MONO = "ui-monospace";

type SymbolProps = { name: SFSymbol; size: number; color: ColorValue; weight?: "regular" | "medium" | "semibold" };

export function Symbol({ name, size, color, weight = "regular" }: SymbolProps) {
  return (
    <Host matchContents>
      <Image systemName={name} color={color} modifiers={[font({ size, weight })]} />
    </Host>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => subscription.remove();
  }, []);
  return reduce;
}

export function SteppedPulseDot({ color = Theme.sky }: { color?: ColorValue }) {
  const reduce = useReduceMotion();
  const [dim, setDim] = useState(false);
  useEffect(() => {
    if (reduce) return;
    const timer = setInterval(() => setDim((value) => !value), 1000);
    return () => clearInterval(timer);
  }, [reduce]);
  return <View style={[styles.dot, { backgroundColor: color, opacity: dim ? 0.5 : 1 }]} />;
}

export function StatusCard({ tint, children }: { tint: ColorValue; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.06 }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  card: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderCurve: "continuous", borderWidth: 1, borderColor: Theme.border, backgroundColor: Theme.card, overflow: "hidden" },
});
