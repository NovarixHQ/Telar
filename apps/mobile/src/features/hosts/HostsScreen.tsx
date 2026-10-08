import { Button, ContentUnavailableView, Host, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize } from "@expo/ui/swift-ui/modifiers";

export function HostsScreen() {
  return (
    <Host style={{ flex: 1 }}>
      <VStack spacing={16}>
        <ContentUnavailableView
          title="No computers yet"
          systemImage="desktopcomputer"
          description="Pair this phone with Telar on your computer to follow and steer its sessions."
        />
        <Button label="Pair a computer" modifiers={[buttonStyle("glassProminent"), controlSize("large")]} />
      </VStack>
    </Host>
  );
}
