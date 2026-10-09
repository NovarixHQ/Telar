import { expect, test } from "bun:test";
import { projectJournal } from "@telar/client/journal";
import { item, turn } from "@telar/client/journal/fixtures";
import { detailParts, openablePath, rowCopies, rowPath } from "./tool-detail";

const one = (row: Parameters<typeof item>[0]) => projectJournal([{ ...turn, state: "completed" }], [item(row)], [])[0]!.items[0]!;

test("a command's sheet shows where it ran, the command, its exit and its output", () => {
  const ran = one({ id: "c", status: "failed", detail: { type: "command_execution", command: { command: "bun test", cwd: "/repo", exitCode: 1, outputPreview: "1 fail" } } as never });
  expect(detailParts(ran)).toEqual([
    { kind: "caption", text: "/repo" },
    { kind: "code", text: "bun test" },
    { kind: "meta", text: "exit 1", failed: true },
    { kind: "label", text: "Output" },
    { kind: "code", text: "1 fail" },
  ]);
  expect(rowCopies(ran).map((copy) => copy.label)).toEqual(["Copy command", "Copy output"]);
});

test("an edit offers its patch and path, and a tool call its pretty input", () => {
  const edit = one({ id: "e", status: "completed", detail: { type: "file_change", change: { path: "a.ts", kind: "edit", unifiedDiff: "@@ -1 +1 @@" } } as never });
  expect(detailParts(edit)).toEqual([{ kind: "meta", text: "edit · a.ts" }, { kind: "code", text: "@@ -1 +1 @@" }]);
  expect(rowCopies(edit)).toEqual([{ label: "Copy patch", text: "@@ -1 +1 @@" }, { label: "Copy path", text: "a.ts" }]);
  const call = one({ id: "t", status: "completed", detail: { type: "mcp_tool_call", call: { name: "x", input: { a: 1 } } } as never });
  expect(detailParts(call)).toEqual([{ kind: "label", text: "Input" }, { kind: "code", text: '{\n  "a": 1\n}' }]);
});

test("only rows that touched a file offer its path", () => {
  const read = one({ id: "r", status: "completed", detail: { type: "file_read", read: { path: "src/a.ts" } } as never });
  const edit = one({ id: "e", status: "completed", detail: { type: "file_change", change: { path: "b.ts", kind: "add" } } as never });
  const ran = one({ id: "c", status: "completed", detail: { type: "command_execution", command: { command: "ls" } } as never });
  expect([rowPath(read), rowPath(edit), rowPath(ran)]).toEqual(["src/a.ts", "b.ts", undefined]);
});

test("the editor opens what a row read or changed, but not a file it deleted", () => {
  const read = one({ id: "r", status: "completed", detail: { type: "file_read", read: { path: "src/a.ts" } } as never });
  const gone = one({ id: "d", status: "completed", detail: { type: "file_change", change: { path: "old.ts", kind: "delete" } } as never });
  expect([openablePath(read), openablePath(gone), rowPath(gone)]).toEqual(["src/a.ts", undefined, "old.ts"]);
});
