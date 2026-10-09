import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HostConnection } from "../../platform/connection";
import { ReadingColumn } from "../../platform/layout";
import { Theme } from "../../ui";
import { appendSpoken, useDictation, useDictationAvailable } from "../dictation";
import { AttachmentStrip } from "./AttachmentStrip";
import { Scrim } from "./chrome";
import { Composer } from "./Composer";
import { readDraft, writeDraft } from "./drafts";
import { composerSlot } from "./slot";
import { useDraftAttachments, type DraftFile } from "./use-draft-attachments";

type Props = {
  /** Points the keyboard covers at the bottom; the composer sits on top of it. */
  keyboard: number;
  /** The chosen project's computer: dictation listens through it. */
  host: HostConnection | undefined;
  /** Where the unsent text is kept: one draft per computer and project. */
  draftKey: { hostId: string; id: string } | undefined;
  placeholder: string;
  controls?: ReactNode;
  notices?: ReactNode;
  busy: boolean;
  /** Resolves true once the message is in; on false the text and files stay for another try. */
  onSend: (text: string, files: DraftFile[]) => Promise<boolean>;
};

/** The composer for a session that does not exist yet: the text, the model and access menus, and Send. */
export function DraftComposer({ keyboard, host, draftKey, placeholder, controls, notices, busy, onSend }: Props) {
  const [draft, setDraft] = useState(() => (draftKey ? readDraft(Settings, draftKey.hostId, draftKey.id) : ""));
  const [caret, setCaret] = useState(draft.length);
  const [cleared, setCleared] = useState(0);
  const insets = useSafeAreaInsets();
  const attachments = useDraftAttachments();
  const dictationAvailable = useDictationAvailable(host);
  const latest = useRef(draft);
  latest.current = draft;
  const dictation = useDictation(host, (words) => {
    latest.current = appendSpoken(latest.current, words);
    setDraft(latest.current);
  });
  const slot = composerSlot({ draft: appendSpoken(draft, dictation.heard), running: false, busy, hasImage: attachments.hasImage });
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
    if (dictation.phase === "listening") await dictation.finish();
    const text = latest.current.trim();
    if ((!text && !attachments.hasImage) || busy || !(await onSend(text, attachments.files))) return;
    setDraft("");
    attachments.clear();
    setCleared((count) => count + 1);
  };
  const note = attachments.note ?? dictation.problem;
  return (
    <View style={[styles.footer, { marginBottom: keyboard, paddingBottom: Math.max(insets.bottom - keyboard, 0) + 8 }]}>
      <Scrim />
      <ReadingColumn margins={16} style={styles.lane}>
        {notices}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <Composer
          draft={draft}
          caret={caret}
          onDraft={setDraft}
          onCaret={setCaret}
          resetKey={cleared}
          placeholder={placeholder}
          slot={slot}
          onSlot={() => void send()}
          menu={{ controls, onAttach: (kind) => void attachments.pick(kind) }}
          autoFocus
          above={attachments.files.length ? <AttachmentStrip rows={attachments.rows} uploading={false} onRemove={attachments.remove} /> : null}
          {...(dictationAvailable ? { dictation } : {})}
        />
      </ReadingColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingTop: 8 },
  lane: { gap: 8 },
  note: { paddingHorizontal: 14, fontSize: 13, color: Theme.textMuted },
});
