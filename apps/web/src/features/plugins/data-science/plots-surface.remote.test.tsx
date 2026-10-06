import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { TurnAttachment } from "@telar/engine-client";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { PlotsSurface } = await import("./plots-surface");
const { CellOutputView } = await import("./cell-output");

const PLOT: TurnAttachment = { id: "plot_1", name: "plot_1.png", mediaType: "image/png", bytes: 1, path: "/tmp/plot_1.png", tags: ["plot"], title: "Radius", createdAt: 1 };

const realFetch = globalThis.fetch;
const realSetTimeout = window.setTimeout;

beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ attachments: [PLOT] }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  window.setTimeout = ((fn: () => void) => {
    queueMicrotask(fn);
    return 0;
  }) as unknown as typeof window.setTimeout;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.setTimeout = realSetTimeout;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  for (let i = 0; i < 10; i++) await act(async () => await Promise.resolve());
  return { host, done: () => act(() => root.unmount()) };
}

test("a remote host's plot image is fetched through that host", async () => {
  const { host, done } = await mount(<PlotsSurface sessionId="session_1" hostId="mac-2" />);
  expect(host.querySelector('img[alt="Radius"]')?.getAttribute("src")).toBe("/api/hosts/mac-2/sessions/session_1/attachments/plot_1");
  done();
});

test("a remote host's notebook figure is fetched through that host", async () => {
  const output = { kind: "image", mediaType: "image/png", attachmentId: "plot_1" } as const;
  const { host, done } = await mount(<CellOutputView output={output} sessionId="session_1" hostId="mac-2" />);
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/hosts/mac-2/sessions/session_1/attachments/plot_1");
  done();
});

test("this Mac's plot image stays on the local engine", async () => {
  const { host, done } = await mount(<PlotsSurface sessionId="session_1" />);
  expect(host.querySelector('img[alt="Radius"]')?.getAttribute("src")).toBe("/api/sessions/session_1/attachments/plot_1");
  done();
});
