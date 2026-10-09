import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReadingColumn, useKeyboardShown } from "../../platform/layout";
import { Scrim } from "./chrome";
import { Composer } from "./Composer";
import { composerSlot } from "./slot";

type Props = {
  placeholder: string;
  controls?: ReactNode;
  notices?: ReactNode;
  busy: boolean;
  /** Resolves true once the message is in; on false the text stays for another try. */
  onSend: (text: string) => Promise<boolean>;
};

/** The composer for a session that does not exist yet: the text, the model and access menus, and Send. */
export function DraftComposer({ placeholder, controls, notices, busy, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [cleared, setCleared] = useState(0);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const slot = composerSlot({ draft, running: false, busy });
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !(await onSend(text))) return;
    setDraft("");
    setCleared((count) => count + 1);
  };
  return (
    <View style={[styles.footer, { paddingBottom: (keyboard ? 0 : insets.bottom) + 8 }]}>
      <Scrim />
      <ReadingColumn margins={16} style={styles.lane}>
        {notices}
        <Composer draft={draft} caret={caret} onDraft={setDraft} onCaret={setCaret} resetKey={cleared} placeholder={placeholder} slot={slot} onSlot={() => void send()} menu={{ controls }} />
      </ReadingColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingTop: 8 },
  lane: { gap: 8 },
});
