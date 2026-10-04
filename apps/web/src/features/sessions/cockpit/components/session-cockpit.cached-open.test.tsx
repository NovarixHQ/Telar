import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session, Turn } from "@telar/engine-client";

GlobalRegistrator.register({ url: "http://localhost/projects/project_1/sessions/session_a" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

let pathname = "/projects/project_1/sessions/session_a";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionCockpit } = await import("./session-cockpit");
const { SidebarProvider } = await import("@/ui/sidebar");
const { clearConnections } = await import("@/platform/engine");
const { headKey, memoryHeadStore, saveHead, setHeadStore } = await import("../../session-heads");

const STARTED = 1_700_000_000_000;
const turn = (id: string): Turn => ({
  runId: `run_${id}`, sessionId: id, sequence: 1, input: `ask ${id}`, state: "completed", acceptedAt: STARTED, updatedAt: STARTED, resultText: `answer from ${id}`,
});
const record = (id: string): Session =>
  ({
    id, title: id, projectId: "project_1", environmentId: "env_1", state: "active", createdAt: STARTED, updatedAt: STARTED,
    providerInstanceId: "instance_1", driver: "claude", workspace: { mode: "local", path: "/tmp/project_1" }, envMode: "local",
    runtimeMode: "standard", interactionMode: "interactive", detached: false, activity: "idle",
  }) as unknown as Session;
const opening = (id: string) => ({ session: record(id), turns: [turn(id)], items: [], tasks: [], requests: [], cursor: 7, events: [], subscriptions: [] });

const realFetch = globalThis.fetch;
let fetched: string[] = [];
const held: (() => void)[] = [];
let ended = false;

/** Answers every read at once. */
function answering() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const id = /sessions\/([^/?]+)/.exec(url)?.[1] ?? "";
    if (url.includes("/bootstrap")) return Response.json(opening(id));
    if (url.includes("/browser")) return Response.json({ browser: { tabs: [], canStart: false } });
    if (url.includes("/projects")) return Response.json({ projects: [{ id: "project_1", name: "exoplanets", root: "/tmp" }] });
    if (url.includes("/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/inbox")) return Response.json({ inbox: {} });
    if (url.includes("/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
}

/** Records every read and answers none of them until the test ends, then refuses them all. */
function hanging() {
  globalThis.fetch = ((input: string | URL | Request) => {
    fetched.push(String(input));
    const refused = () => Response.json({}, { status: 503 });
    return ended ? Promise.resolve(refused()) : new Promise<Response>((resolve) => held.push(() => resolve(refused())));
  }) as typeof fetch;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  clearConnections();
  setHeadStore(undefined);
  fetched = [];
  ended = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  ended = true;
  for (const release of held.splice(0)) release();
  // The reads behind the refused ones must settle here, not in the next file.
  await flush();
  globalThis.fetch = realFetch;
  setHeadStore(undefined);
  host?.remove();
  root = undefined;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function flush() {
  for (let pass = 0; pass < 10; pass += 1) await act(async () => { await Promise.resolve(); });
}

function render(sessionId: string) {
  pathname = `/projects/project_1/sessions/${sessionId}`;
  act(() => {
    root!.render(
      <SidebarProvider>
        <SessionCockpit projectId="project_1" sessionId={sessionId} projectName="exoplanets" />
      </SidebarProvider>,
    );
  });
}

test("a session held in memory paints in the commit that mounts it, before any read answers", async () => {
  answering();
  render("session_a");
  await flush();
  await act(async () => root!.unmount());
  root = createRoot(host!);

  hanging();
  render("session_a");
  expect(host!.textContent).toContain("answer from session_a");
  expect(host!.textContent).not.toContain("Showing what was recorded");
});

test("a session saved to disk paints before the network, which then asks only for the delta", async () => {
  const store = memoryHeadStore();
  await saveHead(store, headKey("local", "session_b"), { ...opening("session_b"), events: [] }, STARTED);
  setHeadStore(store);

  hanging();
  render("session_b");
  await flush();
  expect(host!.textContent).toContain("answer from session_b");
  expect(host!.textContent).not.toContain("Showing what was recorded");
  const reads = fetched.filter((url) => /\/sessions\/session_b(\/(delta|bootstrap|events)|\?|$)/.test(url));
  expect(reads).toEqual(["/api/sessions/session_b/delta?after=7"]);
});
