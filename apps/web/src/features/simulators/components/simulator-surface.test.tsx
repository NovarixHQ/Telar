import { expect, test } from "bun:test";
import { act } from "react";
import type { SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import { click, flush, installTestDom, mount } from "@/test/dom";
import type { SimulatorsApi } from "../api";
import { SimulatorSurface } from "./simulator-surface";

installTestDom();

const iPhone = (booted = false): SimulatorSummary => ({ id: "A1B2", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted, physical: false });
const hub = { requiredVersion: "0.12.0", installedVersions: ["0.12.0"], runningVersion: "0.12.0" };

function fakeApi(initial: SimulatorsState) {
  let state = initial;
  const calls: Array<[string, ...unknown[]]> = [];
  const api: SimulatorsApi = {
    simulators: async () => ({ simulators: state }),
    setSimulatorSettings: async (patch) => {
      calls.push(["setSimulatorSettings", patch]);
      state = { ...state, status: "ready" };
      return { simulatorSettings: { enabled: true, agentAccess: false } };
    },
    bootSimulator: async (id) => {
      calls.push(["bootSimulator", id]);
      state = { ...state, simulators: state.simulators.map((s) => (s.id === id ? { ...s, booted: true } : s)) };
      return { simulator: { ...iPhone(true), id } };
    },
    shutdownSimulator: async (id) => {
      calls.push(["shutdownSimulator", id]);
      state = { ...state, simulators: state.simulators.map((s) => (s.id === id ? { ...s, booted: false } : s)) };
      return { simulator: iPhone(false) };
    },
    sendSimulatorInput: async (id, events) => {
      calls.push(["sendSimulatorInput", id, events]);
      return { sent: events.length };
    },
    simulatorStreamTicket: async () => ({ ticket: "stk_1", expiresAt: 0 }),
    simulatorDetail: async (id) => ({ detail: { id, configuration: {}, foregroundApp: null, readAt: 0 } }),
    simulatorAction: async (id, action) => {
      calls.push(["simulatorAction", id, action]);
      return { detail: { id, configuration: {}, foregroundApp: null, readAt: 0 } };
    },
  };
  return { api, calls, sent: () => calls.filter((call) => call[0] === "sendSimulatorInput").flatMap((call) => call[2] as unknown[]) };
}

const ready = (simulators: SimulatorSummary[]): SimulatorsState => ({ status: "ready", hub, platforms: [{ platform: "ios", available: true }], simulators, errors: [] });
const button = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const text = (label: string) => [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);

async function surface(state: SimulatorsState) {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const fake = fakeApi(state);
  const { host } = await mount(<SimulatorSurface api={fake.api} visible />);
  await flush(() => !host.textContent?.includes("Looking for simulators"));
  return { host, ...fake };
}

test("with simulators off the surface offers to turn them on, and turning them on is one request", async () => {
  const { host, calls } = await surface({ status: "disabled", hub, platforms: [], simulators: [], errors: [] });
  expect(host.textContent).toContain("Simulators are off");
  await click(text("Turn on simulators"));
  expect(calls).toEqual([["setSimulatorSettings", { enabled: true }]]);
});

test("a setup that failed says why", async () => {
  const { host } = await surface({ status: "failed", detail: "npm exited 1", hub, platforms: [], simulators: [], errors: [] });
  expect(host.textContent).toContain("Simulators could not start");
  expect(host.textContent).toContain("npm exited 1");
});

test("a Mac without Xcode shows one actionable state, with the details behind the info button", async () => {
  const detail = "Telar uses the Xcode in Applications.";
  const { host } = await surface({ ...ready([]), platforms: [{ platform: "ios", available: false, reason: "Install Xcode to use iOS Simulators.", detail }] });
  expect(host.textContent).toContain("No simulators on this Mac");
  expect(host.textContent?.match(/Install Xcode to use iOS Simulators\./g)).toHaveLength(1);
  expect(button("Why")?.getAttribute("data-info")).toBe(detail);
});

test("Start boots the simulator and opens it in a tab that streams from the hub with a ticket", async () => {
  const { host, calls } = await surface(ready([iPhone(false)]));
  expect(host.textContent).toContain("iPhone 16");
  expect(host.textContent).toContain("Off");
  await click(text("Start"));
  await flush(() => Boolean(button("Simulator controls")));
  expect(calls[0]).toEqual(["bootSimulator", "A1B2"]);
  expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["", "iPhone 16"]);
  await flush(() => Boolean(host.querySelector("img")));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/simulators/hub/vendor/serve-sim/helper/A1B2/stream.mjpeg?ticket=stk_1");
});

