import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act } from "react";
import { buttonLabelled, installTestDom, mount } from "@/test/dom";
import { AgentRows, type AgentRowData } from "./agent-rows";

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
    expect(clock(host)).toEqual(["1:05"]);
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(clock(host)).toEqual(["1:07"]);
  });

  test("an ended agent's clock stops at its ending", async () => {
    const { host } = await mount(<AgentRows agents={[{ sessionId: "s_a", state: "done", startedAt: START, endedAt: START + 9_000 }]} />);
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(clock(host)).toEqual(["0:09"]);
  });

  test("the group header folds its rows away and back", async () => {
    const agents: AgentRowData[] = [
      { sessionId: "s_a", state: "working", title: "One" },
      { sessionId: "s_b", state: "done", title: "Two" },
    ];
    const { host } = await mount(<AgentRows agents={agents} />);
    expect(host.textContent).toContain("One");
    await act(async () => buttonLabelled("2 agents · 1 working · 1 done", host)!.click());
    expect(host.textContent).not.toContain("One");
  });
});
