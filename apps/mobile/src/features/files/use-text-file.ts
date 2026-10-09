import type { WorkspaceFile } from "@telar/engine-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { readFileDraft, writeFile, writeFileDraft, type SaveState, type WriteRefusal } from "./save";

const AUTOSAVE_MS = 600;
const describe = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

/** One text file being read and edited: a draft kept on the phone, saved against the hash it was read at. Prose saves itself. */
export function useTextFile(host: HostConnection, sessionId: string, path: string, prose: boolean, onSaveState: (state: SaveState | undefined) => void) {
  const [file, setFile] = useState<WorkspaceFile>();
  const [error, setError] = useState<string>();
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refusal, setRefusal] = useState<WriteRefusal>();
  const [failure, setFailure] = useState<string>();
  const live = useRef({ text, dirty, baseline: undefined as string | undefined, saving: false });
  live.current.text = text;
  live.current.dirty = dirty;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const report = useRef(onSaveState);
  report.current = onSaveState;
  const stash = (next: string) => {
    const { baseline } = live.current;
    if (baseline) writeFileDraft(Settings, host.hostId, sessionId, path, { text: next, baseline });
  };
  const forget = () => writeFileDraft(Settings, host.hostId, sessionId, path, undefined);

  const read = useCallback(
    async (discardingDraft = false) => {
      try {
        const { file: fresh } = await host.call(true, () => host.client.sessionFile(sessionId, path));
        setFile(fresh);
        setError(undefined);
        const draft = discardingDraft ? undefined : readFileDraft(Settings, host.hostId, sessionId, path);
        if (discardingDraft) forget();
        if (draft && draft.text !== fresh.text) {
          live.current.baseline = draft.baseline;
          setText(draft.text);
          setDirty(true);
          setEditing(true);
          if (!prose) report.current("unsaved");
          return;
        }
        if (draft) forget();
        if (discardingDraft || draft || !live.current.dirty) {
          live.current.baseline = fresh.sha256;
          setText(fresh.text);
          setDirty(false);
          setRefusal(undefined);
          setFailure(undefined);
          report.current(undefined);
        }
      } catch (problem) {
        setError(describe(problem));
      }
    },
    [host, sessionId, path, prose],
  );

  const save = useCallback(async () => {
    const { baseline, dirty: unsaved, saving: busy, text: written } = live.current;
    if (!baseline || !unsaved || busy) return;
    live.current.saving = true;
    setSaving(true);
    report.current("saving");
    try {
      const result = await writeFile(host, sessionId, path, written, baseline);
      if (!result.written) {
        setRefusal(result.refusal);
        report.current("problem");
        return;
      }
      live.current.baseline = result.file.sha256;
      setFile(result.file);
      setRefusal(undefined);
      setFailure(undefined);
      if (live.current.text === written) {
        setDirty(false);
        live.current.dirty = false;
        forget();
        report.current(undefined);
      } else {
        stash(live.current.text);
        if (prose) timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
        else report.current("unsaved");
      }
    } catch (problem) {
      setFailure(describe(problem));
      report.current("problem");
    } finally {
      live.current.saving = false;
      setSaving(false);
    }
  }, [host, sessionId, path, prose]);

  const edit = (next: string) => {
    if (!file) return;
    setText(next);
    live.current.text = next;
    const changed = next !== file.text || (prose && live.current.dirty);
    setDirty(changed);
    live.current.dirty = changed;
    if (!changed) {
      forget();
      live.current.baseline = file.sha256;
      report.current(undefined);
      return;
    }
    stash(next);
    if (!prose) return report.current("unsaved");
    clearTimeout(timer.current);
    report.current("saving");
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
  };

  useEffect(() => {
    void read();
  }, [read]);

  useEffect(
    () => () => {
      if (!prose || !timer.current) return;
      clearTimeout(timer.current);
      const { baseline, dirty: unsaved, text: written } = live.current;
      if (baseline && unsaved) void writeFile(host, sessionId, path, written, baseline).catch(() => {});
    },
    [host, sessionId, path, prose],
  );

  return { file, error, text, dirty, saving, editing, refusal, failure, edit, save, setEditing, reread: () => void read(true) };
}
