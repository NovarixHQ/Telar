import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { itemText, type JournalItem } from "@telar/client/journal";
import { ArtifactCard } from "./Artifact";
import { providerSwitchLabel } from "./layout";
import { agentNotice, notificationNotice, wakeNotice, type Notice } from "./notices";
import { Markdown } from "./Markdown";
import { advanceReveal, REVEAL_FRAME_MS, revealed, revealText, stepReveal, type Reveal } from "./reveal";
import { Radius, Theme, type SymbolName } from "../../ui";
import { MONO, Symbol, TextSize } from "./native";
import { TaskItemRow, ToolChip, ToolRow } from "./ToolRows";

export function NestedDetail({ children }: { children: ReactNode }) {
  return (
    <View style={styles.nested}>
      <View style={styles.nestedRule} />
      <View style={styles.nestedBody}>{children}</View>
    </View>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerRule} />
      <Text style={styles.metaSmall}>{label}</Text>
      <View style={styles.dividerRule} />
    </View>
  );
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((value) => !value)} style={styles.stack}>
      <ToolChip icon="brain" label="Thought" />
      {open ? (
        <NestedDetail>
          <Text selectable style={styles.meta}>{text}</Text>
        </NestedDetail>
      ) : null}
    </Pressable>
  );
}

/** Streamed prose is revealed at the pace it arrives instead of in poll-sized jumps. */
function StreamingMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  const pace = useRef<{ state: Reveal; rendered: string }>({ state: revealed(text.length, Date.now()), rendered: text });
  const [, redraw] = useState(0);
  if (pace.current.rendered !== text) pace.current = { state: stepReveal(pace.current.state, pace.current.rendered, text, Date.now()), rendered: text };
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      const { state } = pace.current;
      if (state.shown >= state.target) return;
      pace.current = { ...pace.current, state: advanceReveal(state, Date.now()) };
      redraw((frame) => frame + 1);
    }, REVEAL_FRAME_MS);
    return () => clearInterval(timer);
  }, [streaming]);
  return <Markdown text={streaming ? revealText(text, pace.current.state.shown) : text} />;
}

export function ItemRow({ item }: { item: JournalItem }) {
  const { detail } = item;
  switch (detail.type) {
    case "assistant_message":
      return <StreamingMarkdown text={itemText(item)} streaming={item.status === "inProgress"} />;
    case "reasoning":
      return <Thought text={itemText(item)} />;
    case "plan":
      return (
        <NestedDetail>
          {detail.plan.steps.map((step, index) => (
            <View key={index} style={styles.planStep}>
              <Symbol
                name={step.status === "completed" ? "checkmark.circle.fill" : step.status === "inProgress" ? "circle.dotted.circle" : "circle"}
                size={TextSize.footnote}
                color={step.status === "completed" ? Theme.emerald : Theme.textMuted}
              />
              <Text style={[styles.meta, step.status !== "completed" && styles.text, step.status === "completed" && styles.done]}>{step.step}</Text>
            </View>
          ))}
        </NestedDetail>
      );
    case "error":
      return <Text style={[styles.meta, styles.red]}>{detail.error.message}</Text>;
    case "provider_switch":
      return <Divider label={providerSwitchLabel(detail)} />;
    case "context_compaction":
      return <Divider label={detail.preTokens !== undefined && detail.postTokens !== undefined ? `Context compacted ${Math.floor(detail.preTokens / 1000)}k → ${Math.floor(detail.postTokens / 1000)}k` : "Context compacted"} />;
    case "user_message":
      if (!detail.wakeReason && !detail.sender) return <UserBubble text={itemText(item)} attachments={detail.attachments?.length ?? 0} />;
      return <NoticeRow notice={detail.wakeReason ? wakeNotice(detail.wakeReason, undefined, detail.notice, itemText(item)) : agentNotice(undefined, detail.notice, itemText(item))} />;
    case "notification":
      return <NoticeRow notice={notificationNotice(detail.notification)} />;
    case "artifact":
      return <ArtifactCard artifact={detail.artifact} />;
    case "task":
      return <TaskItemRow item={item} />;
    default:
      return <ToolRow item={item} />;
  }
}

