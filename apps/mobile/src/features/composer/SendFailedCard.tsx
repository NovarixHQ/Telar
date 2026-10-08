import { Button, Host, HStack, Spacer, Text } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundStyle, lineLimit } from "@expo/ui/swift-ui/modifiers";
import { StatusCard, Theme, Type } from "../../ui";

/** A message the engine never took: Retry sends the same turn again, Discard lets it go. */
export function SendFailedCard({ error, onRetry, onDiscard }: { error: string; onRetry: () => void; onDiscard: () => void }) {
  return (
    <Host matchContents={{ vertical: true }}>
      <StatusCard tint="red">
        <HStack spacing={8}>
          <Text modifiers={[Type.slim, foregroundStyle(Theme.red), lineLimit(2)]}>{`Not sent — ${error}`}</Text>
          <Spacer />
          <Button onPress={onRetry} modifiers={[buttonStyle("plain")]}>
            <Text modifiers={[Type.slimMedium, foregroundStyle(Theme.text)]}>Retry</Text>
          </Button>
          <Button onPress={onDiscard} modifiers={[buttonStyle("plain")]}>
            <Text modifiers={[Type.slimMedium, foregroundStyle(Theme.red)]}>Discard</Text>
          </Button>
        </HStack>
      </StatusCard>
    </Host>
  );
}
