/** Unsent composer text per session (a fresh canvas keyed by project), kept in localStorage. */

const PREFIX = "telar:draft:";
/** Long enough for a real message, short of filling the quota with one key. */
const MAX_DRAFT = 20_000;

/** Just the shape used here, so a test can pass a Map without faking `Storage`. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Undefined during the server render or when the browser has storage disabled. */
function resolve(storage?: DraftStorage): DraftStorage | undefined {
  if (storage) return storage;
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** No session is a fresh canvas, keyed by project; a project-less session always has a session id. */
export function draftKey(sessionId: string | undefined, projectId: string | undefined): string {
  return `${PREFIX}${sessionId ?? `new:${projectId ?? "none"}`}`;
}

type Stored = { text: string; updatedAt: number };

/** Also reads the legacy bare-string shape, as text with no known age. */
function parse(raw: string | null): Stored | undefined {
  if (raw === null) return undefined;
  if (!raw.startsWith("{")) return raw.trim() ? { text: raw, updatedAt: 0 } : undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { text, updatedAt } = value as { text?: unknown; updatedAt?: unknown };
    if (typeof text !== "string" || !text.trim()) return undefined;
    return { text, updatedAt: typeof updatedAt === "number" ? updatedAt : 0 };
  } catch {
    return undefined;
  }
}

export function readDraft(
  sessionId: string | undefined,
  projectId: string | undefined,
  storage?: DraftStorage,
): string {
  const store = resolve(storage);
  if (!store) return "";
  try {
    return parse(store.getItem(draftKey(sessionId, projectId)))?.text ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(
  sessionId: string | undefined,
  projectId: string | undefined,
  draft: string,
  storage?: DraftStorage,
): void {
  const store = resolve(storage);
  if (!store) return;
  try {
    // An empty draft removes the key rather than leaving an empty entry behind.
    if (!draft.trim()) store.removeItem(draftKey(sessionId, projectId));
    else
      store.setItem(
        draftKey(sessionId, projectId),
        JSON.stringify({ text: draft.slice(0, MAX_DRAFT), updatedAt: Date.now() } satisfies Stored),
      );
  } catch {
    // A full or disabled localStorage must never break typing.
  }
}
