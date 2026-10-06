import { expect, test } from "bun:test";
import type { SimulatorSettings } from "@telar/engine-client";
import { flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { SimulatorsSection } from "./simulators-section";

installTestDom();

async function mountSection(initial: SimulatorSettings, refuse?: string) {
  let settings = initial;
  const calls = stubFetch({
    "GET /api/simulator-settings": () => ({ simulatorSettings: settings }),
    "PATCH /api/simulator-settings": (body) => {
      if (refuse) throw new Error(refuse);
      settings = { ...settings, ...(body as Partial<SimulatorSettings>) };
      if (!settings.enabled) settings.agentAccess = false;
      return { simulatorSettings: settings };
    },
  });
  const { host } = await mount(<SimulatorsSection />);
  await flush(() => calls.some((call) => call.route === "GET /api/simulator-settings"));
  await flush();
  return { host, calls, toggle: () => host.querySelector('[aria-label="Use simulators"]')!, agents: () => host.querySelector('[aria-label="Let agents use simulators"]')! };
}

test("the switch shows the engine's answer and turning it on is one patch", async () => {
  const { host, calls, toggle } = await mountSection({ enabled: false, agentAccess: false });
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  await press(toggle());
  await flush();
  expect(calls.filter((call) => call.route === "PATCH /api/simulator-settings").map((call) => call.body)).toEqual([{ enabled: true }]);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(host.textContent).toContain("Lets Telar list, start and stop the simulators on this Mac.");
});

test("a refused change shows the engine's reason and keeps the switch where it was", async () => {
  const { host, toggle } = await mountSection({ enabled: false, agentAccess: false }, "simulators are not available");
  await press(toggle());
  await flush();
  expect(host.textContent).toContain("simulators are not available");
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});

test("agents get access only once simulators are on, and turning simulators off takes it back", async () => {
  const { calls, toggle, agents } = await mountSection({ enabled: false, agentAccess: false });
  await press(agents());
  await flush();
  expect(agents().getAttribute("aria-checked")).toBe("false");
  await press(toggle());
  await flush();
  await press(agents());
  await flush();
  expect(agents().getAttribute("aria-checked")).toBe("true");
  await press(toggle());
  await flush();
  expect(agents().getAttribute("aria-checked")).toBe("false");
  expect(calls.filter((call) => call.route === "PATCH /api/simulator-settings").map((call) => call.body)).toEqual([{ enabled: true }, { agentAccess: true }, { enabled: false }]);
});
