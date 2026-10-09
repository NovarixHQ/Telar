import { expect, test } from "bun:test";
import type { Item, Turn } from "@telar/engine-client";
import { projectJournal } from "@telar/client/journal";
import { item, turn } from "@telar/client/journal/fixtures";
import { groupTurns, turnLayout, type Activity } from "./layout";

const ran = (id: string, status: Item["status"] = "completed") => item({ id, status, title: `cmd ${id}`, detail: { type: "command_execution", command: { command: id } } as never });
const edited = (id: string) => item({ id, status: "completed", title: id, detail: { type: "file_change", change: { path: id, kind: "edit" } } as never });
const said = (id: string, text: string, status: Item["status"] = "completed") => item({ id, status, detail: { type: "assistant_message", text } });

function layoutOf(state: Turn["state"], items: Item[], over: Partial<Turn> = {}) {
  const [only] = projectJournal([{ ...turn, state, ...over }], items, []);
  return turnLayout(only!);
}

const shape = (body: Activity[]) => body.map((row) => (row.kind === "fold" ? `${row.live ? "live" : "fold"}(${row.items.map((i) => i.id).join(",")})` : row.item.id));

test("a settled turn folds every step before its last words into one tally", () => {
  const layout = layoutOf("completed", [ran("a"), said("mid", "Looking."), ran("b"), edited("c"), said("end", "Done.")]);
  expect(shape(layout.body)).toEqual(["fold(a,mid,b,c)", "end"]);
  expect(layout.body[0]).toMatchObject({ tally: "Ran command ×2 · Narrated · Edited file", failed: false });
  expect(layout.opener).toEqual({ kind: "bubble", text: "Please help", attachments: [] });
  expect(layout.ending).toBeUndefined();
});

test("the opening bubble carries the files sent with the prompt", () => {
  const sent = { id: "att_1", name: "plot.png", mediaType: "image/png", bytes: 2048, path: "/engine/att_1" };
  expect(layoutOf("completed", [], { attachments: [sent] }).opener).toEqual({ kind: "bubble", text: "Please help", attachments: [sent] });
});

test("a running turn keeps its words between live runs, and only the newest run is live", () => {
  const layout = layoutOf("running", [ran("a"), ran("b"), said("mid", "Now the edit."), edited("c"), ran("d", "inProgress")]);
  expect(shape(layout.body)).toEqual(["fold(a,b)", "mid", "live(c,d)"]);
  expect(layout.ending).toEqual({ kind: "working", label: "Working" });
});

test("a failed step marks its fold, and a failed turn ends with the reason", () => {
  const layout = layoutOf("failed", [ran("a", "failed"), said("end", "It broke.")], { failure: { code: "driver_failed", message: "The provider refused." } } as never);
  expect(layout.body[0]).toMatchObject({ kind: "fold", failed: true });
  expect(layout.ending).toEqual({ kind: "failed", text: "The provider refused." });
});

test("a queued turn says so, and a stopped one ends with Stopped", () => {
  expect(layoutOf("queued", []).ending).toEqual({ kind: "working", label: "Queued" });
  expect(layoutOf("stopped", [said("end", "Partial.")]).ending).toEqual({ kind: "stopped" });
});

test("a steer splits the turn: the earlier response folds on its own above the message", () => {
  const steer = item({ id: "steer", status: "completed", detail: { type: "user_message", text: "Use bun." } });
  const layout = layoutOf("completed", [ran("a"), said("first", "Ok."), steer, ran("b"), said("end", "Done.")]);
  expect(shape(layout.body)).toEqual(["fold(a)", "first", "steer", "fold(b)", "end"]);
});

test("empty thoughts are dropped from a fold", () => {
  const thought = item({ id: "think", status: "completed", detail: { type: "reasoning", text: "  " } });
  expect(shape(layoutOf("completed", [thought, ran("a"), said("end", "Done.")]).body)).toEqual(["fold(a)", "end"]);
});

test("bare notification turns stack together, and a turn that answered starts a new group", () => {
  const note = { kind: "wake", wakeKind: "turn_completed", summary: "done", fetch: { sessionId: "s", runId: "r" }, body: "" };
  const turns = projectJournal(
    [
      { ...turn, runId: "a", sequence: 1, state: "completed", origin: "session", notification: note },
      { ...turn, runId: "b", sequence: 2, state: "completed", origin: "session", notification: note },
      { ...turn, runId: "c", sequence: 3, state: "completed" },
    ] as never,
    [said("reply", "Seen.")].map((row) => ({ ...row, runId: "c" })),
    [],
  );
  expect(groupTurns(turns).map((group) => group.map((one) => one.runId))).toEqual([["a", "b"], ["c"]]);
});

test("a sub-agent no step spawned gets its own row, and background work stays out of the transcript", () => {
  const task = (id: string, kind: string) => ({ id, sessionId: "s1", runId: "run_1", kind, state: "completed", startedAt: 1, updatedAt: 1 });
  const [only] = projectJournal([{ ...turn, state: "completed" }], [said("end", "Done.")], [], [task("agent", "agent"), task("bg", "background")] as never);
  expect(turnLayout(only!).orphans.map((one) => one.id)).toEqual(["agent"]);
});
