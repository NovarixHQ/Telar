import { Button, Divider, HStack, Host, Spacer, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, contentShape, foregroundStyle, frame, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { fileReference } from "@telar/client/composer";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Icon, Theme, type SymbolName } from "../../ui";
import { BrowserSurface } from "../browser";
import { FilesSurface } from "../files";
import { DiffSurface } from "../git";
import { SimulatorSurface } from "../simulators";
import { TerminalSurface } from "../terminal";
import type { PanelModel, PanelState } from "./model";
import { PanelEmptyState } from "./PanelEmptyState";
import { PanelTabStrip } from "./PanelTabStrip";
import { SessionSurface } from "./session/SessionSurface";
import { CORE_TABS } from "./tabs";

type PanelPresentation = "page" | "column";

type Props = { host: HostConnection; sessionId: string; panel: PanelModel; state: PanelState; presentation?: PanelPresentation; onClose: () => void };

function Surface({ host, sessionId, state, panel }: { host: HostConnection; sessionId: string; state: PanelState; panel: PanelModel }) {
  const { active } = state;
  const reference = (path: string) => panel.insertReference(fileReference(path).text);
  if (active === "diff") return <DiffSurface host={host} sessionId={sessionId} onOpenFile={panel.openFile} onReference={reference} />;
  if (active === "simulator") return <SimulatorSurface key={sessionId} host={host} sessionId={sessionId} />;
  if (active === "terminal") return <TerminalSurface host={host} sessionId={sessionId} />;
  if (active === "editor") return <FilesSurface key={sessionId} host={host} sessionId={sessionId} opening={state.opening} onOpened={panel.clearOpening} onReference={reference} />;
  if (active === "browser") return <BrowserSurface key={sessionId} host={host} sessionId={sessionId} />;
  if (active === "agents") return <SessionSurface key={sessionId} host={host} sessionId={sessionId} />;
  return (
    <Host style={styles.fill}>
      <PanelEmptyState offered={CORE_TABS} onOpen={(tab) => panel.open(tab)} />
    </Host>
  );
}

function StripButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}>
      <Icon name={icon} size={12} weight="semibold" color={Theme.textMuted} modifiers={[frame({ width: 30, height: 30 }), contentShape(shapes.rectangle())]} />
    </Button>
  );
}

export const PanelView = memo(function PanelView({ host, sessionId, panel, state, presentation = "page", onClose }: Props) {
  const column = presentation === "column";
  return (
    <View style={styles.fill}>
      <Host matchContents={{ vertical: true }}>
        <VStack spacing={0}>
          <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 })]}>
            {column ? null : <StripButton icon="chevron.left" label="Back to the session" onPress={onClose} />}
            <PanelTabStrip tabs={state.tabs} active={state.active} openable={panel.openable()} onSelect={panel.select} onClose={panel.closeTab} onOpen={(tab) => panel.open(tab)} />
            <Spacer minLength={0} />
            {column ? (
              <>
                <StripButton
                  icon={state.fullScreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"}
                  label={state.fullScreen ? "Leave full screen" : "Fill the window"}
                  onPress={() => panel.setFullScreen(!state.fullScreen)}
                />
                <StripButton icon="xmark" label="Close panel" onPress={onClose} />
              </>
            ) : null}
          </HStack>
          <Divider modifiers={[foregroundStyle(faded("border", 0.6))]} />
        </VStack>
      </Host>
      <Surface host={host} sessionId={sessionId} state={state} panel={panel} />
    </View>
  );
});

const styles = StyleSheet.create({ fill: { flex: 1 } });
