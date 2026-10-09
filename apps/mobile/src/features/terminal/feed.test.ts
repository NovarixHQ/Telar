import { describe, expect, test } from "bun:test";
import type { RunView } from "@telar/engine-client";
import { takeFrames } from "./events";
import { TerminalFeed } from "./feed";

const run = (patch: Partial<RunView> = {}): RunView => ({
  terminalId: "t1",
  runId: "t1",
  projectId: "p",
  sessionId: "s",
  origin: "run",
  title: "zsh",
  configName: "zsh",
  command: "zsh",
  worktreePath: "/w",
  cwd: "/w",
  status: "running",
  activity: "idle",
  readiness: { kind: "none" },
  startedAt: 1,
  env: [],
  ...patch,
});

function manual() {
  const queued: (() => void)[] = [];
  return { schedule: (task: () => void) => queued.push(task), flush: () => queued.splice(0).forEach((task) => task()) };
}

const bytes = (data: string, cursor: number, dropped = 0) => ({ type: "run.bytes" as const, data, cursor, dropped });

describe("TerminalFeed", () => {
  test("publishes many byte frames as one update", () => {
    const clock = manual();
    const feed = new TerminalFeed(run(), clock.schedule);
    let updates = 0;
    feed.subscribe(() => (updates += 1));
    for (let index = 0; index < 50; index += 1) feed.absorb(bytes("x", index + 1));
    expect(feed.state().text).toBe("");
    clock.flush();
    expect(feed.state().text).toBe("x".repeat(50));
    expect(updates).toBe(1);
    expect(feed.cursor).toBe(50);
  });

  test("starts over and says so when the engine dropped what it had not sent", () => {
    const clock = manual();
    const feed = new TerminalFeed(run(), clock.schedule);
    feed.absorb(bytes("old\n", 4));
    feed.absorb(bytes("new\n", 30, 20));
    clock.flush();
    expect(feed.state()).toMatchObject({ text: "new\n", dropped: true });
  });

  test("a status frame replaces the terminal at once", () => {
    const feed = new TerminalFeed(run(), manual().schedule);
    feed.absorb({ type: "run.status", projectId: "p", sessionId: "s", run: run({ status: "exited", exitCode: 2 }) });
    expect(feed.state().terminal?.status).toBe("exited");
  });
});

describe("takeFrames", () => {
  test("reads data lines and keeps an unfinished one for the next chunk", () => {
    const first = takeFrames(`event: x\ndata: ${JSON.stringify(bytes("hi", 2))}\n\ndata: {"type":"run.by`);
    expect(first.frames).toEqual([bytes("hi", 2)]);
    const second = takeFrames(`${first.rest}tes","data":"!","cursor":3,"dropped":0}\n: ping\ndata: {"type":"other"}\n`);
    expect(second.frames).toEqual([bytes("!", 3)]);
    expect(second.rest).toBe("");
  });
});
