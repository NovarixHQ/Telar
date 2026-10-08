import { describe, expect, test } from "bun:test";
import { buttonLabelled, click, installTestDom, mount } from "@/test/dom";
import { BackgroundPresence, ContextPill } from "./context-pill";

installTestDom();

describe("the background banner", () => {
  test("counts what still runs and offers Stop as its only action", async () => {
    let stops = 0;
    const { host } = await mount(<BackgroundPresence count={2} onStop={() => stops++} />);
    expect(host.textContent).toContain("2 tasks still working");
    expect([...host.querySelectorAll("button")].map((node) => node.textContent?.trim())).toEqual(["Stop"]);
    await click(buttonLabelled("Stop", host));
    expect(stops).toBe(1);
  });

  test("nothing running draws nothing", async () => {
    const { host } = await mount(<BackgroundPresence count={0} onStop={() => {}} />);
    expect(host.textContent).toBe("");
  });
});

describe("usage limits, in the usage wheel", () => {
  const wheel = () => document.querySelector<HTMLElement>('button[aria-label^="Context window"]')!;
  const toggle = () => document.querySelector<HTMLElement>('[aria-label="Continue after a usage limit resets"]');

  test("a Claude session can choose to continue once a limit resets", async () => {
    const picked: boolean[] = [];
    await mount(<ContextPill driver="claude" onResumeAfterRateLimit={(next) => picked.push(next)} />);
    await click(wheel());
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    await click(toggle()!);
    expect(picked).toEqual([false]);
  });

  test("another provider is not offered it", async () => {
    await mount(<ContextPill driver="codex" onResumeAfterRateLimit={() => {}} />);
    await click(wheel());
    expect(toggle()).toBeNull();
  });
});
