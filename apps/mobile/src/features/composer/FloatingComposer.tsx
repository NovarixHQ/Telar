import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RequestDecision } from "@telar/engine-client";
import { Settings, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostConnection } from "../../platform/connection";
import { ReadingColumn } from "../../platform/layout";
import { Theme } from "../../ui";
import { appendSpoken, useDictation, useDictationAvailable } from "../dictation";
import { SessionMenus, setAccessMode } from "../providers";
import { feedOf, newRunId, sendMessage, useFeed } from "../transcript";
import { answerRequest, openRequests, promoteTurn, RequestCards, stopSession, withdrawTurn } from "../turns";
import { AttachmentStrip } from "./AttachmentStrip";
import { Scrim } from "./chrome";
import { completionsFor, type Completion, type MentionTarget } from "./completions";
import { Composer } from "./Composer";
import { readDraft, writeDraft } from "./drafts";
import { hasRunningTurn, queuedTurns } from "./queue";
import { QueueLine } from "./QueueLine";
import { SendFailedCard } from "./SendFailedCard";
import { composerSlot } from "./slot";
import { StashSheet } from "./StashSheet";
import { detectTrigger, openingCommands, replaceTrigger } from "./trigger";
import { useAttachments } from "./use-attachments";
import { useSessionSkills } from "./use-skills";
import { useStash } from "./use-stash";

type Props = {
  host: HostConnection | undefined;
  hostId: string;
  sessionId: string;
  mentions: readonly MentionTarget[];
  /** Session notices drawn above the request cards, such as a lost connection. */
  notices?: ReactNode;
  initialDraft?: string;
  /** Points the keyboard covers at the bottom; the footer sits on top of it. */
  keyboard: number;
  onHeight: (height: number) => void;
  onSent?: () => void;
};

const NO_SKILLS = { skills: [], commands: [] };
const PROMOTES = new Set(["claude", "codex"]);