/** Hugs its longest wrapped line, as SwiftUI does, instead of keeping the width it wrapped at. */
export function UserBubble({ text, attachments = 0 }: { text: string; attachments?: number }) {
  const blank = !text.trim();
  const [hug, setHug] = useState<number>();
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.bubble, hug !== undefined && { width: hug + 24 }]}>
        {blank && attachments ? (
          <View style={styles.imageLabel}>
            <Symbol name="photo" size={TextSize.body} color={Theme.textMuted} />
            <Text style={[styles.bubbleText, styles.muted]}>Image</Text>
          </View>
        ) : (
          <Text
            selectable
            style={styles.bubbleText}
            onTextLayout={({ nativeEvent }) => {
              if (hug === undefined && nativeEvent.lines.length > 1) setHug(Math.ceil(Math.max(...nativeEvent.lines.map((line) => line.width))));
            }}
          >
            {text}
          </Text>
        )}
      </View>
    </View>
  );
}

export function NoticeLine({ icon, text }: { icon: SymbolName; text: string }) {
  return (
    <View style={styles.notice}>
      <Symbol name={icon} size={TextSize.caption} color={Theme.textMuted} />
      <Text style={styles.meta} numberOfLines={2}>{text}</Text>
    </View>
  );
}

export function NoticeRow({ notice }: { notice: Notice }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.stack}>
      <Pressable disabled={!notice.body} onPress={() => setOpen((value) => !value)} style={styles.notice} accessibilityRole={notice.body ? "button" : "text"}>
        <Symbol name={notice.icon} size={TextSize.caption} color={Theme.textMuted} />
        <Text style={styles.meta} numberOfLines={2}>{notice.verb}</Text>
        {notice.head ? <Text style={[styles.monoSmall, styles.shrink]} numberOfLines={1}>{notice.head}</Text> : null}
        {notice.extra.map((part) => <Text key={part} style={styles.monoSmall} numberOfLines={1}>{part}</Text>)}
        <View style={styles.fill} />
        {notice.body ? (
          <View style={open && styles.turned}>
            <Symbol name="chevron.right" size={TextSize.caption} color={Theme.textMuted} />
          </View>
        ) : null}
      </Pressable>
      {open && notice.body ? (
        <NestedDetail>
          {notice.icon === "arrow.left.arrow.right" ? <Markdown text={notice.body} /> : <Text selectable style={styles.meta}>{notice.body}</Text>}
        </NestedDetail>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 6 },
  nested: { flexDirection: "row", gap: 12, paddingTop: 2 },
  nestedRule: { width: 1, marginLeft: 12, backgroundColor: Theme.border },
  nestedBody: { flex: 1, gap: 5 },
  divider: { flexDirection: "row", alignItems: "center", gap: 8 },
  dividerRule: { flex: 1, height: 1, backgroundColor: Theme.border },
  meta: { fontSize: TextSize.caption, color: Theme.textMuted },
  metaSmall: { fontSize: TextSize.caption2, color: Theme.textMuted },
  text: { color: Theme.text },
  done: { textDecorationLine: "line-through" },
  red: { color: Theme.red },
  muted: { color: Theme.textMuted },
  planStep: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bubbleRow: { flexDirection: "row", justifyContent: "flex-end", paddingLeft: 32 },
  bubble: { padding: 12, borderRadius: Radius.bubble, backgroundColor: Theme.subtle, flexShrink: 1 },
  bubbleText: { fontSize: TextSize.body, lineHeight: TextSize.body * 1.2 + 4, color: Theme.text },
  imageLabel: { flexDirection: "row", alignItems: "center", gap: 6 },
  notice: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 },
  monoSmall: { fontFamily: MONO, fontSize: TextSize.caption2, color: Theme.textMuted },
  shrink: { flexShrink: 1 },
  fill: { flex: 1 },
  turned: { transform: [{ rotate: "90deg" }] },
});
