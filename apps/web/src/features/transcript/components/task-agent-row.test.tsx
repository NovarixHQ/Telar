import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act } from "react";
import type { JournalItem, JournalTask } from "@/platform/engine";
import { installTestDom, mount } from "@/test/dom";
import { TranscriptItem } from "./transcript-item";

installTestDom();

let NOW = 0;
beforeEach(() => {
  jest.useFakeTimers();
  NOW = Date.now();
});
afterEach(() => jest.useRealTimers());

const base = { runId: "run_1", sessionId: "session_1", streamedText: "", openedBy: 0 } as const;

const handle = (status: JournalItem["status"]): JournalItem => ({
  ...base,
  id: "item_toolu_1",
  status,
  startedAt: NOW - 50_000,
  title: "Explore the repo",
  detail: { type: "task", taskId: "task_toolu_1" },
});

const step: JournalItem = {
  ...base,
  id: "item_toolu_2",
  status: "completed",
  startedAt: NOW - 40_000,
  completedAt: NOW - 39_000,
  taskId: "task_toolu_1",
  title: "Read package.json",
  detail: { type: "file_read", read: { path: "package.json" } },
};

const task = (over: Partial<JournalTask>): JournalTask => ({
  id: "task_toolu_1",
  sessionId: "session_1",
  runId: "run_1",
  kind: "agent",
  state: "running",
  title: "Explore the repo",
  role: "Explore",
  startedAt: NOW - 50_000,
  updatedAt: NOW,
  items: [step],
  ...over,
});

const render = (item: JournalItem, t: JournalTask) => mount(<TranscriptItem item={item} tasks={[t]} />);

describe("a provider sub-agent row", () => {
  test("while it works it shows its latest step and a ticking clock", async () => {
    const { host } = await render(handle("inProgress"), task({}));
    expect(host.textContent).toContain("Explore the repo");
    expect(host.textContent).toContain("Read package.json");
    expect(host.querySelector('[aria-label="Elapsed"]')?.textContent).toBe("50s");
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(host.querySelector('[aria-label="Elapsed"]')?.textContent).toBe("52s");
  });

  test("once done it summarises its report, and a click opens its steps and the report", async () => {
    const done = task({ state: "completed", completedAt: NOW - 10_000, resultText: "## Found it\nThe rail lives in apps/web." });
    const { host } = await render(handle("completed"), done);
    const row = host.querySelector('button[aria-label="Explore the repo"]')!;
    expect(row.textContent).toContain("Found it");
    expect(row.textContent).toContain("40s");
    expect(host.textContent).not.toContain("The rail lives in apps/web.");
    await act(async () => (row as HTMLButtonElement).click());
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("1 step");
    expect(host.textContent).toContain("The rail lives in apps/web.");
  });

  test("a sub-agent with nothing recorded does not pretend to open", async () => {
    const { host } = await render(handle("inProgress"), task({ items: [] }));
    expect(host.querySelector("button[aria-expanded]")).toBeNull();
    expect(host.textContent).toContain("Working");
  });
});
