import { useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import type { RequestDecision } from "@telar/engine-client";
import { isActiveTurn } from "@telar/client/journal";
import { KeyboardAvoidingView, Pressable, Settings, StyleSheet, Text, View } from "react-native";
import { Composer } from "../composer";
import { appendSpoken, useDictation, useDictationAvailable } from "../dictation";
import { SessionControls } from "../providers";
import { hosts, useHosts } from "../hosts";
import { feedOf, sendMessage, StatusCard, Symbol, TextSize, Theme, TranscriptScroll, useFeed } from "../transcript";
import { answerRequest, openRequests, RequestCards, stopSession } from "../turns";
import { present } from "../../platform/connection";
import { useSessionHeader } from "./session-header";
import { useRail } from "./use-rail";
import type { RootStack } from "../../platform/navigation/routes";

function CardButton({ label, tone = Theme.text, onPress }: { label: string; tone?: typeof Theme.text; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text style={[styles.cardButton, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

export function SessionScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Session">>();
  const rows = useHosts(hosts);
  const host = hosts.get(params.hostId);
  const connection = rows.find((row) => row.connection === host)?.state;
  const feed = useFeed(host, params.sessionId);
  const [draft, setDraft] = useState(params.draft ?? "");
  const [sending, setSending] = useState(false);
  const [unsent, setUnsent] = useState<{ text: string; error: string }>();
  const [problem, setProblem] = useState<string>();
  const [pin, setPin] = useState(0);
  const [deciding, setDeciding] = useState<string>();
  const dictationAvailable = useDictationAvailable(host);
  const dictation = useDictation(host, (words) => setDraft((current) => appendSpoken(current, words)));
  const working = feed.turns.some((turn) => isActiveTurn(turn.state));
  const { rows: railRows } = useRail(params.hostId);
  const projectId = feed.head?.session.projectId;
  const mentions = { targets: railRows, current: { sessionId: params.sessionId, ...(projectId ? { projectId } : {}) } };

  const act = async (work: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await work();
      if (host) await feedOf(host, params.sessionId)?.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  useSessionHeader(host, params.sessionId, feed.head?.session, params.title, (work) => void act(work));

  const send = async (typed: string) => {
    const text = typed.trim();
    if (!host || !text) return;
    setSending(true);
    setUnsent(undefined);
    setDraft("");
    setPin((value) => value + 1);
    try {
      await sendMessage(host, params.sessionId, text);
      await feedOf(host, params.sessionId)?.refresh();
    } catch (error) {
      setUnsent({ text, error: error instanceof Error ? error.message : String(error) });
    }
    setSending(false);
  };

  const stop = async () => {
    if (!host) return;
    setSending(true);
    await act(() => stopSession(host, params.sessionId));
    setSending(false);
  };

  const decide = async (requestId: string, decision: RequestDecision) => {
    if (!host) return;
    setDeciding(requestId);
    await act(() => answerRequest(host, params.sessionId, requestId, decision));
    setDeciding(undefined);
  };

  // `-telarSendOnOpen <text>` at launch sends it once the session has loaded, so a simulator can test sending without a tap.
  const sentOnOpen = useRef(false);
  useEffect(() => {
    const text: unknown = Settings.get("telarSendOnOpen");
    if (sentOnOpen.current || !feed.head || typeof text !== "string" || !text) return;
    sentOnOpen.current = true;
    void send(text);
  });

  const offline = connection && connection.kind !== "online" && connection.kind !== "connecting" ? present(connection, Date.now()).label : undefined;
  const lost = offline ?? feed.failed;
  const failure = problem ?? dictation.problem;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={100}>
      <TranscriptScroll
        turns={feed.turns}
        loading={!feed.head && !feed.failed}
        pin={pin}
        older={feed.hasOlder ? { loading: Boolean(feed.loadingOlder), load: () => void feedOf(host, params.sessionId)?.loadOlder() } : undefined}
      />
      <View style={styles.footer}>
        {lost ? (
          <StatusCard tint={Theme.amber}>
            <View style={styles.cardRow}>
              <Symbol name="wifi.exclamationmark" size={TextSize.caption} color={Theme.amber} />
              <Text style={[styles.cardText, { color: Theme.amber }]} numberOfLines={2}>{feed.head ? `Showing what was recorded — ${lost}` : lost}</Text>
              <CardButton label="Retry" onPress={() => {
                host?.wake("reconnect");
                void feedOf(host, params.sessionId)?.refresh();
              }} />
            </View>
          </StatusCard>
        ) : null}
        <RequestCards cards={openRequests(feed.head?.requests)} {...(deciding ? { deciding } : {})} onDecide={(id, decision) => void decide(id, decision)} />
        {unsent ? (
          <StatusCard tint={Theme.red}>
            <View style={styles.cardRow}>
              <Text style={[styles.cardText, { color: Theme.red }]} numberOfLines={2}>{`Not sent — ${unsent.error}`}</Text>
              <CardButton label="Retry" onPress={() => void send(unsent.text)} />
              <CardButton label="Discard" tone={Theme.red} onPress={() => setUnsent(undefined)} />
            </View>
          </StatusCard>
        ) : null}
        {failure ? (
          <StatusCard tint={Theme.red}>
            <Text style={[styles.cardText, { color: Theme.red }]} numberOfLines={3}>{failure}</Text>
          </StatusCard>
        ) : null}
      </View>
      {host && feed.head ? <SessionControls host={host} session={feed.head.session} onChanged={(work) => void act(() => work)} /> : null}
      <Composer draft={draft} onDraft={setDraft} busy={sending} working={working} onSend={() => void send(draft)} onStop={() => void stop()} mentions={mentions} {...(dictationAvailable ? { dictation } : {})} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.canvas },
  footer: { gap: 12, paddingHorizontal: 16 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardText: { flex: 1, fontSize: TextSize.footnote },
  cardButton: { fontSize: TextSize.footnote, fontWeight: "500" },
});
