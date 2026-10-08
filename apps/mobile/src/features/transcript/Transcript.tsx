import { memo, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import type { JournalTurn } from "@telar/client/journal";
import { ItemRow, NestedDetail, NoticeLine, NoticeRow, UserBubble } from "./ItemRow";
import { groupTurns, turnLayout, type Activity, type Ending, type Fold } from "./layout";
import { Theme } from "../../ui";
import { PulseDot, Symbol, TextSize } from "./native";

function FoldHeader({ text, detail, open, failed, onPress }: { text: string; detail?: string; open: boolean; failed: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.foldHeader} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={[styles.chevron, open && styles.turned]}>
        <Symbol name="chevron.right" size={TextSize.caption} weight="semibold" color={Theme.textMuted} />
      </View>
      {!open && failed ? <Symbol name="exclamationmark.triangle" size={TextSize.caption} weight="medium" color={Theme.red} /> : null}
      <Text style={[styles.meta, !open && failed && styles.red]}>{text}</Text>
      {detail ? (
        <>
          <Text style={[styles.meta, styles.faint]}>·</Text>
          <Text style={[styles.meta, styles.tally]} numberOfLines={1}>{detail}</Text>
        </>
      ) : null}
    </Pressable>
  );
}

function FoldView({ fold }: { fold: Fold }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((value) => !value);
  if (fold.live) {
    const hidden = fold.items.length - 1;
    return (
      <View style={styles.stack}>
        {hidden > 0 ? <FoldHeader text={open ? "Show fewer steps" : `+${hidden} earlier step${hidden === 1 ? "" : "s"}`} open={open} failed={fold.failed} onPress={toggle} /> : null}
        {(open ? fold.items : fold.items.slice(-1)).map((item) => <ItemRow key={item.id} item={item} />)}
      </View>
    );
  }
  const count = fold.items.length;
  return (
    <View style={styles.stack}>
      <FoldHeader text={`${count} step${count === 1 ? "" : "s"}`} detail={fold.tally} open={open} failed={fold.failed} onPress={toggle} />
      {open ? (
        <NestedDetail>
          {fold.items.map((item) => <ItemRow key={item.id} item={item} />)}
        </NestedDetail>
      ) : null}
    </View>
  );
}

const SWEEP = 72;
const SWEEP_MS = 2200;
const CHAR_WIDTH = TextSize.body * 0.55;

/** The Swift app's SweepingText: a 72pt highlight crossing the muted label every 2.2 s. */
function SweepingText({ text }: { text: string }) {
  const dark = useColorScheme() === "dark";
  const [phase, setPhase] = useState(-1);
  const [still, setStill] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);
  useEffect(() => {
    if (still) return;
    const start = Date.now();
    const timer = setInterval(() => setPhase((((Date.now() - start) % SWEEP_MS) / SWEEP_MS) * 2 - 1), 33);
    return () => clearInterval(timer);
  }, [still]);
  const width = text.length * CHAR_WIDTH;
  const center = phase * (width + SWEEP) - SWEEP / 2;
  const [muted, ink] = dark ? [[161, 161, 161], [245, 245, 245]] : [[105, 105, 115], [39, 39, 42]];
  const mix = (amount: number) => `rgb(${muted.map((channel, at) => Math.round(channel + (ink[at]! - channel) * amount)).join(",")})`;
  return (
    <Text style={styles.working}>
      {[...text].map((char, index) => {
        const reach = still ? 0 : Math.max(0, 1 - Math.abs((index + 0.5) * CHAR_WIDTH - center) / (SWEEP / 2));
        return reach > 0 ? <Text key={index} style={{ color: mix(0.9 * reach) }}>{char}</Text> : char;
      })}
    </Text>
  );
}

function EndingRow({ ending }: { ending: Ending }) {
  if (ending.kind === "failed") return <Text style={[styles.meta, styles.red]}>{ending.text}</Text>;
  if (ending.kind === "stopped") return <Text style={styles.meta}>Stopped</Text>;
  return (
    <View style={styles.workingRow}>
      <PulseDot />
      <SweepingText text={ending.label} />
    </View>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  return activity.kind === "fold" ? <FoldView fold={activity} /> : <ItemRow item={activity.item} />;
}

const TurnView = memo(function TurnView({ turn }: { turn: JournalTurn }) {
  const layout = useMemo(() => turnLayout(turn), [turn]);
  const { opener } = layout;
  return (
    <View style={styles.turn}>
      {opener?.kind === "bubble" ? <UserBubble text={opener.text} attachments={opener.attachments} /> : null}
      {opener?.kind === "notice" ? <NoticeRow notice={opener.notice} /> : null}
      {opener?.kind === "compact" ? <NoticeLine icon="arrow.down.right.and.arrow.up.left" text={opener.text} /> : null}
      {layout.body.map((activity) => (
        <ActivityRow key={activity.kind === "fold" ? `fold/${activity.id}` : activity.item.id} activity={activity} />
      ))}
      {layout.ending ? <EndingRow ending={layout.ending} /> : null}
    </View>
  );
});

/** One view per turn group, as direct children of the scroll view so prepended pages keep the reader's place. */
export function Transcript({ turns }: { turns: readonly JournalTurn[] }) {
  return groupTurns(turns).map((group) =>
    group.length === 1 ? (
      <TurnView key={group[0]!.runId} turn={group[0]!} />
    ) : (
      <View key={group[0]!.runId} style={styles.group}>
        {group.map((turn) => <TurnView key={turn.runId} turn={turn} />)}
      </View>
    ),
  );
}

const styles = StyleSheet.create({
  turn: { gap: 10 },
  group: { gap: 2 },
  stack: { gap: 6 },
  foldHeader: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 },
  chevron: { opacity: 0.6 },
  turned: { transform: [{ rotate: "90deg" }] },
  meta: { fontSize: TextSize.caption, color: Theme.textMuted },
  faint: { opacity: 0.5 },
  tally: { flexShrink: 1, opacity: 0.8 },
  red: { color: Theme.red },
  workingRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  working: { fontSize: TextSize.body, color: Theme.textMuted },
});
