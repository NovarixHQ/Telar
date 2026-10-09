import { Button, Divider, HStack, Host, ScrollView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, disabled, font, foregroundStyle, frame, lineLimit, multilineTextAlignment, opacity, padding, shapes, strokeBorder } from "@expo/ui/swift-ui/modifiers";
import type { SimulatorSummary } from "@telar/engine-client";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Icon, Radius, Theme, Type } from "../../ui";
import { useFeed } from "../transcript";
import { isViewable, listSimulators, sessionSimulators, simulatorIcon } from "./model";
import { SimulatorView } from "./SimulatorView";
import { useActive, useSimulatorList } from "./use-simulators";

function Chip({ simulator, selected, mine, onPress }: { simulator: SimulatorSummary; selected: boolean; mine: boolean; onPress: () => void }) {
  const viewable = isViewable(simulator);
  const chrome = selected
    ? [background(Theme.card, shapes.roundedRectangle({ cornerRadius: Radius.control, roundedCornerStyle: "continuous" })), strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.control })]
    : [];
  const state = viewable ? (mine ? "running, opened by this session" : "running") : simulator.booted ? "running, can't be shown here" : "not running";
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(`${simulator.name}, ${state}`), ...(viewable ? [] : [disabled(true), opacity(0.5)])]}>
      <HStack spacing={6} modifiers={[padding({ horizontal: 10 }), frame({ height: 28 }), ...chrome, contentShape(shapes.rectangle())]}>
        <Icon name={simulatorIcon(simulator)} size={11} weight="medium" color={simulator.booted ? Theme.emerald : Theme.textMuted} />
        <Text modifiers={[font({ textStyle: "footnote", weight: selected ? "semibold" : "medium" }), foregroundStyle(selected ? Theme.text : Theme.textMuted), lineLimit(1)]}>{simulator.name}</Text>
        {mine ? <Icon name="circle.fill" size={6} color={Theme.accent} /> : null}
      </HStack>
    </Button>
  );
}

function NoneRunning({ detail }: { detail: string }) {
  return (
    <Host style={styles.fill}>
      <VStack spacing={8} modifiers={[frame({ maxWidth: 300 }), padding({ all: 24 })]}>
        <Icon name="iphone" size={15} weight="medium" color={Theme.textMuted} modifiers={[frame({ width: 36, height: 36 }), background(Theme.fill, shapes.circle())]} />
        <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text)]}>No simulator is running</Text>
        <Text modifiers={[Type.slim, foregroundStyle(Theme.textMuted), multilineTextAlignment("center")]}>{detail}</Text>
      </VStack>
    </Host>
  );
}

/** The computer's simulators beside the session: running ones first, this session's marked, the chosen one live. */
export function SimulatorSurface({ host, sessionId }: { host: HostConnection; sessionId: string }) {
  const active = useActive();
  const { state, failure, canDrive, read } = useSimulatorList(host, active);
  const events = useFeed(host, sessionId).head?.events;
  const owned = useMemo(() => sessionSimulators(events ?? []), [events]);
  const simulators = useMemo(() => listSimulators(state?.simulators ?? [], owned), [state, owned]);
  const [wanted, setWanted] = useState<string>();
  const running = simulators.filter(isViewable);
  const shown = running.find((simulator) => simulator.id === wanted) ?? running[0];

  const choose = (simulator: SimulatorSummary) => {
    setWanted(simulator.id);
    if (!owned.includes(simulator.id)) void host.call(false, () => host.client.showSessionSimulator(sessionId, simulator.id, true)).catch(() => undefined);
  };

  if (!state) return failure ? <NoneRunning detail={failure} /> : <ActivityIndicator style={styles.fill} color={Theme.textMuted} />;
  return (
    <View style={styles.fill}>
      {simulators.length > 0 ? (
        <Host matchContents={{ vertical: true }}>
          <VStack spacing={0}>
            <HStack spacing={2} modifiers={[padding({ horizontal: 8, vertical: 4 })]}>
              <ScrollView axes="horizontal" showsIndicators={false}>
                <HStack spacing={2}>
                  {simulators.map((simulator) => (
                    <Chip key={simulator.id} simulator={simulator} selected={simulator.id === shown?.id} mine={owned.includes(simulator.id)} onPress={() => choose(simulator)} />
                  ))}
                </HStack>
              </ScrollView>
              <Spacer minLength={0} />
            </HStack>
            <Divider modifiers={[foregroundStyle(faded("border", 0.6))]} />
          </VStack>
        </Host>
      ) : null}
      {shown ? (
        <SimulatorView key={shown.id} host={host} simulator={shown} canDrive={canDrive} active={active} onGone={() => void read()} />
      ) : (
        <NoneRunning detail={state.status === "disabled" ? "Simulators are off on this computer. Turn them on in the cockpit's settings on the computer." : "When an agent boots one on the computer, it appears here."} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
