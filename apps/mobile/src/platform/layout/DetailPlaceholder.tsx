import { Button, ContentUnavailableView, Host, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, controlSize, fixedSize, frame, labelStyle, padding, tint } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Theme } from "../../ui";
import { useSplitColumn } from "./split-column";

// Swift centres it below the detail column's empty navigation bar.
const NAV_BAR = 38;

/** The empty detail column on iPad, before a session is chosen. */
export function DetailPlaceholder({ onNewConversation }: { onNewConversation?: () => void }) {
  const { sidebarHidden, showSidebar } = useSplitColumn();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.column}>
      <Host style={styles.column}>
        <VStack spacing={0} modifiers={[padding({ top: NAV_BAR }), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          <ContentUnavailableView title="Your work, within reach" systemImage="text.bubble" description="Choose a session from the sidebar, or start a conversation." modifiers={[fixedSize({ vertical: true })]} />
          {onNewConversation ? <Button label="New conversation" onPress={onNewConversation} modifiers={[buttonStyle("borderedProminent"), controlSize("small"), tint(Theme.accent), padding({ top: -16 })]} /> : null}
        </VStack>
      </Host>
      {sidebarHidden ? (
        <Host matchContents style={[styles.toggle, { top: insets.top + 6 }]}>
          <Button label="Show Sidebar" systemImage="sidebar.left" onPress={showSidebar} modifiers={[labelStyle("iconOnly"), buttonStyle("glass"), controlSize("large"), tint(Theme.text), accessibilityLabel("Show Sidebar")]} />
        </Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  toggle: { position: "absolute", left: 16 },
});
