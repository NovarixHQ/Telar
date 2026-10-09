import type { RouteReason } from "../../../modules/dictation-audio";
import { SOCKET_ENDED, TranscriptionRefused } from "./grant";
import type { Live } from "./live";
import type { Words } from "./strip";

export type AudioEvent = { type: "route"; reason: RouteReason } | { type: "interruption"; began: boolean } | { type: "reset" };

type Capture = { rebuild(): Promise<void>; stop(): Promise<void> };

type SocketEvents = { words: (words: Words) => void; ended: () => void };

type Deps = {
  capture: Capture;
  open: (on: SocketEvents) => Promise<Live>;
  words: (words: Words) => void;
  /** Writes the interim words into the draft before a new socket starts its own phrases. */
  flush: () => void;
  /** Listening stopped on its own; the reason is shown to the person. */
  ended: (problem: unknown) => void;
  now: () => number;
};

export const MIC_LOST = "Dictation stopped because the microphone went away. Tap the mic to start again.";
export const NO_ROUTE = "Dictation stopped because no microphone is available on this audio route.";

const SILENT_MS = 3_000;
const KEEP_ALIVE_MS = 4_000;
// A category change is our own session claim; acting on it would rebuild in a loop.
const IGNORED: ReadonlySet<RouteReason> = new Set(["categoryChange", "unknown"]);

const idle = Promise.resolve();

/**
 * One dictation from the first word to Stop. A route change or the end of an interruption taps the microphone again
 * while the socket and the words already heard stay; audio that stops arriving is retried once, then reported.
 */
export class Listening {
  private live: Live | undefined;
  private held: ArrayBuffer[] = [];
  private paused = false;
  private rebuilding: Promise<void> | undefined;
  private again = false;
  private heardAt: number;
  private triedAt = 0;
  private keptAt = 0;
  private nudged = false;
  private retried = false;
  private done = false;

  constructor(private readonly deps: Deps) {
    this.heardAt = deps.now();
  }

  /** Opens the first socket; audio that arrives before it opens is held. */
  begin(): Promise<void> {
    return this.attach();
  }

  audio(chunk: ArrayBuffer): void {
    if (this.done) return;
    this.heardAt = this.deps.now();
    this.nudged = false;
    if (this.live) this.live.send(chunk);
    else this.held.push(chunk);
  }

  event(event: AudioEvent): Promise<void> {
    if (this.done) return idle;
    if (event.type === "interruption") {
      if (!event.began) return this.rebuild();
      this.paused = true;
      return idle;
    }
    if (event.type === "route" && event.reason === "noSuitableRouteForCategory") return (this.stop(new Error(NO_ROUTE)), idle);
    if (event.type === "route" && IGNORED.has(event.reason)) return idle;
    return this.paused ? idle : this.rebuild();
  }

  /** Called about once a second: keeps a quiet socket open and notices a microphone that went deaf. */
  tick(): Promise<void> {
    if (this.done || this.rebuilding) return idle;
    const now = this.deps.now();
    if (now - Math.max(this.heardAt, this.keptAt) >= KEEP_ALIVE_MS) {
      this.live?.keepAlive();
      this.keptAt = now;
    }
    if (now - Math.max(this.heardAt, this.triedAt) < SILENT_MS) return idle;
    if (this.paused) return this.rebuild();
    if (this.nudged) return (this.stop(new Error(MIC_LOST)), idle);
    this.nudged = true;
    return this.rebuild();
  }

  async finish(): Promise<void> {
    if (this.done) return;
    this.done = true;
    void this.deps.capture.stop();
    await this.live?.finish();
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    void this.deps.capture.stop();
    this.live?.cancel();
  }

  private stop(problem: unknown): void {
    if (this.done) return;
    this.cancel();
    this.deps.ended(problem);
  }

  // Route changes arrive in bursts; one rebuild runs at a time and the last request runs after it.
  // While another app holds the microphone (a call, Siri) a failed rebuild keeps waiting instead of stopping.
  private rebuild(): Promise<void> {
    if (this.rebuilding) {
      this.again = true;
      return this.rebuilding;
    }
    const run = async () => {
      do {
        this.again = false;
        this.triedAt = this.deps.now();
        try {
          await this.deps.capture.rebuild();
          this.paused = false;
        } catch {
          if (!this.paused) return this.stop(new Error(MIC_LOST));
        }
      } while (this.again && !this.done);
    };
    this.rebuilding = run().finally(() => (this.rebuilding = undefined));
    return this.rebuilding;
  }

  private socketEvents(): SocketEvents {
    return {
      words: (words) => {
        this.retried = false;
        this.deps.words(words);
      },
      ended: () => void this.reopen(),
    };
  }

  private async attach(): Promise<void> {
    const live = await this.deps.open(this.socketEvents());
    if (this.done) return live.cancel();
    this.live = live;
    for (const chunk of this.held.splice(0)) live.send(chunk);
  }

  private async reopen(): Promise<void> {
    if (this.done) return;
    if (this.retried) return this.stop(new TranscriptionRefused(SOCKET_ENDED));
    this.retried = true;
    this.live = undefined;
    this.deps.flush();
    try {
      await this.attach();
    } catch (error) {
      this.stop(error);
    }
  }
}
