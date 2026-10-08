import { Host, HStack, Text } from "@expo/ui/swift-ui";
import { background, font, foregroundStyle, monospacedDigit, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { Icon, Theme } from "../../ui";
import { languageBadge } from "./badge";

/** Rides above the caret while listening, saying which language the words are heard in. */
export function CaretPill({ language, x, y }: { language: string | undefined; x: number; y: number }) {
  return (
    <Host matchContents pointerEvents="none" style={{ position: "absolute", left: x, top: y }}>
      <HStack spacing={3} modifiers={[padding({ horizontal: 7, vertical: 3 }), background(Theme.accent, shapes.capsule())]}>
        <Icon name="mic.fill" textStyle="caption2" weight="semibold" color={Theme.accentGlyph} />
        <Text modifiers={[font({ textStyle: "caption", weight: "semibold" }), monospacedDigit(), foregroundStyle(Theme.accentGlyph)]}>{languageBadge(language)}</Text>
      </HStack>
    </Host>
  );
}
