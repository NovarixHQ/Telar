import { Host } from "@expo/ui/swift-ui";
import type { ColorValue } from "react-native";
import { Icon, SteppedPulseDot, type SymbolName } from "../../ui";

/** Dynamic Type base sizes in points, for React Native text beside SwiftUI views. */
export const TextSize = { body: 17, subheadline: 15, footnote: 13, caption: 12, caption2: 11 };
export const MONO = "ui-monospace";

// A hosting view inside the transcript's scroll view inherits the bar's safe area and draws its glyph that far below its row.
export function Symbol({ name, size, color, weight }: { name: SymbolName; size: number; color: ColorValue; weight?: "regular" | "medium" | "semibold" }) {
  return (
    <Host matchContents ignoreSafeArea="all">
      <Icon name={name} size={size} color={color} {...(weight ? { weight } : {})} />
    </Host>
  );
}

export function PulseDot() {
  return (
    <Host matchContents ignoreSafeArea="all">
      <SteppedPulseDot />
    </Host>
  );
}
