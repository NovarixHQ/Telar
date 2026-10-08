import { expect, test } from "bun:test";
import { projectJournal } from "@telar/client/journal";
import { item, turn } from "@telar/client/journal/fixtures";
import { transcriptRows } from "./rows";

test("a turn reads as its prompt, the agent's words and a line per tool call", () => {
  const turns = projectJournal(
    [{ ...turn, state: "completed" }],
    [
      item({ id: "say", status: "completed", detail: { type: "assistant_message", text: "Done: the tests pass." } }),
      item({ id: "ran", status: "completed", title: "bun test", detail: { type: "command_execution", command: "bun test", exitCode: 0 } as never }),
    ],
    [],
  );
  expect(transcriptRows(turns)).toEqual([
    { key: "run_1/prompt", kind: "prompt", text: "Please help" },
    { key: "say", kind: "reply", text: "Done: the tests pass." },
    { key: "ran", kind: "tool", text: "bun test", running: false },
  ]);
});

test("a running turn ends with a working line, and a failed one with its reason", () => {
  const running = projectJournal([{ ...turn, state: "running" }], [], []);
  expect(transcriptRows(running).at(-1)).toEqual({ key: "run_1/working", kind: "status", text: "Working…", tone: "working" });
  const failed = projectJournal([{ ...turn, state: "failed", failure: { code: "driver_failed", message: "The provider refused." } }], [], []);
  expect(transcriptRows(failed).at(-1)).toEqual({ key: "run_1/failed", kind: "status", text: "The provider refused.", tone: "failed" });
});
