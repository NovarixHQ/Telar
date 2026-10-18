import type { ShellFrame } from "@telar/engine-client";
import { agentEnv } from "../../platform/process/agent-env";
import type { PtyHost, TerminalActivity, TerminalEnding, TerminalFacts, TerminalOpened, TerminalOpenRequest } from "./pty-host";

type Shell = {
  chunks: string[];
  chars: number;
  dropped: number;
  followers: Set<(frame: ShellFrame) => void>;
  ending?: TerminalEnding;
};

const RING_CHARS = 512_000;
const ENDED_KEEP_MS = 60_000;

export class ShellHub {
  private readonly shells = new Map<string, Shell>();

  constructor(private readonly host: PtyHost) {}

  async open(request: Omit<TerminalOpenRequest, "origin" | "env">): Promise<TerminalOpened> {
    const shell: Shell = { chunks: [], chars: 0, dropped: 0, followers: new Set() };
    const opened = await this.host.open(
      { ...request, origin: "user", env: agentEnv() },
      {
        data: (chunk) => this.keep(shell, chunk),
        ending: (ending) => this.end(shell, ending),
      },
    );
    if (opened.ending) return opened;
    this.shells.set(opened.id, shell);
    return opened;
  }

  list(sessionId?: string): TerminalFacts[] {
    return this.host.list().filter((terminal) => terminal.origin === "user" && this.shells.has(terminal.id) && (sessionId === undefined || terminal.sessionId === sessionId));
  }

  active(ids?: string[]): Promise<TerminalActivity[]> {
    return this.host.active(ids);
  }

  write(id: string, data: string): boolean {
    return this.owns(id) && this.host.write(id, data);
  }

  resize(id: string, cols: number, rows: number): boolean {
    return this.owns(id) && this.host.resize(id, cols, rows);
  }

  kill(id: string, signal?: NodeJS.Signals): boolean {
    return this.owns(id) && this.host.kill(id, signal);
  }

  async close(id: string): Promise<boolean> {
    return this.owns(id) && (await this.host.close(id));
  }

  follow(id: string, after: number, send: (frame: ShellFrame) => void): (() => void) | undefined {
    const shell = this.shells.get(id);
    if (!shell) return undefined;
    const skip = Math.max(0, after - shell.dropped);
    const missed = shell.chunks.slice(skip).join("");
    if (missed) send({ type: "data", data: missed, cursor: shell.dropped + shell.chunks.length });
    if (shell.ending) {
      send({ type: "exit", ending: shell.ending });
      return () => {};
    }
    shell.followers.add(send);
    return () => void shell.followers.delete(send);
  }

  private owns(id: string): boolean {
    const shell = this.shells.get(id);
    return shell !== undefined && shell.ending === undefined;
  }

  private keep(shell: Shell, chunk: string): void {
    shell.chunks.push(chunk);
    shell.chars += chunk.length;
    while (shell.chunks.length > 1 && shell.chars > RING_CHARS) {
      shell.chars -= shell.chunks.shift()!.length;
      shell.dropped += 1;
    }
    const frame: ShellFrame = { type: "data", data: chunk, cursor: shell.dropped + shell.chunks.length };
    for (const follower of shell.followers) follower(frame);
  }

  private end(shell: Shell, ending: TerminalEnding): void {
    shell.ending = ending;
    for (const follower of shell.followers) follower({ type: "exit", ending });
    shell.followers.clear();
    setTimeout(() => this.shells.delete(ending.id), ENDED_KEEP_MS).unref?.();
  }

}
