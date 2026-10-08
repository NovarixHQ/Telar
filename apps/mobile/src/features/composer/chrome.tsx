import { Host, Mask, Rectangle, RoundedRectangle, ZStack } from "@expo/ui/swift-ui";
import { foregroundStyle, glassEffect, shadow } from "@expo/ui/swift-ui/modifiers";
import { DynamicColorIOS, StyleSheet } from "react-native";
import { faded } from "../../ui";

const SHADOW = DynamicColorIOS({ light: "#0000001F", dark: "#00000059" });

/** Liquid Glass over the popover fill at 85%, behind whatever sits on top of it. */
export function Glass({ radius, lifted = false }: { radius: number; lifted?: boolean }) {
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
}

/** The bar material behind the footer, fading in over its top third; it runs on under the home indicator. */
export function Scrim() {
  return (
    <Host style={styles.scrim} pointerEvents="none">
      <Mask>
        <Rectangle modifiers={[foregroundStyle({ type: "material", material: "bar" })]} />
        <Mask.Content>
          <Rectangle modifiers={[foregroundStyle({ type: "linearGradient", colors: ["clear", "black", "black"], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 0.7 } })]} />
        </Mask.Content>
      </Mask>
    </Host>
  );
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: -60 },
});
