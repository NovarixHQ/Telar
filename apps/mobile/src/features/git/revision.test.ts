import { expect, test } from "bun:test";
import type { JournalItem, JournalTurn } from "@telar/client/journal";
import { diffRevision } from "./revision";

const item = (type: string, status = "completed") => ({ status, detail: { type } }) as unknown as JournalItem;
const turn = (items: JournalItem[], tasks: JournalItem[][] = []) => ({ items, tasks: tasks.map((rows) => ({ items: rows })) }) as unknown as JournalTurn;

test("finished edits and commands move the diff on, sub-agents' included", () => {
  const turns = [turn([item("file_change"), item("agent_message"), item("command_execution")]), turn([item("file_read")], [[item("file_change")]])];
  expect(diffRevision(turns)).toBe(3);
});

test("an edit still running does not count until it finishes", () => {
  expect(diffRevision([turn([item("file_change", "inProgress")])])).toBe(0);
  expect(diffRevision([turn([item("file_change", "completed")])])).toBe(1);
});
