import { expect, test } from "bun:test";
import type { SimulatorSettings } from "@telar/engine-client";
import { flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { SimulatorsRows } from "./simulators-section";

installTestDom();

async function mountSection(initial: SimulatorSettings, refuse?: string) {
  let settings = initial;
  const calls = stubFetch({
    "GET /api/simulator-settings": () => ({ simulatorSettings: settings }),
    "PATCH /api/simulator-settings": (body) => {
      if (refuse) throw new Error(refuse);
      settings = { ...settings, ...(body as Partial<SimulatorSettings>) };
      return { simulatorSettings: settings };
    },
  });
  const { host } = await mount(<SimulatorsRows />);
  await flush(() => calls.some((call) => call.route === "GET /api/simulator-settings"));
  await flush();
  const switches = () => [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
  const checked = () => switches().map((element) => element.getAttribute("aria-checked") === "true");
  const patches = () => calls.filter((call) => call.route === "PATCH /api/simulator-settings").map((call) => call.body);
  return { host, switches, checked, patches };
}

test("the device hub and agent device access are two switches, read from the engine", async () => {
  const { host, checked } = await mountSection({ enabled: true, agentAccess: true });
  expect(host.textContent).toContain("Device hub");
  expect(host.textContent).toContain("Agent device access");
  expect(checked()).toEqual([true, true]);
});

test("agent access waits for the hub, and turning the hub off takes agents with it", async () => {
  const { host, switches, checked, patches } = await mountSection({ enabled: false, agentAccess: false });
  expect(host.textContent).toContain("Turn on the device hub first.");

  await press(switches()[0]!);
  await press(switches()[1]!);
  expect(checked()).toEqual([true, true]);
  await press(switches()[0]!);
  expect(patches()).toEqual([{ enabled: true }, { agentAccess: true }, { enabled: false, agentAccess: false }]);
  expect(checked()).toEqual([false, false]);
});

test("a refused change shows the engine's reason on its row and keeps the switch where it was", async () => {
  const { host, switches, checked } = await mountSection({ enabled: false, agentAccess: false }, "simulators are not available");
  await press(switches()[0]!);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("simulators are not available");
  expect(checked()).toEqual([false, false]);
});
