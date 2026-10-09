import { useRef, useState, type ReactNode } from "react";
import { PlatformColor, Settings, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { CaretPill, type DictationPhase } from "../dictation";
import { MicButton, ROW, SlotButton } from "./buttons";
import { Glass } from "./chrome";
import type { Completion } from "./completions";
import { PlusMenu, type PlusMenuProps } from "./PlusMenu";
import type { Slot } from "./slot";
import { SuggestionList } from "./SuggestionList";
import { Radius, Theme } from "../../ui";

type Props = {
  draft: string;
  onDraft: (text: string) => void;
  caret: number;
  onCaret: (caret: number) => void;
  /** Changing it gives a fresh field: a multiline field emptied in code keeps its old height otherwise. */
  resetKey: number;
  placeholder: string;
  slot: Slot;
  onSlot: () => void;
  menu: PlusMenuProps;
  above?: ReactNode;
  below?: ReactNode;
  dictation?: { phase: DictationPhase; language: string | undefined; heard: string; toggle: () => void };
  suggestions?: { rows: Completion[]; loading: boolean; onPick: (row: Completion) => void };
};

// `-telarFocusOnOpen YES` at launch raises the keyboard on the field, so a simulator can show it without a tap.
const FOCUS_ON_OPEN = Boolean(Settings.get("telarFocusOnOpen"));
const LINE = 21;
const MAX_LINES = 6;

/** The row the Swift app draws: plus menu, the glass field with its mic, and the send or stop circle. */
export function Composer({ draft, caret, onDraft, onCaret, resetKey, placeholder, slot, onSlot, menu, above, below, dictation, suggestions }: Props) {
  const field = useRef<TextInputInstance>(null);
  const [caretAt, setCaretAt] = useState({ x: 0, y: 0 });
  const listening = dictation?.phase === "listening";
  const heard = dictation?.heard ?? "";
  return (
    <View>
      {suggestions && (suggestions.rows.length > 0 || suggestions.loading) ? <SuggestionList {...suggestions} /> : null}
      {above}
      <View style={styles.row}>
        <PlusMenu {...menu} onCommands={() => (menu.onCommands(), field.current?.focus())} />
        <View style={styles.pill}>
          <Glass radius={Radius.composer} lifted />
          {listening ? (
            <Text style={[styles.strip, heard ? styles.heard : null]} accessibilityLabel={heard ? `Heard: ${heard}` : "Listening"}>
              {heard || "Listening…"}
            </Text>
          ) : null}
          <View style={styles.line}>
            {draft ? null : (
              <Text style={[styles.placeholder, dictation && styles.placeholderBesideMic]} numberOfLines={1} pointerEvents="none" accessible={false}>
                {placeholder}
              </Text>
            )}
            <TextInput
              ref={field}
              key={resetKey}
              style={[styles.input, !dictation && styles.inputAlone]}
              accessibilityLabel={placeholder}
              value={draft}
              onChangeText={onDraft}
              onSelectionChange={(event) => onCaret(event.nativeEvent.selection.end)}
              autoFocus={FOCUS_ON_OPEN}
              multiline
            />
            {listening ? (
              <>
                <Text
                  style={styles.measure}
                  accessible={false}
                  onTextLayout={({ nativeEvent }) => {
                    const last = nativeEvent.lines.at(-1);
                    setCaretAt(last ? { x: last.x + last.width, y: last.y } : { x: 0, y: 0 });
                  }}
                >
                  {draft.slice(0, caret)}
                </Text>
                <CaretPill language={dictation.language} x={16 + Math.max(caretAt.x - 2, 0)} y={12 + Math.max(caretAt.y - 24, 0)} />
              </>
            ) : null}
            {dictation ? <MicButton listening={listening} busy={dictation.phase === "starting"} onPress={dictation.toggle} /> : null}
          </View>
        </View>
        <SlotButton slot={slot} onPress={onSlot} />
      </View>
      {below}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  pill: { flex: 1, minHeight: ROW, borderRadius: Radius.composer },
  strip: { paddingHorizontal: 16, paddingTop: 10, fontSize: 13, color: Theme.textMuted },
  heard: { color: Theme.accent },
  line: { flexDirection: "row", alignItems: "flex-end" },
  input: { flex: 1, maxHeight: LINE * MAX_LINES + 24, paddingLeft: 16, paddingRight: 0, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: LINE, color: Theme.text },
  inputAlone: { paddingRight: 16 },
  placeholder: { position: "absolute", left: 16, right: 16, top: 12, fontSize: 16, lineHeight: LINE, color: PlatformColor("placeholderText") },
  placeholderBesideMic: { right: ROW },
  measure: { position: "absolute", left: 16, right: ROW, top: 12, fontSize: 16, lineHeight: LINE, opacity: 0 },
});
