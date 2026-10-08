import { expect, test } from "bun:test";
import type { EngineRequest } from "@telar/engine-client";
import { openRequests } from "./requests";

const request = (id: string, detail: EngineRequest["detail"], state: EngineRequest["state"] = "open") =>
  ({ id, runId: "run_1", sessionId: "s1", state, detail, openedAt: 1 }) as EngineRequest;

test("each open request gets the Swift app's symbol, title and preview, and only open ones are shown", () => {
  const cards = openRequests([
    request("cmd", { kind: "command_execution", command: { command: "rm -rf build", cwd: "/repo" } }),
    request("edit", { kind: "file_change", change: { path: "src/a.ts", kind: "edit", unifiedDiff: "-a\n+b" } }),
    request("read", { kind: "file_read", read: { path: "/etc/hosts" } }),
    request("tool", { kind: "tool_call", call: { name: "mcp__deployer__deploy", input: { env: "prod" } } }),
    request("done", { kind: "file_read", read: { path: "x" } }, "resolved"),
  ]);
  expect(cards.map(({ id, symbol, title, cwd, preview }) => ({ id, symbol, title, cwd, preview: preview?.text }))).toEqual([
    { id: "cmd", symbol: "terminal", title: "Run a command", cwd: "/repo", preview: "rm -rf build" },
    { id: "edit", symbol: "pencil.line", title: "Edit src/a.ts", cwd: undefined, preview: "-a\n+b" },
    { id: "read", symbol: "doc.text", title: "Read /etc/hosts", cwd: undefined, preview: undefined },
    { id: "tool", symbol: "wrench.and.screwdriver", title: "deploy", cwd: undefined, preview: '{\n  "env": "prod"\n}' },
  ]);
  expect(cards.every((card) => card.decidable)).toBe(true);
  expect(cards[0]!.preview!.maxHeight).toBe(80);
});

test("questions and logins are shown but answered on the computer for now", () => {
  const [question, login] = openRequests([
    request("q", { kind: "user_input", prompt: "Which branch?", fields: [] }),
    request("s", { kind: "secret_access", secret: { origin: "https://example.com", candidates: [] } } as unknown as EngineRequest["detail"]),
  ]);
  expect(question).toMatchObject({ symbol: "questionmark.bubble", title: "Question", note: "Which branch?", decidable: false });
  expect(login).toMatchObject({ symbol: "key.fill", title: "Fill a login", cwd: "https://example.com", decidable: false });
});
