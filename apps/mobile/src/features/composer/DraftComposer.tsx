import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReadingColumn, useKeyboardShown } from "../../platform/layout";
import { Scrim } from "./chrome";
import { Composer } from "./Composer";
import { readDraft, writeDraft } from "./drafts";
import { composerSlot } from "./slot";

type Props = {
  /** Where the unsent text is kept: one draft per computer and project. */
  draftKey: { hostId: string; id: string } | undefined;
  placeholder: string;
  controls?: ReactNode;
  notices?: ReactNode;
  busy: boolean;
  /** Resolves true once the message is in; on false the text stays for another try. */
  onSend: (text: string) => Promise<boolean>;
};

/** The composer for a session that does not exist yet: the text, the model and access menus, and Send. */
export function DraftComposer({ draftKey, placeholder, controls, notices, busy, onSend }: Props) {
  const [draft, setDraft] = useState(() => (draftKey ? readDraft(Settings, draftKey.hostId, draftKey.id) : ""));
  const [caret, setCaret] = useState(draft.length);
  const [cleared, setCleared] = useState(0);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardShown();
  const slot = composerSlot({ draft, running: false, busy });
  const kept = useRef(draftKey);
  useEffect(() => {
    const previous = kept.current;
    kept.current = draftKey;
    if (!draftKey || (previous?.hostId === draftKey.hostId && previous.id === draftKey.id)) return;
    // Text typed before choosing a project moves with the choice; an empty box takes up that project's draft.
    if (draft) {
      if (previous) writeDraft(Settings, previous.hostId, previous.id, "");
    } else {
      const saved = readDraft(Settings, draftKey.hostId, draftKey.id);
      setDraft(saved);
      setCaret(saved.length);
    }
  }, [draftKey?.hostId, draftKey?.id]);
  useEffect(() => {
    if (kept.current) writeDraft(Settings, kept.current.hostId, kept.current.id, draft);
  }, [draft]);
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
