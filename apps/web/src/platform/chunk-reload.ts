const RELOADED_AT_KEY = "telar:chunk-reload-at";
const LOOP_GUARD_MS = 30_000;

const CHUNK_MESSAGE = /Loading (CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_MESSAGE.test(error.message);
}

type ReloadDeps = { storage?: Pick<Storage, "getItem" | "setItem">; now?: number; reload?: () => void };

export function reloadIsDue({ storage = window.sessionStorage, now = Date.now() }: ReloadDeps = {}): boolean {
  return now - Number(storage.getItem(RELOADED_AT_KEY) ?? 0) >= LOOP_GUARD_MS;
}

export function reloadForNewBuild({ storage = window.sessionStorage, now = Date.now(), reload = () => window.location.reload() }: ReloadDeps = {}): void {
  storage.setItem(RELOADED_AT_KEY, String(now));
  reload();
}
