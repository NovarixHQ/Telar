import { Host, RoundedRectangle } from "@expo/ui/swift-ui";
import { glassEffect } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Theme } from "./theme";

export const GLASS_INSET = 8;
const RADIUS = 26;
const LIQUID = Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26;

/** A column floating over the canvas on iPad, as iPadOS 26 draws the sidebar and the inspector: inset from the window edge, rounded, on Liquid Glass. */
export function GlassPane({ edge, style, children }: { edge: "leading" | "trailing"; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <View style={[styles.pane, edge === "leading" ? styles.leading : styles.trailing, !LIQUID && styles.fallback, style]}>
      {LIQUID ? (
        <Host style={StyleSheet.absoluteFill} pointerEvents="none">
          <RoundedRectangle cornerRadius={RADIUS} modifiers={[glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: RADIUS })]} />
        </Host>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1, marginVertical: GLASS_INSET, borderRadius: RADIUS, borderCurve: "continuous" },
  leading: { marginLeft: GLASS_INSET },
  trailing: { marginRight: GLASS_INSET },
  content: { flex: 1, borderRadius: RADIUS, borderCurve: "continuous", overflow: "hidden" },
  fallback: { backgroundColor: Theme.sheet, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
});