/** The footer that floats over the transcript: notices, open requests, then the composer, over a bar-material scrim. */
export function FloatingComposer({ host, hostId, sessionId, mentions, notices, initialDraft, keyboard, onHeight, onSent }: Props) {
  const feed = useFeed(host, sessionId);
  const [draft, setDraftState] = useState(() => initialDraft ?? readDraft(Settings, hostId, sessionId));
  const [caret, setCaret] = useState(draft.length);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [unsent, setUnsent] = useState<{ text: string; ids: string[]; runId: string; error: string }>();
  const [cleared, setCleared] = useState(0);
  const insets = useSafeAreaInsets();
  const setDraft = (text: string) => {
    setDraftState(text);
    setCaret(text.length);
    if (!text) setCleared((count) => count + 1);
  };
  const attachments = useAttachments(host, hostId, sessionId);
  const stash = useStash(draft, setDraft, attachments);
  const dictationAvailable = useDictationAvailable(host);
  const latest = useRef(draft);
  latest.current = draft;
  const dictation = useDictation(host, (words) => {
    latest.current = appendSpoken(latest.current, words);
    setDraftState(latest.current);
  });
  useEffect(() => writeDraft(Settings, hostId, sessionId, draft), [draft, hostId, sessionId]);

  const session = feed.head?.session;
  const running = hasRunningTurn(feed.turns);
  const queued = queuedTurns(feed.turns);
  const trigger = dictation.phase === "listening" ? undefined : detectTrigger(draft, caret);
  const skills = useSessionSkills(host, sessionId, trigger !== undefined && trigger.kind !== "mention");
  const rows = trigger
    ? completionsFor(trigger, {
        busy: running,
        ...(session ? { runtimeMode: session.runtimeMode } : {}),
        skills: skills.skills ?? NO_SKILLS,
        targets: mentions,
        current: { sessionId, ...(session?.projectId ? { projectId: session.projectId } : {}) },
      })
    : [];
  const slot = composerSlot({ draft: appendSpoken(draft, dictation.heard), running, busy: sending, hasImage: attachments.hasImage, queued: queued.length });

  const act = async (work: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await work();
      if (host) await feedOf(host, sessionId)?.refresh();
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const deliver = async (text: string, ids: string[], runId: string) => {
    if (!host) return;
    setSending(true);
    try {
      await sendMessage(host, sessionId, text, ids, runId);
      setUnsent(undefined);
      attachments.clear();
      await feedOf(host, sessionId)?.refresh();
    } catch (error) {
      setUnsent({ text, ids, runId, error: error instanceof Error ? error.message : String(error) });
    }
    setSending(false);
  };
  const send = async (typed?: string) => {
    if (typed === undefined && dictation.phase === "listening") await dictation.finish();
    const text = (typed ?? latest.current).trim();
    const ids = attachments.pending.map((row) => row.attachment.id);
    if (!host || (!text && !attachments.hasImage)) return;
    setDraft("");
    onSent?.();
    await deliver(text, ids, unsent?.text === text ? unsent.runId : newRunId());
  };
  const stop = async () => {
    if (!host) return;
    setSending(true);
    await act(() => stopSession(host, sessionId));
    setSending(false);
  };
  const decide = async (requestId: string, decision: RequestDecision, reason?: string) => {
    if (!host) return;
    setDeciding(requestId);
    await act(() => answerRequest(host, sessionId, requestId, decision, reason));
    setDeciding(undefined);
  };
  const pick = (row: Completion) => {
    if (!trigger) return;
    const { action } = row;
    setDraft(replaceTrigger(draft, trigger, action.kind === "insert" ? `${action.text} ` : ""));
    if (action.kind === "stop") void stop();
    if (action.kind === "runtimeMode" && host) void act(() => setAccessMode(host, sessionId, action.mode));
  };

  // `-telarSendOnOpen <text>` at launch sends it once the session has loaded, so a simulator can test sending without a tap.
  const sentOnOpen = useRef(false);
  useEffect(() => {
    const text: unknown = Settings.get("telarSendOnOpen");
    if (sentOnOpen.current || !feed.head || typeof text !== "string" || !text) return;
    sentOnOpen.current = true;
    void send(text);
  });

  // `-telarDictateOnOpen <seconds>` listens for that long once the session has loaded, for the same reason.
  const dictatedOnOpen = useRef(false);
  useEffect(() => {
    const seconds = Number(Settings.get("telarDictateOnOpen"));
    if (dictatedOnOpen.current || !feed.head || !dictationAvailable || !(seconds > 0)) return;
    dictatedOnOpen.current = true;
    dictation.toggle();
    setTimeout(() => void dictation.finish(), seconds * 1000);
  });

  const controls = useMemo(() => (host && session ? <SessionMenus host={host} session={session} onChanged={(work) => void act(() => work)} /> : undefined), [host, session]);

  const shownProblem = problem ?? dictation.problem;
  return (
    <View
      style={[styles.footer, { bottom: keyboard, paddingBottom: Math.max(insets.bottom - keyboard, 0) + 8 }]}
      onLayout={({ nativeEvent }) => onHeight(nativeEvent.layout.height)}
    >
      <Scrim />
      <ReadingColumn margins={16} style={styles.lane}>
        {notices}
        <RequestCards cards={openRequests(feed.head?.requests)} {...(deciding ? { deciding } : {})} onDecide={(id, decision, reason) => void decide(id, decision, reason)} />
        {unsent ? <SendFailedCard error={unsent.error} onRetry={() => void deliver(unsent.text, unsent.ids, unsent.runId)} onDiscard={() => setUnsent(undefined)} /> : null}
        {shownProblem ? <Text style={[styles.note, styles.problem]} numberOfLines={2}>{shownProblem}</Text> : null}
        {attachments.note ? <Text style={styles.note}>{attachments.note}</Text> : null}
        <Composer
          draft={draft}
          caret={caret}
          onDraft={setDraftState}
          onCaret={setCaret}
          resetKey={cleared}
          placeholder="Ask the agent, or run a command…"
          slot={slot}
          onSlot={() => void (slot.kind === "stop" ? stop() : send())}
          onPasteFiles={attachments.paste}
          menu={{
            controls,
            onCommands: () => setDraft(openingCommands(draft)),
            onAttach: (kind) => void attachments.pick(kind),
            ...(stash.canStash ? { onStash: stash.stash } : {}),
            onShowStash: stash.show,
            ...(running && slot.kind !== "stop" ? { onStop: () => void stop() } : {}),
          }}
          above={attachments.pending.length || attachments.uploading ? <AttachmentStrip rows={attachments.pending} uploading={attachments.uploading} onRemove={attachments.remove} /> : null}
          below={
            queued.length && host ? (
              <QueueLine
                queued={queued}
                canPromote={running && PROMOTES.has(session?.driver ?? "claude")}
                onPromote={(runId) => void act(() => promoteTurn(host, sessionId, runId))}
                onWithdraw={(runId) => void act(() => withdrawTurn(host, sessionId, runId))}
              />
            ) : null
          }
          {...(dictationAvailable ? { dictation } : {})}
          {...(trigger ? { suggestions: { rows, loading: skills.loading && trigger.kind !== "mention", onPick: pick } } : {})}
        />
      </ReadingColumn>
      <StashSheet open={stash.open} entries={stash.entries} onClose={stash.close} onPick={stash.restore} onDrop={stash.drop} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { position: "absolute", left: 0, right: 0, paddingTop: 8 },
  lane: { gap: 8 },
  note: { paddingHorizontal: 14, fontSize: 13, color: Theme.textMuted },
  problem: { color: Theme.red },
});
