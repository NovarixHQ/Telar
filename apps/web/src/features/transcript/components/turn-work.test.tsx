import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { JournalItem, JournalTask } from "@telar/client/journal";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TurnWork, formatWorkDuration, workedForLabel } = await import("./turn-work");

const base = { runId: "run_1", sessionId: "session_1", startedAt: 1, completedAt: 2, streamedText: "", openedBy: 0 } as const;
const ran = (id: string, command: string, status: JournalItem["status"] = "completed"): JournalItem => ({
  ...base,
  id,
  status,
  detail: { type: "command_execution", command: { command } },
});
const artifact = (id: string): JournalItem => ({
  ...base,
  id,
  status: "completed",
  detail: { type: "artifact", artifact: { id: "artifact_1", kind: "html", title: "Chart", attachmentId: "att_1", version: 1 } },
});

const spawn = (n: number): JournalItem => ({ ...base, id: `item_toolu_${n}`, status: "completed", title: `Agent ${n}`, detail: { type: "task", taskId: `task_${n}` } });
const agent = (n: number, resultText: string): JournalTask => ({
  id: `task_${n}`,
  sessionId: "session_1",
  runId: "run_1",
  kind: "agent",
  state: "completed",
  title: n === 1 ? "List files" : "Summarise README",
  startedAt: 1,
  updatedAt: 2,
  completedAt: 2,
  resultText,
  items: [],
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function mount(items: JournalItem[], tasks: JournalTask[] = [], detail?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<TurnWork items={items} tasks={tasks} label="Worked for 1m 14s" {...(detail ? { detail } : {})} />));
  return host;
}

describe("a finished turn's work", () => {
  test("is folded behind its header, and a click opens and closes it", () => {
    const host = mount([ran("a", "bun test"), ran("b", "bun run check")], [], "1,234 tokens");
    const header = host.querySelector("button")!;
    expect(header.textContent).toContain("Worked for 1m 14s");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.getAttribute("title")).toBe("1,234 tokens");
    expect(host.textContent).not.toContain("bun test");

    act(() => header.click());
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("bun test");
    expect(host.textContent).toContain("bun run check");

    act(() => header.click());
    expect(host.textContent).not.toContain("bun test");
  });

  test("says how many steps failed while folded", () => {
    const host = mount([ran("a", "bun test", "failed"), ran("b", "ls")]);
    expect(host.querySelector("button")!.textContent).toContain("1 failed");
  });

  test("keeps an artifact on screen while folded", () => {
    const host = mount([ran("a", "bun test"), artifact("art")]);
    expect(host.textContent).not.toContain("bun test");
    expect(host.querySelector('figure[aria-label="Chart"]')).not.toBeNull();
  });

  test("folds sub-agents with the rest of the work, even one still out, and opens to one group row", () => {
    const working = { ...agent(2, ""), state: "running" as const };
    const host = mount([ran("a", "bun test"), spawn(1), spawn(2)], [agent(1, "Twelve files."), working]);
    expect(host.textContent).not.toContain("subagents");
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("1 working · 1 done");

    act(() => root!.render(<TurnWork items={[ran("a", "bun test"), spawn(1), spawn(2)]} tasks={[agent(1, "Twelve files."), agent(2, "A local engine.")]} label="Worked for 1m 14s" />));
    expect(host.textContent).toContain("2 subagents");
    expect(host.textContent).toContain("2 done");
  });

  test("draws nothing when the turn did no work", () => {
    const host = mount([]);
    expect(host.innerHTML).toBe("");
  });
});

describe("the header's duration", () => {
  test("reads like a stopwatch", () => {
    expect(formatWorkDuration(400)).toBe("<1s");
    expect(formatWorkDuration(8_040)).toBe("8.0s");
    expect(formatWorkDuration(42_000)).toBe("42s");
    expect(formatWorkDuration(74_000)).toBe("1m 14s");
    expect(formatWorkDuration(120_000)).toBe("2m");
    expect(formatWorkDuration(7_380_000)).toBe("2h 3m");
  });

  test("falls back to a bare verb when the turn has no clock", () => {
    expect(workedForLabel(1_000, 75_000)).toBe("Worked for 1m 14s");
    expect(workedForLabel(undefined, 75_000)).toBe("Worked");
  });
});
