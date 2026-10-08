import { useRoute, type RouteProp } from "@react-navigation/native";
import { useRef, useState } from "react";
import { isActiveTurn } from "@telar/client/journal";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Text, type ScrollViewInstance } from "react-native";
import { FloatingComposer } from "../composer";
import { hosts, useHosts } from "../hosts";
import { transcriptRows, useFeed, type TranscriptRow } from "../transcript";
import { useRail } from "./use-rail";
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
  const scroll = useRef<ScrollViewInstance>(null);
  const [footer, setFooter] = useState(0);
  const rows = transcriptRows(feed.turns);
  const working = feed.turns.some((turn) => isActiveTurn(turn.state));
  const { rows: railRows } = useRail(params.hostId);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding" keyboardVerticalOffset={100}>
      <ScrollView ref={scroll} keyboardDismissMode="interactive" contentContainerStyle={[styles.content, { paddingBottom: footer + 16 }]} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {!feed.head && !feed.failed ? <ActivityIndicator style={styles.loading} /> : null}
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
        {feed.failed ? <Text style={[styles.tool, styles.failed]}>{feed.failed}</Text> : null}
      </ScrollView>
      <FloatingComposer host={host} hostId={params.hostId} sessionId={params.sessionId} head={feed.head} working={working} mentions={railRows} {...(params.draft ? { initialDraft: params.draft } : {})} onHeight={setFooter} onSent={() => scroll.current?.scrollToEnd()} />
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
});
