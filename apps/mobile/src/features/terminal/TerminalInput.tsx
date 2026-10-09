import { Host } from "@expo/ui/swift-ui";
import { memo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { faded, Icon, Radius, Theme } from "../../ui";
import { SPECIAL_KEYS, typedLine } from "./keys";

/** The keys row and the line being typed; the line lives here so a keystroke never redraws the output. */
export const TerminalInput = memo(function TerminalInput({ enabled, onWrite }: { enabled: boolean; onWrite: (data: string) => void }) {
  const [line, setLine] = useState("");
  const send = () => {
    onWrite(typedLine(line));
    setLine("");
  };
  return (
    <View style={[styles.bar, enabled ? null : styles.off]} pointerEvents={enabled ? "auto" : "none"}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.keys}>
        {SPECIAL_KEYS.map((key) => (
          <Pressable key={key.label} onPress={() => onWrite(key.data)} accessibilityRole="button" accessibilityLabel={key.name} style={({ pressed }) => [styles.key, pressed ? styles.pressed : null]}>
            <Text style={styles.keyLabel}>{key.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.row}>
        <Host matchContents>
          <Icon name="chevron.right" textStyle="caption" weight="semibold" color={Theme.textMuted} />
        </Host>
        <TextInput
          style={styles.field}
          value={line}
          onChangeText={setLine}
          onSubmitEditing={send}
          submitBehavior="submit"
          placeholder="Type into the terminal"
          placeholderTextColor={Theme.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="send"
          editable={enabled}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: faded("border", 0.6) },
  off: { opacity: 0.5 },
  keys: { gap: 6, paddingHorizontal: 12, paddingTop: 8 },
  key: { minWidth: 36, height: 30, paddingHorizontal: 10, borderRadius: Radius.control, backgroundColor: Theme.fill, alignItems: "center", justifyContent: "center" },
  pressed: { backgroundColor: Theme.subtleStrong },
  keyLabel: { fontFamily: "ui-monospace", fontSize: 13, fontWeight: "500", color: Theme.text },
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  field: { flex: 1, fontFamily: "ui-monospace", fontSize: 12, color: Theme.text, paddingVertical: 2 },
});
