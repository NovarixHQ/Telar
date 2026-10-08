import { useEffect, useRef, useState } from "react";
import type { RequestDecision } from "@telar/engine-client";
import type { HydratedSession } from "@telar/client/journal";
import { Keyboard, Settings, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostConnection } from "../../platform/connection";
import { appendSpoken, useDictation, useDictationAvailable } from "../dictation";
import { SessionMenus, setAccessMode } from "../providers";
import { feedOf, sendMessage } from "../transcript";
import { answerRequest, openRequests, RequestCards, stopSession } from "../turns";
import { Scrim } from "./chrome";
import { completionsFor, type Completion, type MentionTarget } from "./completions";
import { Composer } from "./Composer";
import { readDraft, writeDraft } from "./drafts";
import { composerSlot } from "./slot";
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
  initialDraft?: string;
  onHeight: (height: number) => void;
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

/** The footer that floats over the transcript: open requests, then the composer, over a bar-material scrim. */
export function FloatingComposer({ host, hostId, sessionId, head, working, mentions, initialDraft, onHeight }: Props) {
  const [draft, setDraftState] = useState(() => initialDraft ?? readDraft(Settings, hostId, sessionId));
  const [caret, setCaret] = useState(draft.length);
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string>();
  const [problem, setProblem] = useState<string>();
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
  const send = async (typed: string = draft) => {
    const text = typed.trim();
    if (!host || !text) return;
    setSending(true);
    if (await act(() => sendMessage(host, sessionId, text))) setDraft("");
    setSending(false);
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
      style={[styles.footer, { marginTop: -height, paddingBottom: keyboard ? 8 : Math.max(8, insets.bottom) }]}
      onLayout={({ nativeEvent }) => (setHeight(nativeEvent.layout.height), onHeight(nativeEvent.layout.height))}
    >
      <Scrim />
      <RequestCards cards={openRequests(head?.requests)} {...(deciding ? { deciding } : {})} onDecide={(id, decision) => void decide(id, decision)} />
      {shownProblem ? <Text style={styles.problem} numberOfLines={2}>{shownProblem}</Text> : null}
      <Composer
        draft={draft}
        onDraft={setDraftState}
        onCaret={setCaret}
        placeholder="Ask the agent, or run a command…"
        slot={slot}
        onSlot={() => void (slot.kind === "stop" ? stop() : send())}
        controls={host && session ? <SessionMenus host={host} session={session} onChanged={(work) => void act(() => work)} /> : undefined}
        onCommands={() => setDraft(openingCommands(draft))}
        {...(working && slot.kind !== "stop" ? { onStop: () => void stop() } : {})}
        {...(dictationAvailable ? { dictation } : {})}
        {...(trigger ? { suggestions: { rows, loading: skills.loading && trigger.kind !== "mention", onPick: pick } } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  problem: { paddingHorizontal: 14, fontSize: 13, color: Theme.red },
});
