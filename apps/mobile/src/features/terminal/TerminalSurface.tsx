import { Button, Divider, HStack, Host, ScrollView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { accessibilityLabel, background, buttonStyle, contentShape, disabled, font, foregroundStyle, frame, lineLimit, padding, shapes, strokeBorder, truncationMode } from "@expo/ui/swift-ui/modifiers";
import type { RunView } from "@telar/engine-client";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { faded, Icon, Radius, Theme, Type, type SymbolName } from "../../ui";
import { TerminalInput } from "./TerminalInput";
import { TerminalOutput } from "./TerminalOutput";
import { isOpen, pickTerminal, statusDetail, statusLabel, statusTone } from "./terminals";
import { useTerminalFeed, useTerminals } from "./use-terminals";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function GlyphButton({ icon, label, off, onPress }: { icon: SymbolName; label: string; off?: boolean; onPress: () => void }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(label), ...(off ? [disabled(true)] : [])]}>
      <Icon name={icon} size={12} weight="semibold" color={Theme.textMuted} modifiers={[frame({ width: 30, height: 30 }), contentShape(shapes.rectangle())]} />
    </Button>
  );
}

function Chip({ run, selected, onPress }: { run: RunView; selected: boolean; onPress: () => void }) {
  const chrome = selected
    ? [background(Theme.card, shapes.roundedRectangle({ cornerRadius: Radius.control, roundedCornerStyle: "continuous" })), strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "roundedRectangle", cornerRadius: Radius.control })]
    : [];
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain"), accessibilityLabel(`${run.title}, ${statusLabel(run)}`)]}>
      <HStack spacing={6} modifiers={[padding({ horizontal: 10 }), frame({ height: 28 }), ...chrome, contentShape(shapes.rectangle())]}>
        <Icon name="circle.fill" size={7} color={Theme[statusTone(run)]} />
        <Text modifiers={[font({ textStyle: "footnote", weight: selected ? "semibold" : "medium" }), foregroundStyle(selected && isOpen(run) ? Theme.text : Theme.textMuted), lineLimit(1)]}>{run.title}</Text>
      </HStack>
    </Button>
  );
}

function Header({ run, failure, acting, onRestart, onStop }: { run: RunView; failure: string | undefined; acting: boolean; onRestart: () => void; onStop: () => void }) {
  const detail = failure ?? statusDetail(run) ?? run.command;
  return (
    <HStack spacing={8} modifiers={[padding({ horizontal: 12, vertical: 8 })]}>
      <Icon name="circle.fill" size={7} color={Theme[statusTone(run)]} />
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[Type.slimMedium, foregroundStyle(Theme.text)]}>{statusLabel(run)}</Text>
        {detail ? <Text modifiers={[Type.monoSmall, foregroundStyle(failure ? Theme.red : Theme.textMuted), lineLimit(1), truncationMode("middle")]}>{detail}</Text> : null}
      </VStack>
      <Spacer minLength={0} />
      <GlyphButton icon="arrow.clockwise" label="Restart" off={acting} onPress={onRestart} />
      <GlyphButton icon="stop.fill" label="Stop" off={acting || !isOpen(run)} onPress={onStop} />
    </HStack>
  );
}

function OpenTerminal({ host, sessionId, run, onAdopt }: { host: HostConnection; sessionId: string; run: RunView; onAdopt: (run: RunView) => void }) {
  const { feed, state } = useTerminalFeed(host, sessionId, run);
  const [acting, setActing] = useState(false);
  const terminal = state.terminal ?? run;
  const act = (call: () => Promise<RunView>) => {
    setActing(true);
    call()
      .then((next) => (feed.adopt(next), onAdopt(next)))
      .catch((error) => feed.fail(error))
      .finally(() => setActing(false));
  };
  const write = useCallback(
    (data: string) => void host.call(false, () => host.client.writeRun(sessionId, { terminalId: run.terminalId, data })).catch((error) => feed.fail(error)),
    [host, sessionId, run.terminalId, feed],
  );
  return (
    <>
      <Host matchContents={{ vertical: true }}>
        <VStack spacing={0}>
          <Header
            run={terminal}
            failure={state.failure}
            acting={acting}
            onRestart={() => act(() => host.client.restartRun(sessionId, run.terminalId, { closedBy: "person" }))}
            onStop={() => act(() => host.client.stopRun(sessionId, run.terminalId, undefined, { closedBy: "person" }))}
          />
          <Divider modifiers={[foregroundStyle(faded("border", 0.6))]} />
        </VStack>
      </Host>
      <TerminalOutput text={state.text} dropped={state.dropped} />
      <TerminalInput enabled={isOpen(terminal)} onWrite={write} />
    </>
  );
}

/** The session's terminals on this computer: pick one to watch and type into it, or run a new command. */
export function TerminalSurface({ host, sessionId }: { host: HostConnection; sessionId: string }) {
  const { terminals, adopt } = useTerminals(host, sessionId);
  const [wanted, setWanted] = useState<string>();
  const shown = terminals ? pickTerminal(terminals, wanted) : undefined;

  const launch = () =>
    Alert.prompt(
      "Run a command",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Run",
          isPreferred: true,
          onPress: (typed?: string) => {
            const command = typed?.trim();
            if (!command) return;
            host
              .call(false, () => host.client.openTerminal(sessionId, { command }))
              .then((run) => (adopt(run), setWanted(run.terminalId)))
              .catch((error) => Alert.alert("Couldn't open it", message(error)));
          },
        },
      ],
      "plain-text",
    );

  if (!terminals) return <ActivityIndicator style={styles.fill} color={Theme.textMuted} />;
  return (
    <View style={styles.fill}>
      <Host matchContents={{ vertical: true }}>
        <VStack spacing={0}>
          <HStack spacing={2} modifiers={[padding({ horizontal: 8, vertical: 4 })]}>
            <ScrollView axes="horizontal" showsIndicators={false}>
              <HStack spacing={2}>
                {terminals.map((run) => (
                  <Chip key={run.terminalId} run={run} selected={run.terminalId === shown?.terminalId} onPress={() => setWanted(run.terminalId)} />
                ))}
              </HStack>
            </ScrollView>
            <Spacer minLength={0} />
            <GlyphButton icon="plus" label="New terminal" onPress={launch} />
          </HStack>
          <Divider modifiers={[foregroundStyle(faded("border", 0.6))]} />
        </VStack>
      </Host>
      {shown ? (
        <OpenTerminal key={shown.terminalId} host={host} sessionId={sessionId} run={shown} onAdopt={adopt} />
      ) : (
        <Host style={styles.fill}>
          <VStack spacing={10} modifiers={[padding({ all: 24 })]}>
            <Icon name="terminal" size={28} color={Theme.textMuted} />
            <Text modifiers={[font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text)]}>No terminals</Text>
            <Text modifiers={[Type.slim, foregroundStyle(Theme.textMuted)]}>Run a command on the computer and watch it here.</Text>
            <Button label="New terminal" systemImage="plus" onPress={launch} />
          </VStack>
        </Host>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
