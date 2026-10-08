import { Button, ContentUnavailableView, Host, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, fixedSize, frame, padding, tint } from "@expo/ui/swift-ui/modifiers";
import { Theme } from "../../ui";

// Swift centres it below the detail column's empty navigation bar.
const NAV_BAR = 38;

/** The empty detail column on iPad, before a session is chosen. */
export function DetailPlaceholder({ onNewConversation }: { onNewConversation?: () => void }) {
  return (
    <Host style={{ flex: 1 }}>
      <VStack spacing={0} modifiers={[padding({ top: NAV_BAR }), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <ContentUnavailableView title="Your work, within reach" systemImage="text.bubble" description="Choose a session from the sidebar, or start a conversation." modifiers={[fixedSize({ vertical: true })]} />
        {onNewConversation ? <Button label="New conversation" onPress={onNewConversation} modifiers={[buttonStyle("borderedProminent"), controlSize("small"), tint(Theme.accent), padding({ top: -16 })]} /> : null}
      </VStack>
    </Host>
  );
}
