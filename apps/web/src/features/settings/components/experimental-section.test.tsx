import { expect, test } from "bun:test";
import { buttonLabelled, click, installTestDom, mount, press } from "@/test/dom";
import { EXPERIMENTS, type Experiment } from "../experiments";
import { ExperimentalSection } from "./experimental-section";

installTestDom();

const TRIAL: Experiment = { id: "tabs", label: "One tab per page and terminal", hint: "Browser pages and shells as their own panel tabs.", decideBy: "2026-11-15" };

test("the group is folded, and empty says so once opened", async () => {
  const { host } = await mount(<ExperimentalSection experiments={[]} />);
  expect(host.textContent).toContain("Experimental");
  expect(host.textContent).not.toContain("Nothing on trial");
  await click(buttonLabelled("Show", host));
  expect(host.textContent).toContain("Nothing on trial");
});

test("a trial names its decide-by date and is kept on this device only", async () => {
  window.localStorage.clear();
  const { host } = await mount(<ExperimentalSection experiments={[TRIAL]} />);
  await click(buttonLabelled("Show", host));
  expect(host.textContent).toContain("Decide by Nov 15.");
  await press(host.querySelector('[role="switch"]')!);
  expect(window.localStorage.getItem("telar:experiment:tabs")).toBe("on");
  await click(host.querySelector('[aria-label="Revert to the default"]')!);
  expect(window.localStorage.getItem("telar:experiment:tabs")).toBeNull();
});

test("no trial outlives its decide-by date", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const experiment of EXPERIMENTS) {
    expect(experiment.decideBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(experiment.decideBy >= today).toBe(true);
  }
});
