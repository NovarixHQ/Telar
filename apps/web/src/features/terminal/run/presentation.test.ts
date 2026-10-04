/**
 * The folds that decide what a human is told. Every test here is about a
 * wrong answer that would cost something real: a green dot over an
 * unattributable check, "Running" over a closed terminal, a password typed
 * into a field that will refuse it only after the round trip.
 */
import { describe, expect, test } from "bun:test";
import {
  draftProblems,
  describeReadiness,
  isOpenTerminal,
  recentRuns,
  statusDetail,
  statusLabel,
  statusTone,
  worktreeLabel,
} from "./presentation";
import type { RunConfigurationDraft, RunStatusAnswer, RunView } from "./types";

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    terminalId: "term_1",
    runId: "term_1",
    projectId: "proj_1",
    sessionId: "sess_1",
    origin: "run",
    title: "web dev",
    configId: "cfg_1",
    configName: "web dev",
    command: "bun run dev",
    worktreePath: "/trees/main",
    cwd: "/trees/main",
    startedAt: 1000,
    status: "running",
    activity: "idle",
    readiness: { kind: "none" },
    env: [],
    ...overrides,
  };
}

const answer = (overrides: Partial<RunStatusAnswer> = {}): RunStatusAnswer => ({ terminals: [], ...overrides });

describe("isOpenTerminal", () => {
  test("a closed terminal is not open, a running one is", () => {
    expect(isOpenTerminal(run({ status: "closed", closedBy: "person" }))).toBe(false);
    expect(isOpenTerminal(run())).toBe(true);
  });
});

describe("status", () => {
  test("an open shell reads Idle until a command runs in it, then Running", () => {
    const idle = run({ activity: "idle" });
    const busy = run({ activity: "busy" });
    expect([statusLabel(idle), statusTone(idle)]).toEqual(["Idle", "idle"]);
    expect([statusLabel(busy), statusTone(busy)]).toEqual(["Running", "working"]);
  });

  test("a busy shell whose readiness check answered is good, and goes idle when its command ends", () => {
    expect([statusLabel(run({ status: "ready", activity: "busy" })), statusTone(run({ status: "ready", activity: "busy" }))]).toEqual(["Ready", "good"]);
    expect(statusTone(run({ status: "ready", activity: "idle" }))).toBe("idle");
  });

  test("an idle shell names a failed last command, and stays quiet about a clean one", () => {
    expect(statusLabel(run({ lastExit: { exitCode: 1, at: 2000 } }))).toBe("Idle · exit 1");
    expect(statusLabel(run({ lastExit: { exitCode: 0, at: 2000 } }))).toBe("Idle");
    expect(statusLabel(run({ activity: "busy", lastExit: { exitCode: 1, at: 2000 } }))).toBe("Running");
  });

  test("tone separates a shell that failed from one somebody closed", () => {
    expect(statusTone(run({ status: "failed" }))).toBe("bad");
    expect(statusTone(run({ status: "exited", exitCode: 0 }))).toBe("idle");
    expect(statusTone(run({ status: "closed", activity: "busy" }))).toBe("idle");
  });

  test("an ended terminal is never labelled as still running", () => {
    expect(statusLabel(run({ status: "exited", exitCode: 0 }))).toBe("Exited");
    expect(statusLabel(run({ status: "exited", exitCode: 3 }))).toBe("Exited (3)");
    expect(statusLabel(run({ status: "closed", closedBy: "person" }))).toBe("Closed");
  });

  test("the engine's error is shown as-is — it arrives already redacted", () => {
    expect(statusDetail(run({ status: "failed", error: "spawn failed: «redacted»" }))).toBe("spawn failed: «redacted»");
    expect(statusDetail(run({ status: "exited", signal: "SIGTERM" }))).toBe("Stopped by SIGTERM.");
    expect(statusDetail(run())).toBeUndefined();
  });

  test("a busy port is said, and who closed a terminal is said", () => {
    expect(statusDetail(run({ warning: "port 3000 already answers" }))).toBe("Port 3000 already answers.");
    expect(statusDetail(run({ status: "closed", closedBy: "agent" }))).toBe("Closed by the agent.");
    expect(statusDetail(run({ status: "closed", closedBy: "telar" }))).toBe("Closed by Telar.");
  });
});

describe("describeReadiness", () => {
  test("an unattributable check explains itself instead of showing a dot", () => {
    const reason = "http://localhost:3000 was already answering before this run started.";
    expect(describeReadiness({ kind: "unattributable", reason }, "http://localhost:3000")).toBe(reason);
  });

  test("no check configured says nothing at all", () => {
    expect(describeReadiness({ kind: "none" })).toBeUndefined();
  });

  test("pending names the address being waited on", () => {
    expect(describeReadiness({ kind: "pending" }, "http://localhost:3000")).toContain("localhost:3000");
  });
});

describe("draftProblems", () => {
  const draft = (overrides: Partial<RunConfigurationDraft> = {}): RunConfigurationDraft => ({
    name: "web dev",
    command: "bun run dev",
    ...overrides,
  });

  test("a savable draft has nothing to say", () => {
    expect(draftProblems(draft())).toEqual([]);
  });

  test("a secret shorter than four characters is refused with the reason", () => {
    // Same rule as the engine: a two-character value cannot be scrubbed out of
    // captured output without mangling unrelated text.
    const problems = draftProblems(draft({ env: [{ key: "TOKEN", value: "ab", secret: true }] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe("env");
    expect(problems[0]!.message).toContain("4 characters");
  });

  test("the same short value is fine when it is not marked secret", () => {
    expect(draftProblems(draft({ env: [{ key: "MODE", value: "ab" }] }))).toEqual([]);
  });

  test("a multi-line secret is refused", () => {
    const problems = draftProblems(draft({ env: [{ key: "KEY", value: "line one\nline two", secret: true }] }));
    expect(problems.some((problem) => problem.message.includes("line break"))).toBe(true);
  });

  test("a readiness check must be http(s), and an absolute cwd is not relative", () => {
    expect(draftProblems(draft({ readinessUrl: "ftp://localhost" }))[0]!.field).toBe("readinessUrl");
    expect(draftProblems(draft({ readinessUrl: "http://localhost:3000" }))).toEqual([]);
    expect(draftProblems(draft({ cwd: "/etc" }))[0]!.field).toBe("cwd");
    expect(draftProblems(draft({ cwd: "apps/web" }))).toEqual([]);
  });

  test("an unnamed configuration, an empty command and a duplicate variable are all caught", () => {
    expect(draftProblems(draft({ name: "  " }))[0]!.field).toBe("name");
    expect(draftProblems(draft({ command: "" }))[0]!.field).toBe("command");
    const dupes = draftProblems(draft({ env: [{ key: "A", value: "1" }, { key: "A", value: "2" }] }));
    expect(dupes.some((problem) => problem.message.includes("twice"))).toBe(true);
  });
});

describe("history", () => {
  test("recent runs are newest first, whatever order they arrived in", () => {
    const answered = answer({
      terminals: [run({ terminalId: "term_old", startedAt: 1 }), run({ terminalId: "term_new", startedAt: 9 })],
    });
    expect(recentRuns(answered).map((entry: RunView) => entry.terminalId)).toEqual(["term_new", "term_old"]);
    expect(recentRuns(answered, 1)).toHaveLength(1);
  });

  test("the worktree label names the tree and its branch", () => {
    expect(worktreeLabel("/trees/feature-a/", "feat/x")).toBe("feature-a (feat/x)");
    expect(worktreeLabel("/trees/main")).toBe("main");
  });
});