test("the toolbar sends Home and Rotate as input, each Rotate turns one step further, and Power off shuts the simulator down and closes its tab", async () => {
  const { host, calls, sent } = await surface(ready([iPhone(true)]));
  await click(text("Open"));
  await click(button("Home")!);
  await click(button("Rotate")!);
  await click(button("Rotate")!);
  await flush(() => sent().length >= 3);
  expect(sent()).toEqual([{ type: "button", button: "home" }, { type: "orientation", orientation: "landscape_left" }, { type: "orientation", orientation: "portrait_upside_down" }]);
  await click(button("Power off")!);
  await flush(() => !button("Simulator controls"));
  expect(calls.at(-1)).toEqual(["shutdownSimulator", "A1B2"]);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
});

test("a press on the screen is a touch at its place in the frame, and a key is its HID usage", async () => {
  const { sent } = await surface(ready([iPhone(true)]));
  await click(text("Open"));
  const frame = document.querySelector('[data-testid="simulator-frame"]') as HTMLElement;
  frame.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 400, right: 300, bottom: 450, x: 100, y: 50, toJSON: () => ({}) });
  await act(async () => {
    frame.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 150, clientY: 150, pointerId: 1 }));
    frame.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 150, clientY: 150, pointerId: 1 }));
  });
  const screen = document.querySelector('[role="application"]') as HTMLElement;
  await act(async () => {
    screen.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyA", key: "a" }));
  });
  await flush(() => sent().length >= 3);
  expect(sent()).toEqual([
    { type: "touch", phase: "begin", x: 0.25, y: 0.25 },
    { type: "touch", phase: "end", x: 0.25, y: 0.25 },
    { type: "key", phase: "down", usage: 0x04 },
  ]);
});

test("the surface follows its tab params, so a simulator the agent opened shows without a click", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const fake = fakeApi(ready([iPhone(true)]));
  const { host } = await mount(<SimulatorSurface api={fake.api} visible params={{ open: "A1B2", active: "A1B2" }} onParams={() => undefined} />);
  await flush(() => Boolean(button("Simulator controls")));
  expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"]);
});

test("a watch paired with an iPhone shows under it, and opens to a stream of its own without the iPhone's Home and Rotate", async () => {
  const watch: SimulatorSummary = { id: "W1", platform: "ios", name: "Pulso Watch", version: "watchOS 27.0", booted: true, physical: false, pairedWith: "A1B2" };
  const { host } = await surface(ready([iPhone(true), watch]));
  expect(host.textContent).toMatch(/iPhone 16.*Pulso Watch/);
  expect(host.querySelector('[aria-label="Apple Watch"]')).not.toBeNull();
  const opens = [...document.querySelectorAll("button")].filter((node) => node.textContent?.trim() === "Open");
  await click(opens[1]!);
  await flush(() => Boolean(button("Simulator controls")));
  expect(button("Home")).toBeNull();
  expect(button("Rotate")).toBeNull();
  await flush(() => Boolean(host.querySelector("img")));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/simulators/hub/vendor/serve-sim/helper/W1/stream.mjpeg?ticket=stk_1");
});

test("a fresh ticket keeps the playing stream", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const fake = fakeApi(ready([iPhone(true)]));
  let minted = 0;
  fake.api.simulatorStreamTicket = async () => ({ ticket: `stk_${++minted}`, expiresAt: minted === 1 ? Date.now() + 20 : Date.now() + 300_000 });
  const { host } = await mount(<SimulatorSurface api={fake.api} visible params={{ open: "A1B2", active: "A1B2" }} onParams={() => undefined} />);
  await flush(() => Boolean(host.querySelector("img")));
  const src = host.querySelector("img")?.getAttribute("src");
  expect(src).toEndWith("ticket=stk_1");
  for (let turn = 0; turn < 50 && minted < 2; turn += 1) await flush(() => minted >= 2);
  await flush();
  expect(minted).toBe(2);
  expect(host.querySelector("img")?.getAttribute("src")).toBe(src!);
});
