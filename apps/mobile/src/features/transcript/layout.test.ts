import { expect, test } from "bun:test";
import type { Item, Turn } from "@telar/engine-client";
import { projectJournal } from "@telar/client/journal";
import { item, turn } from "@telar/client/journal/fixtures";
import { turnLayout, type Activity } from "./layout";

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
  expect(layout.opener).toEqual({ kind: "bubble", text: "Please help", attachments: 0 });
  expect(layout.ending).toBeUndefined();
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
