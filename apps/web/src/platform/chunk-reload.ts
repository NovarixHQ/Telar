const RELOADED_AT_KEY = "telar:chunk-reload-at";
const LOOP_GUARD_MS = 30_000;

const CHUNK_MESSAGE = /Loading (CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_MESSAGE.test(error.message);
}

type ReloadDeps = { storage?: Pick<Storage, "getItem" | "setItem">; now?: number; reload?: () => void };

/** Reloads the window once so a rebuilt server's chunks are fetched; false when it already did so within the guard window. */
export function reloadForNewBuild({ storage = window.sessionStorage, now = Date.now(), reload = () => window.location.reload() }: ReloadDeps = {}): boolean {
  const last = Number(storage.getItem(RELOADED_AT_KEY) ?? 0);
  if (now - last < LOOP_GUARD_MS) return false;
  storage.setItem(RELOADED_AT_KEY, String(now));
  reload();
  return true;
}
