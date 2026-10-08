import { describe, expect, test } from "bun:test";
import {
  activateShell,
  addShell,
  closeShell,
  dropEndedRuns,
  emptyWorkspace,
  nextShellId,
  readWorkspace,
  setShellTerminal,
  setShellTitle,
  shellLabel,
  upsertRunShell,
  workspaceParams,
  TERMINAL_WORKSPACE_PARAM,
  type TerminalWorkspace,
} from "./workspace";

const ids = (state: TerminalWorkspace) => state.shells.map((shell) => shell.id);
const runChip = (state: TerminalWorkspace, runId: string) => state.shells.find((shell) => shell.run?.runId === runId);

function three(): TerminalWorkspace {
  let state = emptyWorkspace();
  for (const pty of ["term_a", "term_b", "term_c"]) {
    const id = nextShellId(state);
    state = setShellTerminal(addShell(state), id, pty);
  }
  return state;
}

describe("opening and closing shells", () => {
  test("a new shell lands at the end of the strip and takes focus; an open id is focused, not duplicated", () => {
    const state = addShell(addShell(emptyWorkspace()));
    expect(ids(state)).toEqual(["shell", "shell#2"]);
    expect(state.active).toBe("shell#2");
    expect(addShell(state, "shell")).toEqual({ ...state, active: "shell" });
  });

  test("closing the active shell focuses its right neighbour, or the new last one", () => {
    const closed = closeShell(activateShell(three(), "shell#2"), "shell#2");
    expect(ids(closed)).toEqual(["shell", "shell#3"]);
    expect(closed.active).toBe("shell#3");
    expect(closeShell(activateShell(three(), "shell#3"), "shell#3").active).toBe("shell#2");
  });

  test("closing an inactive shell keeps focus, and closing the last leaves an empty strip", () => {
    expect(closeShell(activateShell(three(), "shell#3"), "shell").active).toBe("shell#3");
    expect(closeShell(addShell(emptyWorkspace()), "shell")).toEqual({ shells: [] });
  });
});

describe("what a chip says", () => {
  test("Shell N by place among the shells, the shell's own title over it, and a run never renumbers them", () => {
    const state = closeShell(three(), "shell#2");
    expect(state.shells.map((shell) => shellLabel(state, shell.id))).toEqual(["Shell 1", "Shell 2"]);
    const titled = setShellTitle(state, "shell#3", "~/code/telar");
    expect(shellLabel(titled, "shell#3")).toBe("~/code/telar");
    expect(shellLabel(setShellTitle(titled, "shell#3", "  "), "shell#3")).toBe("Shell 2");
    const withRun = upsertRunShell(addShell(emptyWorkspace()), { title: "web dev", run: { runId: "run_1", configId: "cfg" } });
    expect(withRun.shells.map((shell) => shellLabel(withRun, shell.id))).toEqual(["Shell 1", "web dev"]);
  });

  test("a title keeps the PTY beside it, and an unchanged one is not a new state", () => {
    const state = setShellTitle(three(), "shell#2", "zsh");
    expect(state.shells[1]).toEqual({ id: "shell#2", terminalId: "term_b", title: "zsh" });
    expect(setShellTitle(state, "shell#2", "zsh")).toBe(state);
  });
});

describe("a run in the strip", () => {
  const dev = { terminalId: "term_run", title: "web dev", run: { runId: "run_1", configId: "cfg_1" } };

  test("a run takes a chip of its own without stealing focus; `focus` selects it", () => {
    const state = upsertRunShell(three(), dev);
    expect(ids(state)).toEqual(["shell", "shell#2", "shell#3", "run"]);
    expect(state.active).toBe("shell#3");
    expect(upsertRunShell(state, dev, { focus: true }).active).toBe("run");
  });

  test("the same run arriving twice is one chip, and an unchanged frame is not a new state", () => {
    const once = upsertRunShell(three(), dev);
    expect(upsertRunShell(once, dev)).toBe(once);
  });

  test("a terminal id that arrives late, and one that goes, are both written", () => {
    const starting = upsertRunShell(emptyWorkspace(), { ...dev, terminalId: undefined });
    expect(runChip(starting, "run_1")?.terminalId).toBeUndefined();
    expect(runChip(upsertRunShell(starting, dev), "run_1")?.terminalId).toBe("term_run");
  });

  test("ended runs lose their chips; missing ones only when asked", () => {
    const state = upsertRunShell(upsertRunShell(addShell(emptyWorkspace()), { run: { runId: "a", configId: "" } }), { run: { runId: "b", configId: "" } });
    const open = (runId: string) => (runId === "a" ? false : runId === "b" ? true : undefined);
    expect(dropEndedRuns(state, open).shells.map((shell) => shell.run?.runId ?? shell.id)).toEqual(["shell", "b"]);
    const listed = (runId: string) => (runId === "b" ? true : undefined);
    expect(dropEndedRuns(state, listed)).toBe(state);
    expect(dropEndedRuns(state, listed, { dropMissing: true }).shells.map((shell) => shell.run?.runId ?? shell.id)).toEqual(["shell", "b"]);
  });
});

describe("the tab's params", () => {
  test("a workspace round-trips through one JSON key, runs included; an empty one writes nothing", () => {
    const state = activateShell(upsertRunShell(setShellTitle(three(), "shell#2", "nvim"), { title: "vite", run: { runId: "agent", configId: "" } }), "shell#3");
    const params = workspaceParams(state);
    expect(Object.keys(params)).toEqual([TERMINAL_WORKSPACE_PARAM]);
    expect(readWorkspace(params)).toEqual(state);
    expect(workspaceParams(emptyWorkspace())).toEqual({});
  });

  test("junk restores as an empty workspace, a run without an id as a shell, and a stale `active` as the first", () => {
    for (const raw of ["not json", "[]", '{"shells":"nope"}', '{"shells":[]}', '{"shells":[{"id":42}]}']) {
      expect(readWorkspace({ [TERMINAL_WORKSPACE_PARAM]: raw })).toEqual(emptyWorkspace());
    }
    const raw = JSON.stringify({ shells: [{ id: "run", run: { configId: "cfg_1" } }, { id: "shell" }], active: "gone" });
    expect(readWorkspace({ [TERMINAL_WORKSPACE_PARAM]: raw })).toEqual({ shells: [{ id: "run" }, { id: "shell" }], active: "run" });
  });
});
