import { describe, expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import type { JournalItem } from "@/platform/engine";
import { ToolRow } from "./tool-row";

installTestDom();

const base = { runId: "run_1", sessionId: "session_1", startedAt: 1, completedAt: 2, streamedText: "", openedBy: 0, status: "completed" } as const;

async function expanded(item: JournalItem) {
  const { host } = await mount(<ToolRow item={item} />);
  const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  expect(toggle).not.toBeNull();
  await act(async () => toggle!.click());
  return host.textContent ?? "";
}

describe("an expanded tool row", () => {
  test("shows the call's input as JSON and then its output", async () => {
    const item: JournalItem = {
      ...base,
      id: "item_a",
      title: "Grep",
      detail: { type: "dynamic_tool_call", call: { name: "Grep", input: { pattern: "toolWords" }, output: "src/a.ts:3" } },
    };
    const text = await expanded(item);
    const input = text.indexOf('"pattern": "toolWords"');
    expect(input).toBeGreaterThan(-1);
    expect(text.indexOf("src/a.ts:3")).toBeGreaterThan(input);
  });

  test("shows the whole command, not only the line the row names", async () => {
    const item: JournalItem = {
      ...base,
      id: "item_b",
      title: "bun test",
      detail: { type: "command_execution", command: { command: "bun test\necho done", outputPreview: "1 pass" } },
    };
    const text = await expanded(item);
    expect(text).toContain("echo done");
    expect(text).toContain("1 pass");
  });

  test("a call with no input and no output does not open", async () => {
    const item: JournalItem = { ...base, id: "item_c", title: "ToolSearch", detail: { type: "dynamic_tool_call", call: { name: "ToolSearch" } } };
    const { host } = await mount(<ToolRow item={item} />);
    expect(host.querySelector("button[aria-expanded]")).toBeNull();
  });
});
