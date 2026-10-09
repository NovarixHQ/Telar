import { describe, expect, test } from "bun:test";
import type { RunView } from "@telar/engine-client";
import { pickTerminal, statusDetail, statusLabel, statusTone, upsertTerminal } from "./terminals";

const run = (terminalId: string, patch: Partial<RunView> = {}): RunView =>
  ({ terminalId, runId: terminalId, title: terminalId, command: "zsh", status: "running", activity: "idle", startedAt: 1, ...patch }) as RunView;

describe("terminals", () => {
  test("upsert replaces by id and keeps the newest first", () => {
    const list = upsertTerminal([run("a", { startedAt: 1 }), run("b", { startedAt: 2 })], run("a", { startedAt: 1, status: "exited" }));
    expect(list.map((one) => [one.terminalId, one.status])).toEqual([["b", "running"], ["a", "exited"]]);
    expect(upsertTerminal(list, run("c", { startedAt: 3 }))[0]?.terminalId).toBe("c");
  });

  test("shows the one asked for, else the newest open one", () => {
    const list = [run("closed", { status: "closed" }), run("open")];
    expect(pickTerminal(list, "closed")?.terminalId).toBe("closed");
    expect(pickTerminal(list, "gone")?.terminalId).toBe("open");
    expect(pickTerminal([], undefined)).toBeUndefined();
  });

  test("labels read like the iPhone app", () => {
    expect(statusLabel(run("a"))).toBe("Idle");
    expect(statusLabel(run("a", { lastExit: { exitCode: 1, at: 1 } }))).toBe("Idle · exit 1");
    expect(statusLabel(run("a", { activity: "busy" }))).toBe("Running");
    expect(statusLabel(run("a", { status: "exited", exitCode: 130 }))).toBe("Exited (130)");
    expect(statusDetail(run("a", { warning: "port 3000 already answers" }))).toBe("Port 3000 already answers.");
    expect(statusTone(run("a", { activity: "busy", status: "ready" }))).toBe("emerald");
    expect(statusTone(run("a", { status: "failed" }))).toBe("red");
  });
});
