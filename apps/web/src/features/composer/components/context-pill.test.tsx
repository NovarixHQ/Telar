import { describe, expect, test } from "bun:test";
import { buttonLabelled, click, installTestDom, mount } from "@/test/dom";
import { BackgroundPresence } from "./context-pill";

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
