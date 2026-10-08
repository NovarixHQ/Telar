import { expect, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import { PromptText } from "./prompt-text";

installTestDom();

const longPrompt = Array.from({ length: 12 }, (_, line) => `step ${line + 1}`).join("\n");

test("a long prompt collapses behind Show full message, and the button expands and collapses it", async () => {
  const { host } = await mount(<PromptText text={longPrompt} />);
  const button = [...host.querySelectorAll("button")].find((element) => element.textContent === "Show full message");
  expect(button?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => button!.click());
  expect(button?.getAttribute("aria-expanded")).toBe("true");
  expect(button?.textContent).toBe("Show less");
  expect(host.querySelector("p")?.textContent).toContain("step 12");
  await act(async () => button!.click());
  expect(button?.textContent).toBe("Show full message");
});

test("a short prompt shows in full with no button", async () => {
  const { host } = await mount(<PromptText text={"fix the rail\nthen the panel"} />);
  expect(host.querySelector("button")).toBeNull();
  expect(host.querySelector("p")?.textContent).toBe("fix the rail\nthen the panel");
});

test("one very long line collapses too", async () => {
  const { host } = await mount(<PromptText text={"word ".repeat(200)} />);
  expect(host.querySelector("button")?.textContent).toBe("Show full message");
});
