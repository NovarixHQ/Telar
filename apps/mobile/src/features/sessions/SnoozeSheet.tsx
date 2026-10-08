import { Button, HStack, Host, List, Spacer, Text } from "@expo/ui/swift-ui";
import { buttonStyle, foregroundStyle, monospacedDigit } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useMemo, useState } from "react";
import type { RootStack } from "../../platform/navigation/routes";
import { Theme } from "../../ui";
import { snoozePresets } from "./row-actions";
import { patchSession } from "./row-mutations";

/** The snooze presets for one session, as a medium-height sheet. */
export function SnoozeSheet() {
  const { params } = useRoute<RouteProp<RootStack, "Snooze">>();
  const navigation = useNavigation();
  const presets = useMemo(() => snoozePresets(new Date()), []);
  const [problem, setProblem] = useState<string>();
  const choose = (until: number) => {
    patchSession(params.hostId, params.sessionId, { snoozedUntil: until })
      .then(() => navigation.goBack())
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  };
  return (
    <Host style={{ flex: 1 }}>
      <List>
        {presets.map((preset) => (
          <Button key={preset.id} modifiers={[buttonStyle("plain")]} onPress={() => choose(preset.until)}>
            <HStack>
              <Text modifiers={[foregroundStyle(Theme.text)]}>{preset.label}</Text>
              <Spacer />
              <Text modifiers={[foregroundStyle(Theme.textMuted), monospacedDigit()]}>{preset.when}</Text>
            </HStack>
          </Button>
        ))}
        {problem ? <Text modifiers={[foregroundStyle(Theme.red)]}>{problem}</Text> : null}
      </List>
    </Host>
  );
}
