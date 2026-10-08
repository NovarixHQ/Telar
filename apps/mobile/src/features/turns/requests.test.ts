import { expect, test } from "bun:test";
import type { EngineRequest } from "@telar/engine-client";
import { openRequests } from "./requests";

const request = (id: string, detail: EngineRequest["detail"], state: EngineRequest["state"] = "open") =>
  ({ id, runId: "run_1", sessionId: "s1", state, detail, openedAt: 1 }) as EngineRequest;

test("each open request says what it asks, and only open ones are shown", () => {
  const cards = openRequests([
    request("cmd", { kind: "command_execution", command: { command: "rm -rf build", cwd: "/repo" } }),
    request("edit", { kind: "file_change", change: { path: "src/a.ts", kind: "edit", unifiedDiff: "-a\n+b" } }),
    request("read", { kind: "file_read", read: { path: "/etc/hosts" } }),
    request("tool", { kind: "tool_call", call: { name: "deploy", input: { env: "prod" } } }),
    request("done", { kind: "file_read", read: { path: "x" } }, "resolved"),
  ]);
  expect(cards.map(({ id, title, body }) => ({ id, title, body }))).toEqual([
    { id: "cmd", title: "Run a command", body: "rm -rf build\nin /repo" },
    { id: "edit", title: "Edit src/a.ts", body: "-a\n+b" },
    { id: "read", title: "Read /etc/hosts", body: undefined },
    { id: "tool", title: "Use deploy", body: '{\n  "env": "prod"\n}' },
  ]);
  expect(cards.every((card) => card.decidable)).toBe(true);
});

test("questions and logins are shown but answered on the computer for now", () => {
  const [question] = openRequests([request("q", { kind: "user_input", prompt: "Which branch?", fields: [] })]);
  expect(question).toMatchObject({ title: "Which branch?", decidable: false });
});
