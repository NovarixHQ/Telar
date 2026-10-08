import { expect, test } from "bun:test";
import { completionsFor, type CompletionContext } from "./completions";
import { detectTrigger } from "./trigger";

const context = (over: Partial<CompletionContext> = {}): CompletionContext => ({
  busy: false,
  runtimeMode: "auto",
  skills: {
    skills: [
      { name: "orchestrate", description: "Fan out work", source: "user" },
      { name: "review", description: "", source: "project" },
    ],
    commands: [{ name: "compact", description: "Summarise the conversation", source: "provider" }],
  },
  targets: [
    { sessionId: "s_here", title: "This one", projectId: "p1" },
    { sessionId: "s_other", title: "Pricing study", projectId: "p2", projectName: "web" },
    { sessionId: "s_same", title: "Pricing page", projectId: "p1", projectName: "telar" },
    { sessionId: "s_more", title: "Release notes", projectId: "p2" },
  ],
  current: { sessionId: "s_here", projectId: "p1" },
  ...over,
});

const list = (draft: string, over?: Partial<CompletionContext>) => completionsFor(detectTrigger(draft)!, context(over));

test("a bare slash lists the commands, then the provider's, then skills", () => {
  expect(list("/").map((row) => [row.group, row.label])).toEqual([
    ["Commands", "/supervised"],
    ["Commands", "/auto-edits"],
    ["Commands", "/auto"],
    ["Commands", "/full-access"],
    ["Commands", "/orchestrate"],
    ["Provider commands", "/compact"],
    ["Skills", "orchestrate"],
    ["Skills", "review"],
  ]);
  expect(list("/").find((row) => row.label === "/auto")?.detail).toEndWith("(current)");
  expect(list("/", { busy: true }).some((row) => row.label === "/stop")).toBe(true);
});

test("typing filters by name first and description second", () => {
  expect(list("/full").map((row) => row.label)).toEqual(["/full-access"]);
  expect(list("/summar").map((row) => row.label)).toEqual(["/compact"]);
  expect(list("$rev").map((row) => [row.label, row.detail])).toEqual([["review", "This project"]]);
});

test("mentions skip this session, rank its project first and insert the reference sentence", () => {
  const rows = list("compare with @pricing");
  expect(rows.map((row) => row.id)).toEqual(["session:s_same", "session:s_other"]);
  expect(rows[1]).toMatchObject({ label: "Pricing study", detail: "web" });
  expect(rows[1]!.action).toMatchObject({ kind: "insert" });
  expect(rows[1]!.action.kind === "insert" && rows[1]!.action.text.startsWith('the "Pricing study" session (s_other)')).toBe(true);
  expect(list("@")).toHaveLength(3);
});
