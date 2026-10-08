import { Host } from "@expo/ui/swift-ui";
import type { JournalTurn } from "@telar/client/journal";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, SteppedPulseDot, Theme } from "../../ui";
import { queueSummary } from "./queue";

type Props = { queued: JournalTurn[]; canPromote: boolean; onPromote: (runId: string) => void; onWithdraw: (runId: string) => void };

function Row({ turn, canPromote, onPromote, onWithdraw }: { turn: JournalTurn } & Omit<Props, "queued">) {
  return (
    <View style={styles.row}>
      <Text style={styles.prompt} numberOfLines={1}>{turn.prompt}</Text>
      {turn.state === "steering" ? (
        <Text style={styles.sending}>SENDING</Text>
      ) : (
        <>
          {canPromote ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Send now — the running turn hears it without stopping" onPress={() => onPromote(turn.runId)} hitSlop={8}>
              <Host matchContents>
                <Icon name="bolt.fill" textStyle="footnote" color={Theme.text} />
              </Host>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Remove this queued message" onPress={() => onWithdraw(turn.runId)} hitSlop={8}>
            <Host matchContents>
              <Icon name="xmark" textStyle="caption" weight="medium" color={Theme.textMuted} />
            </Host>
          </Pressable>
        </>
      )}
    </View>
  );
}

/** Messages waiting behind the running turn: a line that opens into rows to send now or remove. */
export function QueueLine({ queued, ...actions }: Props) {
  const [open, setOpen] = useState(false);
  const steering = queued.some((turn) => turn.state === "steering");
  return (
    <View style={styles.queue}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)} style={styles.summary}>
        {steering ? (
          <Host matchContents>
            <SteppedPulseDot />
          </Host>
        ) : null}
        <Text style={styles.summaryText}>{queueSummary(queued)}</Text>
      </Pressable>
      {open ? queued.map((turn) => <Row key={turn.runId} turn={turn} {...actions} />) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  queue: { gap: 6 },
  summary: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryText: { fontSize: 13, color: Theme.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderCurve: "continuous", backgroundColor: Theme.subtle },
  prompt: { flex: 1, fontSize: 13, color: Theme.text },
  sending: { fontSize: 12, fontWeight: "500", color: Theme.sky },
});
