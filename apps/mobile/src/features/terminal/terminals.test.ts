import { describe, expect, test } from "bun:test";
import type { RunView } from "@telar/engine-client";
import { liveTerminals, pickTerminal, statusDetail, statusLabel, statusTone, upsertTerminal } from "./terminals";

const run = (terminalId: string, patch: Partial<RunView> = {}): RunView =>
  ({ terminalId, runId: terminalId, title: terminalId, command: "zsh", status: "running", activity: "idle", startedAt: 1, ...patch }) as RunView;

describe("terminals", () => {
  test("a list refresh keeps only the host's live terminals, replacing what was shown", () => {
    const listed = [run("old", { startedAt: 1 }), run("exited", { status: "exited" }), run("closed", { status: "closed" }), run("failed", { status: "failed" }), run("new", { startedAt: 2, status: "ready" })];
    expect(liveTerminals(listed).map((one) => one.terminalId)).toEqual(["new", "old"]);
    expect(liveTerminals([])).toEqual([]);
  });

  test("an open status replaces by id and keeps the newest first", () => {
    const list = upsertTerminal([run("a", { startedAt: 1 }), run("b", { startedAt: 2 })], run("a", { startedAt: 1, activity: "busy" }));
    expect(list.map((one) => [one.terminalId, one.activity])).toEqual([["b", "idle"], ["a", "busy"]]);
    expect(upsertTerminal(list, run("c", { startedAt: 3 }))[0]?.terminalId).toBe("c");
  });

  test("a terminal that exits or closes while shown leaves the list, and the next live one is shown", () => {
    const list = [run("b", { startedAt: 2 }), run("a", { startedAt: 1 })];
    const afterClose = upsertTerminal(list, run("b", { startedAt: 2, status: "closed", closedBy: "agent" }));
    expect(afterClose.map((one) => one.terminalId)).toEqual(["a"]);
    expect(pickTerminal(afterClose, "b")?.terminalId).toBe("a");
    const afterExit = upsertTerminal(afterClose, run("a", { status: "exited", exitCode: 0 }));
    expect(afterExit).toEqual([]);
    expect(pickTerminal(afterExit, "a")).toBeUndefined();
  });

  test("an ended terminal never heard of is not added", () => {
    expect(upsertTerminal([run("a")], run("gone", { status: "exited" })).map((one) => one.terminalId)).toEqual(["a"]);
  });

  test("shows the one asked for, else the newest", () => {
    const list = [run("new", { startedAt: 2 }), run("old")];
    expect(pickTerminal(list, "old")?.terminalId).toBe("old");
    expect(pickTerminal(list, "gone")?.terminalId).toBe("new");
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
