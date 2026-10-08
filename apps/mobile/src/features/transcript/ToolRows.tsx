import { createContext, useContext, useState, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { itemLabel, type JournalItem, type JournalTask } from "@telar/client/journal";
import { faded, Theme, type SymbolName } from "../../ui";
import { CodeBlockView, copyAction, LongPressMenu, PageSheet } from "./chrome";
import { Markdown } from "./Markdown";
import { MONO, PulseDot, Symbol, TextSize } from "./native";
import { detailParts, rowCopies, type DetailPart } from "./tool-detail";

/** The sub-agents of the turn being drawn, so a `task` row can find its own. */
export const TurnTasks = createContext<readonly JournalTask[]>([]);

/** How a sub-agent's sheet draws each of its steps; the transcript provides its own row. */
export const StepRow = createContext<ComponentType<{ item: JournalItem }>>(() => null);

const TOOL_ICON: Partial<Record<JournalItem["detail"]["type"], SymbolName>> = {
  command_execution: "terminal",
  file_change: "pencil.line",
  file_read: "doc.text",
  web_search: "magnifyingglass",
  browser_action: "globe",
  task: "person.2",
  unknown: "questionmark.diamond",
};

export function ToolChip({ icon, label, status }: { icon: SymbolName; label: string; status?: JournalItem["status"] | undefined }) {
  return (
    <View style={styles.chip}>
      <View style={styles.glyph}>
        <Symbol name={icon} size={TextSize.footnote} weight="medium" color={Theme.textMuted} />
      </View>
      <Text style={styles.chipLabel} numberOfLines={1} ellipsizeMode="middle">{label}</Text>
      {status === "inProgress" ? <PulseDot /> : null}
      {status === "failed" ? <Symbol name="xmark" size={TextSize.caption} weight="semibold" color={Theme.red} /> : null}
      {status === "declined" ? <Symbol name="hand.raised" size={TextSize.caption} color={Theme.amber} /> : null}
    </View>
  );
}

function Part({ part }: { part: DetailPart }) {
  switch (part.kind) {
    case "code":
      return <CodeBlockView code={part.text} />;
    case "caption":
      return <Text selectable style={[styles.monoSmall, styles.faint]}>{part.text}</Text>;
    case "label":
      return <Text style={styles.metaSmall}>{part.text}</Text>;
    case "meta":
      return <Text style={[styles.meta, part.failed && styles.red]}>{part.text}</Text>;
    case "path":
      return <Text selectable style={styles.path}>{part.text}</Text>;
    case "body":
      return <Text selectable style={styles.body}>{part.text}</Text>;
  }
}

/** A tool call: tap for its detail sheet, long-press to copy its command, output or path. */
export function ToolRow({ item }: { item: JournalItem }) {
  const [open, setOpen] = useState(false);
  const label = itemLabel(item);
  return (
    <>
      <LongPressMenu actions={rowCopies(item).map((copy) => copyAction(copy.label, copy.text))}>
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label}>
          <ToolChip icon={TOOL_ICON[item.detail.type] ?? "wrench.and.screwdriver"} label={label} status={item.status} />
        </Pressable>
      </LongPressMenu>
      <PageSheet title={label} open={open} onClose={() => setOpen(false)}>
        {detailParts(item).map((part, index) => <Part key={index} part={part} />)}
      </PageSheet>
    </>
  );
}

const live = (task: JournalTask) => task.state === "pending" || task.state === "running" || task.state === "waiting";

function AgentStatus({ task }: { task: JournalTask }) {
  if (live(task)) {
    return (
      <View style={styles.status}>
        <PulseDot />
        <Text style={[styles.meta, styles.sky]}>Working</Text>
      </View>
    );
  }
  const failed = task.state === "failed";
  return (
    <View style={styles.status}>
      <Symbol name={failed ? "xmark" : "checkmark"} size={TextSize.caption} weight={failed ? "semibold" : "medium"} color={failed ? Theme.red : Theme.emerald} />
      <Text style={[styles.meta, failed && styles.red]}>{failed ? "Failed" : "Done"}</Text>
    </View>
  );
}

/** A sub-agent: title, live or failed mark and its step count; tap for everything it did. */
export function TaskRow({ task }: { task: JournalTask }) {
  const [open, setOpen] = useState(false);
  const Step = useContext(StepRow);
  const title = task.title ?? "Sub-agent";
  const steps = task.items.length;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.chip} accessibilityRole="button" accessibilityLabel={title}>
        <View style={styles.glyph}>
          <Symbol name="person.2" size={TextSize.footnote} weight="medium" color={Theme.textMuted} />
        </View>
        <Text style={styles.taskTitle} numberOfLines={1}>{title}</Text>
        {live(task) ? <PulseDot /> : task.state === "failed" ? <Symbol name="xmark" size={TextSize.caption} weight="semibold" color={Theme.red} /> : null}
        <Text style={[styles.metaSmall, styles.faint]}>{`${steps} step${steps === 1 ? "" : "s"}`}</Text>
        <View style={styles.dim}>
          <Symbol name="chevron.right" size={TextSize.caption2} weight="semibold" color={Theme.textMuted} />
        </View>
      </Pressable>
      <PageSheet title={title} open={open} onClose={() => setOpen(false)}>
        <AgentStatus task={task} />
        {task.items.map((item) => <Step key={item.id} item={item} />)}
        {steps === 0 ? <Text style={styles.meta}>No steps recorded yet.</Text> : null}
        {task.resultText ? (
          <>
            <View style={styles.rule} />
            <Markdown text={task.resultText} />
          </>
        ) : null}
      </PageSheet>
    </>
  );
}

/** A `task` item: its sub-agent's row once the roster knows it, else a plain chip. */
export function TaskItemRow({ item }: { item: JournalItem }) {
  const tasks = useContext(TurnTasks);
  const task = item.detail.type === "task" ? tasks.find((one) => one.id === (item.detail as { taskId: string }).taskId) : undefined;
  return task ? <TaskRow task={task} /> : <ToolChip icon="person.2" label={itemLabel(item)} status={item.status} />;
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 },
  glyph: { width: 24, height: 24, alignItems: "center", justifyContent: "center", opacity: 0.7 },
  chipLabel: { flexShrink: 1, fontFamily: MONO, fontSize: TextSize.caption, color: Theme.textMuted },
  taskTitle: { flexShrink: 1, fontSize: TextSize.body, color: Theme.textMuted },
  dim: { opacity: 0.5 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { fontSize: TextSize.caption, color: Theme.textMuted },
  metaSmall: { fontSize: TextSize.caption2, color: Theme.textMuted },
  monoSmall: { fontFamily: MONO, fontSize: TextSize.caption2, color: Theme.textMuted },
  faint: { opacity: 0.7 },
  red: { color: Theme.red },
  sky: { color: Theme.sky },
  path: { fontFamily: MONO, fontSize: TextSize.caption, color: Theme.text },
  body: { fontSize: TextSize.body, color: Theme.text },
  rule: { height: 1, marginVertical: 4, backgroundColor: faded("border", 1) },
});
