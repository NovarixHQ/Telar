import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RequestDecision } from "@telar/engine-client";
import type { HydratedSession } from "@telar/client/journal";
import { Keyboard, Settings, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostConnection } from "../../platform/connection";
import { appendSpoken, useDictation, useDictationAvailable } from "../dictation";
import { SessionMenus, setAccessMode } from "../providers";
import { feedOf, newRunId, sendMessage } from "../transcript";
import { answerRequest, openRequests, RequestCards, stopSession } from "../turns";
import { Scrim } from "./chrome";
import { completionsFor, type Completion, type MentionTarget } from "./completions";
import { Composer } from "./Composer";
import { readDraft, writeDraft } from "./drafts";
import { SendFailedCard } from "./SendFailedCard";
import { composerSlot } from "./slot";
import { ReadingColumn } from "../../platform/layout";
import { Theme } from "../../ui";
import { detectTrigger, openingCommands, replaceTrigger } from "./trigger";
import { useSessionSkills } from "./use-skills";

type Props = {
  host: HostConnection | undefined;
  hostId: string;
  sessionId: string;
  head: HydratedSession | undefined;
  working: boolean;
  mentions: readonly MentionTarget[];
  /** Session notices drawn above the request cards, such as a lost connection. */
  notices?: ReactNode;
  initialDraft?: string;
  onHeight: (height: number) => void;
  onSent?: () => void;
};

const NO_SKILLS = { skills: [], commands: [] };

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setShown(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setShown(false));
    return () => (show.remove(), hide.remove());
  }, []);
  return shown;
}

/** The footer that floats over the transcript: notices, open requests, then the composer, over a bar-material scrim. */
export function FloatingComposer({ host, hostId, sessionId, head, working, mentions, notices, initialDraft, onHeight, onSent }: Props) {
  const [draft, setDraftState] = useState(() => initialDraft ?? readDraft(Settings, hostId, sessionId));
  const [caret, setCaret] = useState(draft.length);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [unsent, setUnsent] = useState<{ text: string; runId: string; error: string }>();
  const [cleared, setCleared] = useState(0);
  const [height, setHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const dictationAvailable = useDictationAvailable(host);
  const setDraft = (text: string) => {
    setDraftState(text);
    setCaret(text.length);
  };
  const dictation = useDictation(host, (words) => setDraftState((current) => appendSpoken(current, words)));
  useEffect(() => writeDraft(Settings, hostId, sessionId, draft), [draft, hostId, sessionId]);

  const trigger = dictation.phase === "recording" ? undefined : detectTrigger(draft, caret);
  const skills = useSessionSkills(host, sessionId, trigger !== undefined && trigger.kind !== "mention");
  const session = head?.session;
  const rows = trigger
    ? completionsFor(trigger, {
        busy: working,
        ...(session ? { runtimeMode: session.runtimeMode } : {}),
        skills: skills.skills ?? NO_SKILLS,
        targets: mentions,
        current: { sessionId, ...(session?.projectId ? { projectId: session.projectId } : {}) },
      })
    : [];
  const slot = composerSlot(draft, working, sending);

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
  const deliver = async (text: string, runId: string) => {
    if (!host) return;
    setSending(true);
    try {
      await sendMessage(host, sessionId, text, runId);
      setUnsent(undefined);
      await feedOf(host, sessionId)?.refresh();
    } catch (error) {
      setUnsent({ text, runId, error: error instanceof Error ? error.message : String(error) });
    }
    setSending(false);
  };
  const send = async (typed: string = draft) => {
    const text = typed.trim();
    if (!host || !text) return;
    setDraft("");
    setCleared((count) => count + 1);
    onSent?.();
    await deliver(text, unsent?.text === text ? unsent.runId : newRunId());
  };
  const stop = async () => {
    if (!host) return;
    setSending(true);
    await act(() => stopSession(host, sessionId));
    setSending(false);
  };
  const decide = async (requestId: string, decision: RequestDecision) => {
    if (!host) return;
    setDeciding(requestId);
    await act(() => answerRequest(host, sessionId, requestId, decision));
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
    if (sentOnOpen.current || !head || typeof text !== "string" || !text) return;
    sentOnOpen.current = true;
    void send(text);
  });

  const shownProblem = problem ?? dictation.problem;
  return (
    <View
      style={[styles.footer, { marginTop: -height, paddingBottom: (keyboard ? 0 : insets.bottom) + 8 }]}
      onLayout={({ nativeEvent }) => (setHeight(nativeEvent.layout.height), onHeight(nativeEvent.layout.height))}
    >
      <Scrim />
      <ReadingColumn margins={16} style={styles.lane}>
        {notices}
        <RequestCards cards={openRequests(head?.requests)} {...(deciding ? { deciding } : {})} onDecide={(id, decision) => void decide(id, decision)} />
        {unsent ? <SendFailedCard error={unsent.error} onRetry={() => void deliver(unsent.text, unsent.runId)} onDiscard={() => setUnsent(undefined)} /> : null}
        {shownProblem ? <Text style={styles.problem} numberOfLines={2}>{shownProblem}</Text> : null}
        <Composer
          draft={draft}
          onDraft={setDraftState}
          onCaret={setCaret}
          resetKey={cleared}
          placeholder="Ask the agent, or run a command…"
          slot={slot}
          onSlot={() => void (slot.kind === "stop" ? stop() : send())}
          controls={host && session ? <SessionMenus host={host} session={session} onChanged={(work) => void act(() => work)} /> : undefined}
          onCommands={() => setDraft(openingCommands(draft))}
          {...(working && slot.kind !== "stop" ? { onStop: () => void stop() } : {})}
          {...(dictationAvailable ? { dictation } : {})}
          {...(trigger ? { suggestions: { rows, loading: skills.loading && trigger.kind !== "mention", onPick: pick } } : {})}
        />
      </ReadingColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingTop: 8 },
  lane: { gap: 8 },
  problem: { paddingHorizontal: 14, fontSize: 13, color: Theme.red },
});
