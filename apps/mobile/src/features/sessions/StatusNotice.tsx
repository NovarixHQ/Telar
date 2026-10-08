import { Button, HStack, Host, Spacer, Text } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, lineLimit } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";
import { Icon, StatusCard, Theme, type SymbolName, type ThemeColor } from "../../ui";

type Action = { label: string; onPress: () => void; destructive?: boolean };

/** One line of the session footer's StatusCards: connection lost, a failed send, a failed action. */
export function StatusNotice({ tint, icon, text, actions = [] }: { tint: "amber" | "red"; icon?: SymbolName; text: string; actions?: Action[] }) {
  const color = Theme[tint satisfies ThemeColor];
  return (
    <Host matchContents={{ vertical: true }} style={styles.host}>
      <StatusCard tint={tint}>
        <HStack spacing={icon ? 6 : 8}>
          {icon ? <Icon name={icon} textStyle="caption" color={color} /> : null}
          <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(color), lineLimit(3)]}>{text}</Text>
          <Spacer minLength={0} />
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              onPress={action.onPress}
              modifiers={[buttonStyle("plain"), font({ textStyle: "footnote", weight: "medium" }), foregroundStyle(action.destructive ? Theme.red : Theme.text)]}
            />
          ))}
        </HStack>
      </StatusCard>
    </Host>
  );
}

const styles = StyleSheet.create({ host: { width: "100%" } });
