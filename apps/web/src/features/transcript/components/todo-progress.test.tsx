import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import type { JournalItem } from "@telar/client/journal";
import { item } from "@telar/client/journal/fixtures";
import { buttonLabelled, click, installTestDom, mount } from "@/test/dom";
import { TodoProgress } from "./todo-progress";

installTestDom();

let report: ((visible: boolean) => void) | undefined;
let realObserver: unknown;
class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe() {
    report = (visible) => this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  disconnect() {
    report = undefined;
  }
}
beforeEach(() => {
  realObserver = globalThis.IntersectionObserver;
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
});
afterEach(() => {
  (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = realObserver;
});

const plan = item({
  id: "plan_1",
  detail: {
    type: "plan",
    plan: {
      steps: [
        { step: "Read the code", status: "completed" },
        { step: "Write the banner", status: "inProgress" },
        { step: "Open the PR", status: "pending" },
      ],
    },
  },
}) as JournalItem;

function Cockpit() {
  const [running, setRunning] = useState(true);
  return (
    <>
      <ul data-plan-row="plan_1" />
      <button type="button" onClick={() => setRunning(false)}>
        End turn
      </button>
      <TodoProgress items={running ? [plan] : undefined} />
    </>
  );
}

const banner = () => document.querySelector('[role="status"]')?.textContent;

describe("live to-do progress above the composer", () => {
  test("shows the current step and the count while the list is out of view, and hides when it scrolls back", async () => {
    await mount(<Cockpit />);
    await act(async () => report?.(false));
    expect(banner()).toBe("Write the banner1 of 3 done");

    await act(async () => report?.(true));
    expect(banner()).toBeUndefined();
  });

  test("disappears when the turn ends", async () => {
    await mount(<Cockpit />);
    await act(async () => report?.(false));
    expect(banner()).toContain("1 of 3 done");

    await click(buttonLabelled("End turn"));
    expect(banner()).toBeUndefined();
  });
});
