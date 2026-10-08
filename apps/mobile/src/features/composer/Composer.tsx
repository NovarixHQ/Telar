import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  busy: boolean;
  working: boolean;
  onSend: () => void;
  onStop: () => void;
};

/** Send while a turn runs steers it; the button becomes Stop only while the box is empty. */
export function Composer({ draft, onDraft, busy, working, onSend, onStop }: Props) {
  const empty = !draft.trim();
  const stop = working && empty;
  return (
    <View style={styles.composer}>
      <TextInput style={styles.input} placeholder="Message" value={draft} onChangeText={onDraft} multiline editable={!busy} />
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
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, paddingBottom: 30, backgroundColor: "white" },
  input: { flex: 1, minHeight: 38, maxHeight: 140, borderRadius: 19, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, fontSize: 16, backgroundColor: "#F2F2F7" },
  button: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#0A84FF" },
  stop: { backgroundColor: "#D70015" },
  label: { color: "white", fontSize: 18, fontWeight: "700" },
  disabled: { opacity: 0.4 },
});
