export type StashedImage = { name: string; type: string; dataUrl: string };

export type StashEntry = { id: string; at: number; prompt: string; images: StashedImage[] };

export type StashStore = { get(key: string): unknown; set(values: Record<string, string>): void };

const KEY = "telar.promptStash.v1";
const LIMITS = { entries: 20, entryChars: 1_200_000, totalChars: 3_500_000 };

function weigh(entry: StashEntry): number {
  return entry.prompt.length + entry.images.reduce((sum, image) => sum + image.dataUrl.length, 0);
}

export function canStash(entry: StashEntry): boolean {
  return weigh(entry) <= LIMITS.entryChars;
}

/** Newest first, at most twenty, dropping the oldest until the whole stash fits. */
function fit(entries: StashEntry[]): StashEntry[] {
  const kept = entries.filter(canStash).slice(0, LIMITS.entries);
  let total = kept.reduce((sum, entry) => sum + weigh(entry), 0);
  while (kept.length > 1 && total > LIMITS.totalChars) total -= weigh(kept.pop()!);
  return kept;
}

export function readStash(store: StashStore): StashEntry[] {
  const raw = store.get(KEY);
  if (typeof raw !== "string") return [];
  try {
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) ? (rows as StashEntry[]) : [];
  } catch {
    return [];
  }
}

function commit(store: StashStore, next: StashEntry[]): StashEntry[] {
  const kept = fit(next);
  store.set({ [KEY]: JSON.stringify(kept) });
  return kept;
}

export function stashEntry(store: StashStore, entry: StashEntry): StashEntry[] {
  return commit(store, [entry, ...readStash(store)]);
}

export function dropEntry(store: StashStore, id: string): StashEntry[] {
  return commit(store, readStash(store).filter((entry) => entry.id !== id));
}

/** Takes an entry back into the box; images beyond `room` stay stashed under the same entry. */
export function takeEntry(store: StashStore, id: string, room: number): { prompt: string; images: StashedImage[]; left: number } | undefined {
  const current = readStash(store);
  const entry = current.find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  const images = entry.images.slice(0, Math.max(0, room));
  const rest = entry.images.slice(images.length);
  commit(store, rest.length === 0 ? current.filter((candidate) => candidate.id !== id) : current.map((candidate) => (candidate.id === id ? { ...candidate, prompt: "", images: rest } : candidate)));
  return { prompt: entry.prompt, images, left: rest.length };
}

/** The restored prompt goes after the draft, a blank line between them. */
export function appendPrompt(draft: string, prompt: string): string {
  if (!prompt) return draft;
  const before = draft.replace(/\s+$/, "");
  return before ? `${before}\n\n${prompt}` : prompt;
}

export function stashSummary(entry: StashEntry): string {
  const line = entry.prompt.split("\n").map((part) => part.trim()).find(Boolean);
  if (line) return line.length > 90 ? `${line.slice(0, 89)}…` : line;
  if (entry.images.length > 0) return entry.images.length === 1 ? "1 image" : `${entry.images.length} images`;
  return "Empty";
}

export function stashAgo(at: number, now: number = Date.now()): string {
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}
