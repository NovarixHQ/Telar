import { Button, ContentUnavailableView, HStack, Host, List, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, font, foregroundStyle, refreshable } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import type { RootStack } from "../../platform/navigation/routes";
import { inboxFor } from "./inboxes";
import type { RailRow } from "./rail";
import { useRail } from "./use-rail";

const TONE = { "needs-you": "orange", working: "blue", failed: "red", quiet: "secondary" } as const;

function Row({ row }: { row: RailRow }) {
  return (
    <HStack spacing={8}>
      {row.unread ? <Text modifiers={[foregroundStyle("blue")]}>●</Text> : null}
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ weight: row.unread ? "semibold" : "regular" })]}>{row.title}</Text>
        {row.projectName ? <Text modifiers={[font({ size: 13 }), foregroundStyle({ type: "hierarchical", style: "secondary" })]}>{row.projectName}</Text> : null}
      </VStack>
      <Spacer />
      <Text modifiers={[font({ size: 13 }), foregroundStyle(TONE[row.status.tone] === "secondary" ? { type: "hierarchical", style: "secondary" } : TONE[row.status.tone])]}>
        {row.status.label}
      </Text>
    </HStack>
  );
}

export function SessionsScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Sessions">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const { rows, loaded, failed } = useRail(params.hostId);
  if (!loaded) {
    return (
      <Host style={{ flex: 1 }}>
        {failed ? <ContentUnavailableView title="Couldn't load sessions" systemImage="wifi.exclamationmark" description={failed} /> : <ProgressView />}
      </Host>
    );
  }
  if (rows.length === 0) {
    return (
      <Host style={{ flex: 1 }}>
        <ContentUnavailableView title="No sessions" systemImage="bubble.left.and.bubble.right" />
      </Host>
    );
  }
  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[refreshable(async () => inboxFor(params.hostId)?.refresh())]}>
        {rows.map((row) => (
          <Button key={row.key} modifiers={[buttonStyle("plain")]} onPress={() => navigation.navigate("Session", { hostId: row.hostId, sessionId: row.sessionId, title: row.title })}>
            <Row row={row} />
          </Button>
        ))}
      </List>
    </Host>
  );
}
