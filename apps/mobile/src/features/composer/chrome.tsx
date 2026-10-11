import { Host, RoundedRectangle, ZStack } from "@expo/ui/swift-ui";
import { foregroundStyle, glassEffect, shadow } from "@expo/ui/swift-ui/modifiers";
import { memo } from "react";
import { DynamicColorIOS, StyleSheet, View } from "react-native";
import { faded, Theme } from "../../ui";

const SHADOW = DynamicColorIOS({ light: "#0000001F", dark: "#00000059" });

/** Liquid Glass over the popover fill at 85%, behind whatever sits on top of it. */
export const Glass = memo(function Glass({ radius, lifted = false }: { radius: number; lifted?: boolean }) {
  return (
    <Host style={StyleSheet.absoluteFill} pointerEvents="none">
      <ZStack modifiers={lifted ? [shadow({ radius: 14, y: 6, color: SHADOW })] : []}>
        <RoundedRectangle cornerRadius={radius} modifiers={[foregroundStyle(faded("popover", 0.85))]} />
        <RoundedRectangle
          cornerRadius={radius}
          modifiers={[foregroundStyle("clear"), glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: radius })]}
        />
      </ZStack>
    </Host>
  );
});

/** A flat canvas strip under the home indicator, so the transcript doesn't scroll through it; the keyboard covers it when up. */
export const HomeIndicatorFill = memo(function HomeIndicatorFill({ height }: { height: number }) {
  return height > 0 ? <View style={[styles.fill, { height }]} pointerEvents="none" /> : null;
});

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: Theme.canvas },
});
