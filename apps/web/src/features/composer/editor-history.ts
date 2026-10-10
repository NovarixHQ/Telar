type Snapshot = { text: string; caret: number };

const BURST_MS = 1000;
const LIMIT = 200;

/** The editor's own undo stack: it repaints while typing, which the browser's stack does not survive. */
export function editorHistory() {
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];
  let current: Snapshot = { text: "", caret: 0 };
  let burstAt = Number.NEGATIVE_INFINITY;

  const step = (from: Snapshot[], to: Snapshot[]): Snapshot | undefined => {
    const target = from.pop();
    if (!target) return undefined;
    to.push(current);
    current = target;
    burstAt = Number.NEGATIVE_INFINITY;
    return target;
  };

  return {
    reset(text: string) {
      past = [];
      future = [];
      current = { text, caret: text.length };
      burstAt = Number.NEGATIVE_INFINITY;
    },
    /** Keystrokes less than a second apart (`burst`) undo together. */
    record(text: string, caret: number, burst: boolean, now = Date.now()) {
      if (text === current.text) {
        current = { text, caret };
        return;
      }
      if (!(burst && now - burstAt < BURST_MS)) past = [...past.slice(-(LIMIT - 1)), current];
      future = [];
      current = { text, caret };
      burstAt = burst ? now : Number.NEGATIVE_INFINITY;
    },
    undo: () => step(past, future),
    redo: () => step(future, past),
  };
}
