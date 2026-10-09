import type { WorkspaceWriteResult } from "@telar/engine-client";
import type { HostConnection } from "../../platform/connection";

export type SaveState = "unsaved" | "saving" | "problem";
export type WriteRefusal = Extract<WorkspaceWriteResult, { written: false }>["refusal"];

/** Writes only if the file on disk still hashes to `baseline`; otherwise the engine refuses with `conflict`. */
export function writeFile(host: HostConnection, sessionId: string, path: string, text: string, baseline: string): Promise<WorkspaceWriteResult> {
  return host.call(false, () => host.client.writeSessionFile(sessionId, path, text, baseline));
}

export function refusalCopy(refusal: WriteRefusal): string {
  switch (refusal) {
    case "conflict":
      return "This file changed on disk while you were editing — most likely the agent wrote it. Your text has not been saved.";
    case "not_found":
      return "This file is no longer there. It was moved or deleted while you had it open.";
    case "binary":
      return "The engine reports this file as binary, so there is no text to save back.";
    case "too_large":
      return "This file is too large for the panel to save safely — it was only partly read, and writing it back would drop the rest.";
  }
}

export type Draft = { text: string; baseline: string };
type DraftStore = { get(key: string): unknown; set(values: Record<string, string>): void };

const draftKey = (hostId: string, sessionId: string, path: string) => `telar.fileDraft.${hostId}.${sessionId}.${path}`;

/** Unsaved text kept on the phone, with the hash it was edited from, so a relaunch can restore it. */
export function readFileDraft(store: DraftStore, hostId: string, sessionId: string, path: string): Draft | undefined {
  const raw = store.get(draftKey(hostId, sessionId, path));
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const draft = JSON.parse(raw) as Partial<Draft>;
    return typeof draft.text === "string" && typeof draft.baseline === "string" ? { text: draft.text, baseline: draft.baseline } : undefined;
  } catch {
    return undefined;
  }
}

/** An undefined draft clears the slot; the phone's settings ignore a null. */
export function writeFileDraft(store: DraftStore, hostId: string, sessionId: string, path: string, draft: Draft | undefined): void {
  store.set({ [draftKey(hostId, sessionId, path)]: draft ? JSON.stringify(draft) : "" });
}
