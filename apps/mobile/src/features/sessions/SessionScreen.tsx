import { useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Settings, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { hosts, useHosts } from "../hosts";
import { feedOf, sendMessage, transcriptRows, useFeed, type TranscriptRow } from "../transcript";
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
  const rows = transcriptRows(feed.turns);

  const send = async (typed: string = draft) => {
    const text = typed.trim();
    if (!host || !text) return;
    setSending(true);
    setProblem(undefined);
    try {
      await sendMessage(host, params.sessionId, text);
      setDraft("");
      await feedOf(host, params.sessionId)?.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
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
      {problem ? <Text style={[styles.problem, styles.failed]}>{problem}</Text> : null}
      <View style={styles.composer}>
        <TextInput style={styles.input} placeholder="Message" value={draft} onChangeText={setDraft} multiline editable={!sending} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => void send()} disabled={sending || !draft.trim()} style={styles.send}>
          {sending ? <ActivityIndicator /> : <Text style={[styles.sendLabel, !draft.trim() && styles.disabled]}>↑</Text>}
        </Pressable>
      </View>
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
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, paddingBottom: 30, backgroundColor: "white" },
  input: { flex: 1, minHeight: 38, maxHeight: 140, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 16, backgroundColor: "#F2F2F7" },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#0A84FF" },
  sendLabel: { color: "white", fontSize: 20, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
