import { expect, test } from "bun:test";
import { act } from "react";
import type { SimulatorInput, SimulatorSummary } from "@telar/engine-client";
import { buttonLabelled, click, flush, installTestDom, mount, stubBoxSize } from "@/test/dom";
import type { SimulatorsApi } from "../api";
import { floatKey, floatSimulator } from "../float";
import { FloatingSimulator } from "./floating-simulator";
import { SimulatorSurface } from "./simulator-surface";

installTestDom();
stubBoxSize(800, 600);

const iPhone: SimulatorSummary = { id: "A1B2", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted: true, physical: false };
const hub = { requiredVersion: "0.12.0", installedVersions: ["0.12.0"], runningVersion: "0.12.0" };

function fakeApi() {
  const sent: SimulatorInput[] = [];
  const api = {
    simulators: async () => ({ simulators: { status: "ready", hub, platforms: [{ platform: "ios", available: true }], simulators: [iPhone], errors: [] } }),
    sendSimulatorInput: async (_id: string, events: SimulatorInput[]) => {
      sent.push(...events);
      return { sent: events.length };
    },
    simulatorStreamTicket: async () => ({ ticket: "stk_1", expiresAt: 0 }),
    simulatorChrome: async () => ({ chrome: null }),
  } as unknown as SimulatorsApi;
  return { api, sent };
}

const labelled = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
const overlay = () => labelled("iPhone 16, floating");
const pointer = (target: Element, type: string, x: number, y: number) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7, button: 0 }));
  });

async function floating(sessionId: string, onOpenInPanel: (id: string) => void = () => undefined) {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const fake = fakeApi();
  const view = await mount(<FloatingSimulator sessionId={sessionId} api={fake.api} onOpenInPanel={onOpenInPanel} />);
  await act(async () => floatSimulator(floatKey(undefined, sessionId), iPhone));
  await flush(() => Boolean(overlay()));
  return { ...fake, ...view };
}

test("Float over chat moves the simulator over the chat, the panel holds a placeholder, and docking brings it back", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
  const { api } = fakeApi();
  const { host } = await mount(
    <>
      <SimulatorSurface api={api} sessionId="session_float" visible params={{ open: "A1B2", active: "A1B2" }} onParams={() => undefined} />
      <FloatingSimulator sessionId="session_float" api={api} onOpenInPanel={() => undefined} />
    </>,
  );
  await flush(() => Boolean(labelled("Float over chat")));
  await click(labelled("Float over chat")!);
  await flush(() => Boolean(overlay()));
  expect(host.textContent).toContain("iPhone 16 is floating over the chat.");
  expect(labelled("Simulator controls")).toBeNull();
  expect(document.querySelectorAll('[data-testid="simulator-frame"]')).toHaveLength(1);
  expect(overlay()?.querySelector('[data-testid="simulator-frame"]')).not.toBeNull();

  await click(buttonLabelled("Open in right panel"));
  await flush(() => !overlay());
  expect(overlay()).toBeNull();
  expect(labelled("Simulator controls")).not.toBeNull();
});

test("Escape and the pill's Open in right panel dock the float and open the panel on that simulator", async () => {
  const opened: string[] = [];
  await floating("session_escape", (id) => opened.push(id));
  await act(async () => {
    overlay()!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", code: "Escape" }));
  });
  expect(overlay()).toBeNull();
  await act(async () => floatSimulator(floatKey(undefined, "session_escape"), iPhone));
  await click(labelled("Open in right panel")!);
  expect(overlay()).toBeNull();
  expect(opened).toEqual(["A1B2", "A1B2"]);
});

test("closing the float ends it without opening the panel", async () => {
  const opened: string[] = [];
  await floating("session_close", (id) => opened.push(id));
  await click(labelled("Close floating simulator")!);
  expect(overlay()).toBeNull();
  expect(opened).toEqual([]);
});

test("a drag moves the float, stops at the chat's edges, and the spot survives a remount", async () => {
  const { unmount } = await floating("session_drag");
  const box = overlay()!;
  const height = parseFloat(box.style.height);
  await pointer(box, "pointerdown", 600, 100);
  await pointer(box, "pointermove", -400, 900);
  await pointer(box, "pointerup", -400, 900);
  expect(box.style.left).toBe("12px");
  expect(box.style.top).toBe(`${600 - 12 - height}px`);
  unmount();
  await floating("session_drag");
  expect(overlay()!.style.left).toBe("12px");
  expect(overlay()!.style.top).toBe(`${600 - 12 - height}px`);
});

test("a corner drag resizes the float at the device's aspect ratio", async () => {
  await floating("session_resize");
  const box = overlay()!;
  const before = { width: parseFloat(box.style.width), height: parseFloat(box.style.height) };
  const corner = box.querySelector('[data-corner="sw"]')!;
  await pointer(corner, "pointerdown", 500, 400);
  await pointer(corner, "pointermove", 560, 400);
  await pointer(corner, "pointerup", 560, 400);
  const after = { width: parseFloat(box.style.width), height: parseFloat(box.style.height) };
  expect(after.width).toBe(before.width - 60);
  expect(after.width / after.height).toBeCloseTo(before.width / before.height, 6);
});

test("a press on the floating screen is a touch at its place in the frame and leaves the float where it is", async () => {
  const { sent } = await floating("session_touch");
  const box = overlay()!;
  const left = box.style.left;
  const frame = box.querySelector('[data-testid="simulator-frame"]') as HTMLElement;
  frame.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 400, right: 300, bottom: 450, x: 100, y: 50, toJSON: () => ({}) });
  await pointer(frame, "pointerdown", 150, 150);
  await pointer(frame, "pointermove", 250, 450);
  await pointer(frame, "pointerup", 250, 450);
  await flush(() => sent.length >= 3);
  expect(sent).toEqual([
    { type: "touch", phase: "begin", x: 0.25, y: 0.25 },
    { type: "touch", phase: "move", x: 0.75, y: 1 },
    { type: "touch", phase: "end", x: 0.75, y: 1 },
  ]);
  expect(box.style.left).toBe(left);
});
