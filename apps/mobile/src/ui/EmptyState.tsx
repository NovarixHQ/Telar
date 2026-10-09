import { Button, Host, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityElement, background, font, foregroundStyle, frame, lineLimit, multilineTextAlignment, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";
import { Icon, type SymbolName } from "./Icon";
import { Theme, Type } from "./theme";

type Props = {
  icon: SymbolName;
  title: string;
  detail?: string | undefined;
  failed?: boolean;
  action?: { label: string; icon: SymbolName; onPress: () => void } | undefined;
  /** Already inside a SwiftUI host and list: sit at the top instead of filling and centring in a host of its own. */
  inline?: boolean;
};

/** What a surface shows when it has nothing: a glyph in a circle, a title and a muted line, centred in the room it has. */
export function EmptyState({ icon, title, detail, failed = false, action, inline = false }: Props) {
  const body = (
    <VStack
      spacing={8}
      modifiers={[
        multilineTextAlignment("center"),
        frame({ maxWidth: 300 }),
        inline ? frame({ maxWidth: Infinity }) : frame({ maxWidth: Infinity, maxHeight: Infinity }),
        padding(inline ? { top: 16 } : { all: 24 }),
        accessibilityElement(action ? "contain" : "combine"),
      ]}
    >
      <Icon name={icon} size={15} weight="medium" color={Theme.textMuted} modifiers={[frame({ width: 36, height: 36 }), background(Theme.fill, shapes.circle())]} />
      <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text), lineLimit(2)]}>{title}</Text>
      {detail ? <Text modifiers={[Type.slim, foregroundStyle(failed ? Theme.red : Theme.textMuted)]}>{detail}</Text> : null}
      {action ? <Button label={action.label} systemImage={action.icon} onPress={action.onPress} modifiers={[padding({ top: 6 })]} /> : null}
    </VStack>
  );
  return inline ? body : <Host style={styles.fill}>{body}</Host>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
