import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { applyMention, mentionCandidates, mentionQuery, type MentionTarget } from "./mentions";

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  busy: boolean;
  working: boolean;
  onSend: () => void;
  onStop: () => void;
  dictation?: { phase: "idle" | "recording" | "transcribing"; toggle: () => void };
  mentions: { targets: readonly MentionTarget[]; current: { sessionId: string; projectId?: string } };
};

/** Send while a turn runs steers it; the button becomes Stop only while the box is empty. */
export function Composer({ draft, onDraft, busy, working, onSend, onStop, mentions, dictation }: Props) {
  const empty = !draft.trim();
  const stop = working && empty;
  const typing = mentionQuery(draft);
  const suggestions = typing ? mentionCandidates(mentions.targets, typing.query, mentions.current) : [];
  return (
    <View>
      {typing && suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((target) => (
            <Pressable key={target.sessionId} accessibilityRole="button" onPress={() => onDraft(applyMention(draft, typing, target))} style={styles.suggestion}>
              <Text style={styles.suggestionTitle} numberOfLines={1}>{target.title}</Text>
              {target.projectName ? <Text style={styles.suggestionProject}>{target.projectName}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composer}>
        <TextInput style={styles.input} placeholder="Message" value={draft} onChangeText={onDraft} multiline editable={!busy} />
        {dictation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dictation.phase === "recording" ? "Stop dictating" : "Dictate"}
            onPress={dictation.toggle}
            disabled={dictation.phase === "transcribing"}
            style={[styles.mic, dictation.phase === "recording" && styles.micOn]}
          >
            {dictation.phase === "transcribing" ? <ActivityIndicator /> : <Text style={[styles.micLabel, dictation.phase === "recording" && styles.micLabelOn]}>{dictation.phase === "recording" ? "■" : "🎙"}</Text>}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stop ? "Stop" : working ? "Queue" : "Send"}
          onPress={stop ? onStop : onSend}
          disabled={busy || (empty && !stop)}
          style={[styles.button, stop && styles.stop]}
        >
          {busy ? <ActivityIndicator color="white" /> : <Text style={[styles.label, empty && !stop && styles.disabled]}>{stop ? "■" : "↑"}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  suggestions: { backgroundColor: "white", borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#D1D1D6" },
  suggestion: { paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#E5E5EA" },
  suggestionTitle: { fontSize: 15, color: "#1C1C1E" },
  suggestionProject: { fontSize: 12, color: "#8E8E93" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, paddingBottom: 30, backgroundColor: "white" },
  input: { flex: 1, minHeight: 38, maxHeight: 140, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 16, backgroundColor: "#F2F2F7" },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#0A84FF" },
  stop: { backgroundColor: "#D70015" },
  label: { color: "white", fontSize: 18, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  mic: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#F2F2F7" },
  micOn: { backgroundColor: "#FFE5E5" },
  micLabel: { fontSize: 17 },
  micLabelOn: { color: "#D70015" },
});
