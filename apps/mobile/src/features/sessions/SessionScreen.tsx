import { ContentUnavailableView, Host } from "@expo/ui/swift-ui";

export function SessionScreen() {
  return (
    <Host style={{ flex: 1 }}>
      <ContentUnavailableView title="Nothing here yet" systemImage="text.bubble" />
    </Host>
  );
}
