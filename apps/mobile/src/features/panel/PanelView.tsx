import { Button, ContentUnavailableView, Divider, HStack, Host, Spacer, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, contentShape, foregroundStyle, frame, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Icon, Theme } from "../../ui";
import { DiffSurface } from "../git";
import type { PanelModel, PanelState } from "./model";
import { PanelEmptyState } from "./PanelEmptyState";
import { PanelTabStrip } from "./PanelTabStrip";
import { CORE_TABS, TAB_INFO, type PanelTab } from "./tabs";

/** `page` is pushed over the conversation on iPhone; `column` sits beside it and can close itself. */
type PanelPresentation = "page" | "column";

function Surface({ host, sessionId, active, panel }: { host: HostConnection; sessionId: string; active: PanelTab | undefined; panel: PanelModel }) {
  if (active === "diff") return <DiffSurface host={host} sessionId={sessionId} />;
  return (
    <Host style={styles.fill}>
      {active ? <ContentUnavailableView title="Not available here" systemImage={TAB_INFO[active].icon} description="This surface isn't in the iPhone app yet." /> : <PanelEmptyState offered={CORE_TABS} onOpen={(tab) => panel.open(tab)} />}
    </Host>
  );
}

export function PanelView({ host, sessionId, panel, state, presentation = "page", onClose }: { host: HostConnection; sessionId: string; panel: PanelModel; state: PanelState; presentation?: PanelPresentation; onClose?: () => void }) {
  return (
    <View style={[styles.fill, { backgroundColor: presentation === "column" ? Theme.sheet : Theme.canvas }]}>
      <Host matchContents={{ vertical: true }}>
        <VStack spacing={0}>
          <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 })]}>
            <PanelTabStrip tabs={state.tabs} active={state.active} openable={panel.openable()} onSelect={panel.select} onClose={panel.closeTab} onOpen={(tab) => panel.open(tab)} />
            <Spacer minLength={0} />
            {presentation === "column" && onClose ? (
              <Button onPress={onClose} modifiers={[buttonStyle("plain"), accessibilityLabel("Close panel")]}>
                <Icon name="xmark" size={12} weight="semibold" color={Theme.textMuted} modifiers={[frame({ width: 30, height: 30 }), contentShape(shapes.rectangle())]} />
              </Button>
            ) : null}
          </HStack>
          <Divider modifiers={[foregroundStyle(faded("border", 0.6))]} />
        </VStack>
      </Host>
      <Surface host={host} sessionId={sessionId} active={state.active} panel={panel} />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
