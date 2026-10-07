import { expect, test } from "bun:test";
import type { SimulatorSettings } from "@telar/engine-client";
import { buttonLabelled, flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { SimulatorsSection } from "./simulators-section";

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
  const { host } = await mount(<SimulatorsSection />);
  await flush(() => calls.some((call) => call.route === "GET /api/simulator-settings"));
  await flush();
  const option = (label: string) => buttonLabelled(label, host)!;
  const chosen = () => host.querySelector('[aria-pressed="true"]')?.textContent;
  const patches = () => calls.filter((call) => call.route === "PATCH /api/simulator-settings").map((call) => call.body);
  return { host, option, chosen, patches };
}

test("one row says who may use simulators, from the engine's answer", async () => {
  const { host, chosen } = await mountSection({ enabled: true, agentAccess: true });
  expect(chosen()).toBe("You and agents");
  expect(host.querySelector('[role="switch"]')).toBeNull();
});

test("each choice is one patch that sets both keys", async () => {
  const { option, chosen, patches } = await mountSection({ enabled: false, agentAccess: false });
  expect(chosen()).toBe("Off");
  await press(option("You and agents"));
  await press(option("You"));
  await press(option("Off"));
  expect(patches()).toEqual([
    { enabled: true, agentAccess: true },
    { enabled: true, agentAccess: false },
    { enabled: false, agentAccess: false },
  ]);
  expect(chosen()).toBe("Off");
});

test("a refused change shows the engine's reason in the row and keeps the choice where it was", async () => {
  const { host, option, chosen } = await mountSection({ enabled: false, agentAccess: false }, "simulators are not available");
  await press(option("You"));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("simulators are not available");
  expect(chosen()).toBe("Off");
});
