import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import { AgentRows, type AgentRowData } from "./agent-rows";
import { SessionLookup } from "./session-lookup";

installTestDom();

let START = 0;
beforeEach(() => {
  jest.useFakeTimers();
  START = Date.now() - 65_000;
});
afterEach(() => jest.useRealTimers());

const clock = (host: HTMLElement) => [...host.querySelectorAll('[aria-label="Elapsed"]')].map((node) => node.textContent);

describe("AgentRows", () => {
  test("a working agent's clock ticks every second", async () => {
    const { host } = await mount(<AgentRows agents={[{ sessionId: "s_a", state: "working", startedAt: START }]} />);
    expect(clock(host)).toEqual(["1m 05s"]);
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(clock(host)).toEqual(["1m 07s"]);
  });

  test("an ended agent's clock stops at its ending", async () => {
    const { host } = await mount(<AgentRows agents={[{ sessionId: "s_a", state: "done", startedAt: START, endedAt: START + 9_000 }]} />);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(clock(host)).toEqual(["9s"]);
  });

  test("several agents are one row that opens to theirs", async () => {
    const agents: AgentRowData[] = [
      { sessionId: "s_a", state: "working", title: "One" },
      { sessionId: "s_b", state: "done", title: "Two" },
    ];
    const { host } = await mount(<AgentRows agents={agents} />);
    const header = host.querySelector("button[aria-expanded]")!;
    expect(header.textContent).toContain("2 subagents");
    expect(header.textContent).toContain("1 working");
    expect(host.textContent).not.toContain("One");
    await act(async () => (header as HTMLButtonElement).click());
    expect(host.textContent).toContain("One");
  });

  test("a builder row opens its session, and says its latest line under its name", async () => {
    const lookup = () => ({ href: "/p/sessions/s_a" });
    const { host } = await mount(
      <SessionLookup.Provider value={lookup}>
        <AgentRows agents={[{ sessionId: "s_a", state: "working", title: "Fix the rail", progress: "Running tests" }]} />
      </SessionLookup.Provider>,
    );
    const link = host.querySelector('a[aria-label="Open Fix the rail"]');
    expect(link?.getAttribute("href")).toBe("/p/sessions/s_a");
    expect(link?.textContent).toContain("Running tests");
  });
});
