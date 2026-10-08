export type DraftStore = { get(key: string): unknown; set(values: Record<string, string>): void };

const keyOf = (hostId: string, sessionId: string) => `telar.draft.${hostId}.${sessionId}`;

/** The unsent text a session's composer last held on this phone. */
export function readDraft(store: DraftStore, hostId: string, sessionId: string): string {
  const value = store.get(keyOf(hostId, sessionId));
  return typeof value === "string" ? value : "";
}

/** Saves the box's text; a blank box stores the empty string, since the phone's settings ignore a null. */
export function writeDraft(store: DraftStore, hostId: string, sessionId: string, text: string): void {
  store.set({ [keyOf(hostId, sessionId)]: text.trim() ? text : "" });
}
