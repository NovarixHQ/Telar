import type { InboxPolicy, Session } from "@telar/engine-client";
import { EngineStateError } from "../../platform/kernel";
import { indexRow, rowIsShelved, type SessionIndex, type SessionRecords } from "../sessions";

export type AttachedTerminals = {
  openCount(sessionId: string): number;
  openSessions(): string[];
  /** `by` is "person" only when the person asked; Telar otherwise. */
  closeSession(sessionId: string, by?: "telar" | "person"): Promise<number>;
  /** Closes the session's terminals idle at a prompt: no process running in them and no input still unechoed. */
  closeIdle(sessionId: string): Promise<number>;
  /** The host's count per session, the person's shells included. Absent means this engine's own terminals are all there are. */
  sessionCounts?(): Promise<Record<string, number>>;
};

export type SessionTerminalsHost = {
  now(): number;
  inboxPolicy(): InboxPolicy;
  /** Writes the record without touching `updatedAt`: closing a settled session's terminals must not pull it off the shelf. */
  recordSession(session: Session): void;
};

/**
 * What the terminal host last said each session holds. Read when something changes (a settle or close,
 * one of the engine's own terminals opening or ending, the settled sweep) rather than per row or on a timer.
 */
export class SessionTerminals {
  private terminals?: AttachedTerminals;
  private census = new Map<string, number>();
  private censusTask?: Promise<void>;
  private censusAgain = false;

  constructor(
    private readonly records: SessionRecords,
    private readonly index: SessionIndex,
    private readonly host: SessionTerminalsHost,
  ) {}

  /** Absent means this store knows of no terminals: settling closes none, and nothing is held busy by one. */
  attach(terminals: AttachedTerminals): void {
    this.terminals = terminals;
  }

  get attached(): boolean {
    return this.terminals !== undefined;
  }

  openCount(sessionId: string): number {
    return this.terminals?.openCount(sessionId) ?? 0;
  }

  /** Callers in flight share one read, and one more if they arrived during it. */
  refresh(): Promise<void> {
    if (!this.terminals) return Promise.resolve();
    if (this.censusTask) {
      this.censusAgain = true;
      return this.censusTask;
    }
    this.censusTask = (async () => {
      do {
        this.censusAgain = false;
        const terminals = this.terminals!;
        let counts: Record<string, number>;
        try {
          counts = terminals.sessionCounts
            ? await terminals.sessionCounts()
            : Object.fromEntries(terminals.openSessions().map((sessionId) => [sessionId, terminals.openCount(sessionId)]));
        } catch {
          // The host is out of reach: what it last said stands.
          return;
        }
        this.apply(counts);
      } while (this.censusAgain);
    })().finally(() => {
      this.censusTask = undefined;
    });
    return this.censusTask;
  }

  private apply(counts: Record<string, number>): void {
    const changed = new Set<string>();
    for (const [sessionId, count] of this.census) if ((counts[sessionId] ?? 0) !== count) changed.add(sessionId);
    for (const [sessionId, count] of Object.entries(counts)) if ((this.census.get(sessionId) ?? 0) !== count) changed.add(sessionId);
    this.census = new Map(Object.entries(counts).filter(([, count]) => count > 0));
    // A count is on the row's answer, so a change must move its list's cursor or a conditional read calls it unchanged.
    const at = this.index.settlingClock();
    for (const sessionId of changed) {
      try {
        this.index.bumpRow(indexRow(this.records.get(sessionId)), at);
      } catch {
        // A session the host knows and this store does not is not on any list.
      }
    }
  }

  private sessions(): string[] {
    return [...new Set([...this.census.keys(), ...(this.terminals?.openSessions() ?? [])])];
  }

  /** How many terminals this session holds, whoever opened them; the engine's own records keep a run from being under-counted. */
  count(sessionId: string): number {
    return Math.max(this.census.get(sessionId) ?? 0, this.terminals?.openCount(sessionId) ?? 0);
  }

  /** The census for the rows of one answer: sessions with one or more, only. */
  countsFor(sessionIds: Iterable<string>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const sessionId of sessionIds) {
      const count = this.count(sessionId);
      if (count > 0) counts[sessionId] = count;
    }
    return counts;
  }

  /** What Settle would close, asked now; the answer also refreshes what the rail is told. */
  async countNow(sessionId: string): Promise<number> {
    this.records.get(sessionId);
    await this.refresh();
    return this.count(sessionId);
  }

  /** A settled row's "close them": recorded as the person's, so a watching agent is told on its next turn. */
  async closeForPerson(sessionId: string): Promise<number> {
    this.records.get(sessionId);
    if (!this.terminals) return 0;
    let closed: number;
    try {
      closed = await this.terminals.closeSession(sessionId, "person");
    } catch (error) {
      throw new EngineStateError("conflict", `Telar could not close this session's terminals: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.refresh();
    return closed;
  }

  /** A settle's close: idle shells go, a terminal still running something stays for the person. */
  async closeForSettle(sessionId: string): Promise<number> {
    let closed = 0;
    try {
      closed = (await this.terminals?.closeIdle(sessionId)) ?? 0;
    } catch {
      // The desktop's terminal host is out of reach. Quitting Telar closes every terminal it holds.
    }
    await this.refresh();
    return closed;
  }

  /** Archiving ends the session, so every terminal it holds goes. */
  async closeForArchive(sessionId: string): Promise<number> {
    let closed = 0;
    try {
      closed = (await this.terminals?.closeSession(sessionId)) ?? 0;
    } catch {
      // The desktop's terminal host is out of reach. Quitting Telar closes every terminal it holds.
    }
    await this.refresh();
    return closed;
  }

  /** Closes the idle terminals of every shelved session, the clock's settles included. Answers the sessions it closed any in. */
  async sweepSettled(): Promise<string[]> {
    if (!this.terminals) return [];
    await this.refresh();
    const at = { now: this.host.now(), autoSettleAfterHours: this.host.inboxPolicy().autoSettleAfterHours };
    const swept: string[] = [];
    for (const sessionId of this.sessions()) {
      try {
        if (!rowIsShelved(indexRow(this.records.get(sessionId)), at)) continue;
        const closed = await this.terminals.closeIdle(sessionId);
        if (closed <= 0) continue;
        this.host.recordSession({ ...this.records.get(sessionId), terminalsClosed: { at: this.host.now(), terminals: closed } });
        swept.push(sessionId);
      } catch {
        // A session that cannot be read, or a host out of reach, is left for the next tick.
      }
    }
    if (swept.length > 0) await this.refresh();
    return swept;
  }
}
