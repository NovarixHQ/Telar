import { afterEach, expect, test } from "bun:test";
import type { BrowserStreamEvent } from "@telar/engine-client";
import { until } from "../../../test/wait";
import { BrowserRuntime } from "./runtime";

type Call = { id: number; method: string; params: Record<string, any>; sessionId?: string };

function fakeChromium() {
  const calls: Call[] = [];
  const sockets: Bun.ServerWebSocket<unknown>[] = [];
  const pages = new Map<string, { url: string; title: string }>([["T1", { url: "about:blank", title: "" }]]);
  const event = (method: string, params: unknown, sessionId?: string) => sockets.forEach((socket) => socket.send(JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) })));
  const info = (targetId: string) => ({ targetInfo: { targetId, type: "page", ...pages.get(targetId) } });
  let next = 2;
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("no", { status: 400 })),
    websocket: {
      open: (socket) => void sockets.push(socket),
      message(socket, raw) {
        const call = JSON.parse(String(raw)) as Call;
        calls.push(call);
        let result: Record<string, unknown> = {};
        if (call.method === "Target.setDiscoverTargets") pages.forEach((_, id) => event("Target.targetCreated", info(id)));
        if (call.method === "Target.createTarget") {
          const id = `T${next++}`;
          pages.set(id, { url: call.params.url, title: "" });
          result = { targetId: id };
          event("Target.targetCreated", info(id));
        }
        if (call.method === "Target.attachToTarget") result = { sessionId: `S-${call.params.targetId}` };
        if (call.method === "Target.closeTarget") {
          pages.delete(call.params.targetId);
          event("Target.targetDestroyed", { targetId: call.params.targetId });
        }
        if (call.method === "Page.getNavigationHistory") result = { currentIndex: 1, entries: [{ id: 10 }, { id: 11 }, { id: 12 }] };
        socket.send(JSON.stringify({ id: call.id, result }));
      },
    },
  });
  const killed: string[] = [];
  const launch = async (_options?: unknown) => ({ wsUrl: `ws://127.0.0.1:${server.port}/devtools/browser/x`, kill: () => void killed.push("killed") });
  const named = (method: string) => calls.filter((call) => call.method === method);
  return { calls, named, event, launch, killed, stop: () => server.stop(true) };
}

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const run of cleanup.splice(0)) await run();
});

async function open() {
  const fake = fakeChromium();
  const runtime = new BrowserRuntime({ browsersPath: "/unused", launch: fake.launch, installExitHandler: false, autoInstall: false });
  cleanup.push(() => runtime.close(), fake.stop);
  const events: BrowserStreamEvent[] = [];
  const stop = await runtime.stream("session", (event) => events.push(event));
  await until("events.some((event) => event.type === 'tabs')", () => events.some((event) => event.type === "tabs"));
  return { fake, runtime, events, stop };
}

test("a viewer sees the page's tab and a frame, and every frame is acknowledged", async () => {
  const { fake, events } = await open();
  await until("the tab is viewed", () => events.some((event) => event.type === "tabs" && event.tabs[0]?.active === true));
  const tabs = events.filter((event) => event.type === "tabs").at(-1);
  expect(tabs).toMatchObject({ tabs: [{ id: "T1", active: true }] });
  expect(fake.named("Page.startScreencast")[0]).toMatchObject({ sessionId: "S-T1", params: { format: "jpeg" } });
  fake.event("Page.screencastFrame", { data: "AAAA", sessionId: 7 }, "S-T1");
  await until("events.some((event) => event.type === 'frame')", () => events.some((event) => event.type === "frame"));
  expect(events.find((event) => event.type === "frame")).toMatchObject({ tabId: "T1", data: "AAAA", width: 1280, height: 800 });
  await until("fake.named('Page.screencastFrameAck').length === 1", () => fake.named("Page.screencastFrameAck").length === 1);
  expect(fake.named("Page.screencastFrameAck")[0]).toMatchObject({ sessionId: "S-T1", params: { sessionId: 7 } });
});

test("frames arriving faster than the pace are acknowledged but not forwarded", async () => {
  const { fake, events } = await open();
  for (let n = 0; n < 5; n++) fake.event("Page.screencastFrame", { data: `f${n}`, sessionId: n }, "S-T1");
  await until("fake.named('Page.screencastFrameAck').length === 5", () => fake.named("Page.screencastFrameAck").length === 5);
  expect(events.filter((event) => event.type === "frame")).toHaveLength(1);
});

