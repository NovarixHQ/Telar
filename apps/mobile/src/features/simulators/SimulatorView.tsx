import { Button, HStack, Host, Menu, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, disabled, font, foregroundStyle, frame, lineLimit, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import type { SimulatorSummary } from "@telar/engine-client";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text as NativeText, View, type GestureResponderEvent } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { Icon, Theme, Type, type SymbolName } from "../../ui";
import { screenMapping, type Size } from "./model";
import { StreamView } from "./StreamView";
import { useSimulatorViewer } from "./use-simulators";

type Props = { host: HostConnection; simulator: SimulatorSummary; canDrive: boolean; active: boolean; onGone: () => void };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function ControlButton({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(label)]}>
      <Icon name={icon} size={18} weight="medium" modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]} />
    </Button>
  );
}

function Controls({ simulator, canDrive, shuttingDown, onHome, onRotate, onAppSwitcher, onReload, onShutDown }: {
  simulator: SimulatorSummary;
  canDrive: boolean;
  shuttingDown: boolean;
  onHome: () => void;
  onRotate: () => void;
  onAppSwitcher: () => void;
  onReload: () => void;
  onShutDown: () => void;
}) {
  const watch = Boolean(simulator.pairedWith);
  return (
    <Host matchContents={{ vertical: true }}>
      <HStack spacing={4} modifiers={[foregroundStyle("#F5F5F5"), padding({ all: 4 }), background({ type: "material", material: "ultraThin" }, shapes.capsule()), padding({ horizontal: 12 }), padding({ top: 4 })]}>
        <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
          <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), lineLimit(1)]}>{simulator.name}</Text>
          {canDrive ? null : <Text modifiers={[Type.metaSmall, foregroundStyle("#A1A1A1")]}>View only</Text>}
        </VStack>
        {canDrive && !watch ? (
          <>
            <ControlButton icon="house" label="Home" onPress={onHome} />
            <ControlButton icon="rotate.right" label="Rotate" onPress={onRotate} />
          </>
        ) : null}
        <Menu label={<Icon name="ellipsis" size={18} weight="medium" modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]} />} modifiers={[accessibilityLabel("Simulator options")]}>
          <Button label="Reload stream" systemImage="arrow.clockwise" onPress={onReload} />
          {canDrive && !watch ? <Button label="App switcher" systemImage="square.on.square" onPress={onAppSwitcher} /> : null}
          {canDrive ? <Button label={shuttingDown ? "Shutting down…" : "Shut down"} systemImage="power" role="destructive" onPress={onShutDown} modifiers={shuttingDown ? [disabled(true)] : []} /> : null}
        </Menu>
      </HStack>
    </Host>
  );
}

/** A running simulator, live: its screen fitted and turned to the device's orientation, with taps and buttons forwarded. */
export function SimulatorView({ host, simulator, canDrive, active, onGone }: Props) {
  const viewer = useSimulatorViewer(host, simulator.id, active, canDrive);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [shuttingDown, setShuttingDown] = useState(false);
  const touching = useRef(false);
  const source = viewer.frame ?? (viewer.screen ? { width: viewer.screen.width, height: viewer.screen.height } : undefined);
  const mapping = source ? screenMapping(source, viewer.screen) : undefined;
  const rect = mapping?.fitted(box);

  const touch = (phase: "begin" | "move" | "end", event: GestureResponderEvent) => {
    const point = mapping?.devicePoint({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, box);
    if (point) viewer.send({ type: "touch", phase, ...point });
  };
  const inside = (event: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = event.nativeEvent;
    return Boolean(rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height);
  };
  const shutDown = () => {
    setShuttingDown(true);
    host
      .call(false, () => host.client.shutdownSimulator(simulator.id))
      .then(onGone, (error) => Alert.alert("Couldn't shut it down", message(error)))
      .finally(() => setShuttingDown(false));
  };

  const drawn = mapping && rect && rect.width > 0 ? { width: mapping.sideways ? rect.height : rect.width, height: mapping.sideways ? rect.width : rect.height } : undefined;
  return (
    <View style={styles.fill}>
      <Controls
        simulator={simulator}
        canDrive={canDrive}
        shuttingDown={shuttingDown}
        onHome={() => viewer.send({ type: "button", button: "home" })}
        onRotate={viewer.rotate}
        onAppSwitcher={() => viewer.send({ type: "button", button: "app_switcher" })}
        onReload={viewer.reload}
        onShutDown={shutDown}
      />
      <View style={styles.screen} onLayout={({ nativeEvent }) => setBox({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}>
        {viewer.url && drawn && rect ? (
          <StreamView
            key={viewer.url}
            url={viewer.url}
            onEvent={viewer.onStream}
            style={[styles.stream, { width: drawn.width, height: drawn.height, left: rect.x + (rect.width - drawn.width) / 2, top: rect.y + (rect.height - drawn.height) / 2, transform: [{ rotate: `${mapping?.rotation ?? 0}deg` }] }]}
          />
        ) : null}
        {viewer.frame ? null : (
          <View style={styles.status} pointerEvents="none">
            {viewer.failed ? <NativeText style={styles.failed}>{viewer.failed}</NativeText> : <ActivityIndicator color="#FFFFFF" />}
          </View>
        )}
        <View
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityLabel={`${simulator.name} screen`}
          onStartShouldSetResponder={(event) => canDrive && inside(event)}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(event) => ((touching.current = true), touch("begin", event))}
          onResponderMove={(event) => touching.current && touch("move", event)}
          onResponderRelease={(event) => touching.current && ((touching.current = false), touch("end", event))}
          onResponderTerminate={(event) => touching.current && ((touching.current = false), touch("end", event))}
        />
      </View>
      {viewer.notice ? (
        <Host matchContents={{ vertical: true }}>
          <HStack modifiers={[padding({ horizontal: 16 })]}>
            <Text modifiers={[Type.slim, foregroundStyle(Theme.amber), lineLimit(2)]}>{viewer.notice}</Text>
            <Spacer minLength={0} />
          </HStack>
        </Host>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000000", paddingBottom: 8, gap: 8 },
  screen: { flex: 1 },
  stream: { position: "absolute" },
  status: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", padding: 24 },
  failed: { color: "#A1A1A1", fontSize: 13, textAlign: "center" },
});
