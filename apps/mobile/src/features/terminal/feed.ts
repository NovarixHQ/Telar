import type { RunStreamFrame, RunView } from "@telar/engine-client";
import { TerminalScreen } from "./screen";

export type FeedState = { text: string; dropped: boolean; terminal: RunView | undefined; failure: string | undefined };

type Schedule = (run: () => void, ms: number) => unknown;

const BATCH_MS = 80;

/** One terminal's output as React reads it: bytes are folded at once, but the text is published at most every 80ms. */
export class TerminalFeed {
  private screen = new TerminalScreen();
  private next = 0;
  private pending = false;
  private current: FeedState;
  private readonly listeners = new Set<() => void>();

  constructor(
    terminal: RunView | undefined,
    private readonly schedule: Schedule = setTimeout,
  ) {
    this.current = { text: "", dropped: false, terminal, failure: undefined };
  }

  get cursor(): number {
    return this.next;
  }

  state = (): FeedState => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  absorb(frame: RunStreamFrame): void {
    if (frame.type === "run.status") return this.set({ terminal: frame.run, failure: undefined });
    if (frame.cursor < this.next || frame.dropped > this.next) {
      this.screen = new TerminalScreen();
      if (this.current.dropped !== frame.dropped > 0) this.set({ dropped: frame.dropped > 0 });
    }
    this.screen.feed(frame.data);
    this.next = frame.cursor;
    if (this.current.failure) this.set({ failure: undefined });
    this.publish();
  }

  adopt(terminal: RunView): void {
    this.set({ terminal });
  }

  fail(error: unknown): void {
    this.set({ failure: error instanceof Error ? error.message : String(error) });
  }

  private publish(): void {
    if (this.pending) return;
    this.pending = true;
    this.schedule(() => {
      this.pending = false;
      const text = this.screen.text;
      if (text !== this.current.text) this.set({ text });
    }, BATCH_MS);
  }

  private set(patch: Partial<FeedState>): void {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
