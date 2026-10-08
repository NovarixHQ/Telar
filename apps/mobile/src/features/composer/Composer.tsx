import { useRef, useState, type ReactNode } from "react";
import { PlatformColor, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import type { DictationPhase } from "../dictation";
import { MicButton, ROW, SlotButton } from "./buttons";
import { Glass } from "./chrome";
import type { Completion } from "./completions";
import { PlusMenu } from "./PlusMenu";
import type { Slot } from "./slot";
import { SuggestionList } from "./SuggestionList";
import { Radius, Theme } from "../../ui";

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  onCaret: (caret: number) => void;
  placeholder: string;
  slot: Slot;
  onSlot: () => void;
  controls?: ReactNode;
  onCommands: () => void;
  onStop?: () => void;
  dictation?: { phase: DictationPhase; toggle: () => void };
  suggestions?: { rows: Completion[]; loading: boolean; onPick: (row: Completion) => void };
};

const LINE = 21;
const MAX_LINES = 6;

/** The row the Swift app draws: plus menu, the glass field with its mic, and the send or stop circle. */
export function Composer({ draft, onDraft, onCaret, placeholder, slot, onSlot, controls, onCommands, onStop, dictation, suggestions }: Props) {
  const field = useRef<TextInputInstance>(null);
  const [contentHeight, setContentHeight] = useState(LINE);
  const listening = dictation?.phase === "recording";
  const strip = listening ? "Listening…" : dictation?.phase === "transcribing" ? "Transcribing…" : undefined;
  return (
    <View>
      {suggestions && (suggestions.rows.length > 0 || suggestions.loading) ? <SuggestionList {...suggestions} /> : null}
      <View style={styles.row}>
        <PlusMenu controls={controls} onCommands={() => (onCommands(), field.current?.focus())} {...(onStop ? { onStop } : {})} />
        <View style={styles.pill}>
          <Glass radius={Radius.composer} lifted />
          {strip ? <Text style={styles.strip} accessibilityLabel={listening ? "Listening" : strip}>{strip}</Text> : null}
          <View style={styles.line}>
            {draft ? null : (
              <Text style={[styles.placeholder, dictation && styles.placeholderBesideMic]} numberOfLines={1} pointerEvents="none" accessible={false}>
                {placeholder}
              </Text>
            )}
            <TextInput
              ref={field}
              style={[styles.input, { height: Math.min(Math.max(draft ? contentHeight : LINE, LINE), LINE * MAX_LINES) + 24 }, !dictation && styles.inputAlone]}
              accessibilityLabel={placeholder}
              value={draft}
              onChangeText={onDraft}
              onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
              onSelectionChange={(event) => onCaret(event.nativeEvent.selection.end)}
              multiline
            />
            {dictation ? <MicButton listening={listening} busy={dictation.phase === "transcribing"} onPress={dictation.toggle} /> : null}
          </View>
        </View>
        <SlotButton slot={slot} onPress={onSlot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  pill: { flex: 1, minHeight: ROW, borderRadius: Radius.composer },
  strip: { paddingHorizontal: 16, paddingTop: 10, fontSize: 13, color: Theme.textMuted },
  line: { flexDirection: "row", alignItems: "flex-end" },
  input: { flex: 1, paddingLeft: 16, paddingRight: 0, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: LINE, color: Theme.text },
  inputAlone: { paddingRight: 16 },
  placeholder: { position: "absolute", left: 16, right: 16, top: 12, fontSize: 16, lineHeight: LINE, color: PlatformColor("placeholderText") },
  placeholderBesideMic: { right: ROW },
});