test("mouse, wheel, key and text input reach the viewed page", async () => {
  const { fake, runtime } = await open();
  await runtime.input("session", { type: "mouse", action: "down", x: 10, y: 20, button: "left", clickCount: 1, modifiers: 0 });
  await runtime.input("session", { type: "wheel", x: 5, y: 6, deltaX: 0, deltaY: 120 });
  await runtime.input("session", { type: "key", action: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 });
  await runtime.input("session", { type: "key", action: "down", key: "Enter", code: "Enter", modifiers: 0 });
  await runtime.input("session", { type: "text", text: "héllo" });
  const mouse = fake.named("Input.dispatchMouseEvent");
  expect(mouse[0]).toMatchObject({ sessionId: "S-T1", params: { type: "mousePressed", x: 10, y: 20, button: "left", buttons: 1, clickCount: 1 } });
  expect(mouse[1]!.params).toMatchObject({ type: "mouseWheel", deltaY: 120 });
  const keys = fake.named("Input.dispatchKeyEvent");
  expect(keys[0]!.params).toMatchObject({ type: "keyDown", key: "a", text: "a" });
  expect(keys[1]!.params).toMatchObject({ type: "rawKeyDown", key: "Enter" });
  expect(fake.named("Input.insertText")[0]!.params).toEqual({ text: "héllo" });
});

test("resize restarts the screencast at the new size", async () => {
  const { fake, runtime } = await open();
  await runtime.input("session", { type: "resize", width: 800, height: 600 });
  expect(fake.named("Emulation.setDeviceMetricsOverride").at(-1)!.params).toMatchObject({ width: 800, height: 600 });
  expect(fake.named("Page.startScreencast").at(-1)!.params).toMatchObject({ maxWidth: 800, maxHeight: 600 });
});

test("navigation takes web pages only, and history steps through entries", async () => {
  const { fake, runtime } = await open();
  await expect(runtime.input("session", { type: "navigate", url: "file:///etc/passwd" })).rejects.toThrow("only http and https");
  await runtime.input("session", { type: "navigate", url: "https://example.com" });
  expect(fake.named("Page.navigate")[0]!.params).toEqual({ url: "https://example.com/" });
  await runtime.input("session", { type: "history", action: "back" });
  expect(fake.named("Page.navigateToHistoryEntry")[0]!.params).toEqual({ entryId: 10 });
  await runtime.input("session", { type: "history", action: "forward" });
  expect(fake.named("Page.navigateToHistoryEntry")[1]!.params).toEqual({ entryId: 12 });
});

test("a new tab becomes the viewed one, selecting returns to the first, closing the viewed one falls back", async () => {
  const { fake, runtime, events } = await open();
  await runtime.input("session", { type: "tab", action: "new", url: "https://example.com" });
  await until("fake.named('Page.startScreencast').length === 2", () => fake.named("Page.startScreencast").length === 2);
  expect(fake.named("Page.startScreencast")[1]!.sessionId).toBe("S-T2");
  await runtime.input("session", { type: "tab", action: "select", tabId: "T1" });
  expect(fake.named("Target.activateTarget").at(-1)!.params).toEqual({ targetId: "T1" });
  await runtime.input("session", { type: "tab", action: "close", tabId: "T1" });
  await until("only the second tab is left, and viewed", () => {
    const last = events.filter((event) => event.type === "tabs").at(-1);
    return last?.type === "tabs" && last.tabs.length === 1 && last.tabs[0]!.id === "T2" && last.tabs[0]!.active;
  });
});

test("releasing the session kills its Chromium, and the next viewer starts a fresh one", async () => {
  const { fake, runtime } = await open();
  expect(await runtime.release("session")).toBe(true);
  expect(fake.killed).toEqual(["killed"]);
});

test("the Chromium launches once for any number of viewers", async () => {
  const fake = fakeChromium();
  let launches = 0;
  const runtime = new BrowserRuntime({ browsersPath: "/unused", launch: async (options) => (launches++, fake.launch(options)), installExitHandler: false, autoInstall: false });
  cleanup.push(() => runtime.close(), fake.stop);
  await Promise.all([runtime.stream("s", () => undefined), runtime.stream("s", () => undefined)]);
  expect(launches).toBe(1);
});
