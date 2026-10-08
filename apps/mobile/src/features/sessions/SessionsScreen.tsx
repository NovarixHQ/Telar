import { ContentUnavailableView, Host } from "@expo/ui/swift-ui";

export function SessionsScreen() {
  return (
    <Host style={{ flex: 1 }}>
      <ContentUnavailableView title="No sessions" systemImage="bubble.left.and.bubble.right" />
    </Host>
  );
}
