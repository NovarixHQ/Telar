import { useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import type { RequestDecision } from "@telar/engine-client";
import { isActiveTurn } from "@telar/client/journal";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Settings, StyleSheet, Text, type ScrollViewInstance } from "react-native";
import { Composer } from "../composer";
import { SessionControls } from "../providers";
import { hosts, useHosts } from "../hosts";
import { feedOf, sendMessage, transcriptRows, useFeed, type TranscriptRow } from "../transcript";
import { answerRequest, openRequests, RequestCards, stopSession } from "../turns";
import type { RootStack } from "../../platform/navigation/routes";

function Row({ row }: { row: TranscriptRow }) {
  switch (row.kind) {
    case "prompt":
      return <Text style={[styles.bubble, styles.prompt]}>{row.text}</Text>;
    case "reply":
      return <Text style={styles.reply}>{row.text}</Text>;
    case "tool":
      return <Text style={styles.tool}>{row.running ? "◌ " : "✓ "}{row.text}</Text>;
    case "status":
      return <Text style={[styles.tool, row.tone === "failed" ? styles.failed : styles.working]}>{row.text}</Text>;
  }
}

export function SessionScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Session">>();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const feed = useFeed(host, params.sessionId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string>();
  const scroll = useRef<ScrollViewInstance>(null);
  const [deciding, setDeciding] = useState<string>();
  const rows = transcriptRows(feed.turns);
  const working = feed.turns.some((turn) => isActiveTurn(turn.state));

  const act = async (work: () => Promise<unknown>, after?: () => void) => {
    setProblem(undefined);
    try {
      await work();
      after?.();
      if (host) await feedOf(host, params.sessionId)?.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const send = async (typed: string = draft) => {
    const text = typed.trim();
    if (!host || !text) return;
    setSending(true);
    await act(() => sendMessage(host, params.sessionId, text), () => setDraft(""));
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

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={100}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {!feed.head && !feed.failed ? <ActivityIndicator style={styles.loading} /> : null}
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
        {feed.failed ? <Text style={[styles.tool, styles.failed]}>{feed.failed}</Text> : null}
      </ScrollView>
      <RequestCards cards={openRequests(feed.head?.requests)} {...(deciding ? { deciding } : {})} onDecide={(id, decision) => void decide(id, decision)} />
      {problem ? <Text style={[styles.problem, styles.failed]}>{problem}</Text> : null}
      {host && feed.head ? <SessionControls host={host} session={feed.head.session} onChanged={(work) => void act(() => work)} /> : null}
      <Composer draft={draft} onDraft={setDraft} busy={sending} working={working} onSend={() => void send()} onStop={() => void stop()} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F2F2F7" },
  content: { padding: 16, gap: 10 },
  loading: { marginTop: 40 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, overflow: "hidden", fontSize: 16 },
  prompt: { alignSelf: "flex-end", maxWidth: "85%", backgroundColor: "#0A84FF", color: "white" },
  reply: { fontSize: 16, lineHeight: 22, color: "#1C1C1E" },
  tool: { fontSize: 13, color: "#6E6E73", fontFamily: "Menlo" },
  working: { color: "#0A84FF" },
  failed: { color: "#D70015" },
  problem: { paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 },
});
