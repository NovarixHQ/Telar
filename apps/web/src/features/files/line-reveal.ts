const STALE_MS = 10_000;
const pending = new Map<string, { line: number; at: number }>();
const listeners = new Set<() => void>();

/** Asks the editor that shows `path` next to put the caret on `line`; call it before opening the file. */
export function revealLine(path: string, line: number): void {
  pending.set(path, { line, at: Date.now() });
  for (const listener of listeners) listener();
}

export function takeRevealedLine(path: string): number | undefined {
  const request = pending.get(path);
  pending.delete(path);
  return request && Date.now() - request.at < STALE_MS ? request.line : undefined;
}

export function subscribeRevealedLines(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return offset;
    offset = next + 1;
  }
  return offset;
}
