import { expect, test } from "bun:test";
import { act } from "react";
import type { SimulatorAction, SimulatorConfiguration, SimulatorSummary } from "@telar/engine-client";
import { click, flush, installTestDom, mount, press } from "@/test/dom";
import type { SimulatorsApi } from "../api";
import { SimulatorSettings } from "./simulator-settings";

installTestDom();

const iPhone: SimulatorSummary = { id: "A1B2", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted: true, physical: false };

async function drawer(configuration: SimulatorConfiguration, refuse?: string) {
  const actions: SimulatorAction[] = [];
  let current = configuration;
  const detail = () => ({ detail: { id: "A1B2", configuration: current, foregroundApp: null, readAt: 0 } });
  const api = {
    simulatorDetail: async () => detail(),
    simulatorAction: async (_id: string, action: SimulatorAction) => {
      actions.push(action);
      if (refuse) throw new Error(refuse);
      if (action.type === "setAppearance") current = { ...current, appearance: action.value };
      return detail();
    },
  } as unknown as SimulatorsApi;
  const { host } = await mount(<SimulatorSettings simulator={iPhone} api={api} visible onClose={() => undefined} />);
  await flush(() => !host.textContent?.includes("Reading"));
  return { host, actions };
}

const pressed = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);

test("the drawer shows what the simulator reports and changes it one action at a time", async () => {
  const { host, actions } = await drawer({ appearance: "light", reduceMotion: false });
  expect(pressed(host, "Light")?.getAttribute("aria-pressed")).toBe("true");
  await click(pressed(host, "Dark"));
  expect(actions).toEqual([{ type: "setAppearance", value: "dark" }]);
  expect(pressed(host, "Dark")?.getAttribute("aria-pressed")).toBe("true");
  await press(host.querySelector('[aria-label="Reduce motion"]')!);
  await flush();
  expect(actions.at(-1)).toEqual({ type: "setToggle", setting: "reduceMotion", value: true });
});

test("a switch the simulator did not report stays off and disabled", async () => {
  const { host } = await drawer({});
  expect(host.querySelector('[aria-label="Screen reader"]')?.hasAttribute("data-disabled") || (host.querySelector('[aria-label="Screen reader"]') as HTMLButtonElement)?.disabled).toBe(true);
});

test("app actions use the typed app id, and a refusal is shown", async () => {
  const { host, actions } = await drawer({}, "launchApp failed (exit code 1).");
  const input = host.querySelector('[aria-label="App ID"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "com.example.app");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(pressed(host, "Launch"));
  expect(actions).toEqual([{ type: "launchApp", appId: "com.example.app" }]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("launchApp failed (exit code 1).");
});
