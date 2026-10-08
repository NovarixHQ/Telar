import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session } from "@telar/engine-client";

GlobalRegistrator.register({ url: "http://localhost/projects/project_1/sessions/session_open_1" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

let pathname = "/projects/project_1/sessions/session_open_1";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionCockpit } = await import("./session-cockpit");
const { SidebarProvider } = await import("@/ui/sidebar");
const { clearConnections } = await import("@/platform/engine");
const { LOCAL_HOST_ID } = await import("@/platform/engine/host-client");

const STARTED = 1_700_000_000_000;

const record = (id: string): Session =>
  ({
    id, title: "Fix the orbit solver", projectId: "project_1", environmentId: "env_1", state: "active", createdAt: STARTED, updatedAt: STARTED,
    providerInstanceId: "instance_1", driver: "claude", workspace: { mode: "local", path: "/tmp/project_1" }, envMode: "local",
    runtimeMode: "standard", interactionMode: "interactive", detached: false, activity: "idle",
  }) as unknown as Session;

const realFetch = globalThis.fetch;
let answerBootstrap: () => void = () => {};

function holdBootstrap(id: string) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/bootstrap")) {
      return new Promise<Response>((resolve) => {
        answerBootstrap = () => resolve(Response.json({ session: record(id), turns: [], items: [], tasks: [], requests: [], cursor: 1, events: [], subscriptions: [] }));
      });
    }
    if (url.includes("/events")) return Response.json({ events: [], cursor: 1, more: false });
    if (/\/projects(\?|$)/.test(url)) return Response.json({ projects: [{ id: "project_1", name: "exoplanets", root: "/tmp" }] });
    if (url.includes("/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/models")) return Response.json({ catalogue: { models: [] } });
    if (url.includes("/inbox")) return Response.json({ inbox: {} });
    return Response.json({});
  }) as typeof fetch;
}

function rememberInRail(id: string, title: string) {
  const row = { id, title, projectId: "project_1", projectName: "exoplanets", createdAt: STARTED, updatedAt: STARTED, archived: false, driver: "claude" };
  localStorage.setItem("telar-sidebar-cache", JSON.stringify({ [LOCAL_HOST_ID]: { savedAt: STARTED, sessions: [row] } }));
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  clearConnections();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  answerBootstrap();
  globalThis.fetch = realFetch;
  if (root) await act(async () => root!.unmount());
  host?.remove();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function open(id: string) {
  pathname = `/projects/project_1/sessions/${id}`;
  holdBootstrap(id);
  await act(async () => {
    root!.render(
      <SidebarProvider>
        <SessionCockpit projectId="project_1" sessionId={id} />
      </SidebarProvider>,
    );
  });
}

const header = () => host!.querySelector("header")!.textContent ?? "";
const text = () => host!.textContent ?? "";

test("an opening session shows the rail's title and project at once, and a quiet skeleton for the transcript", async () => {
  rememberInRail("session_open_1", "Fix the orbit solver");
  await open("session_open_1");
  expect(header()).toContain("Fix the orbit solver");
  expect(header()).toContain("exoplanets");
  expect(header()).not.toContain("New conversation");
  expect(host!.querySelector('[aria-label="Loading session"]')).not.toBeNull();
  expect(text()).not.toContain("Hydrating");
  expect(text()).not.toContain("journal");
  expect(text()).not.toContain("Waiting for the session");
});

test("without a cached row the title is a placeholder, never \"New conversation\", until the record arrives", async () => {
  await open("session_open_2");
  expect(header()).not.toContain("New conversation");
  await act(async () => answerBootstrap());
  await act(async () => await new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(header()).toContain("Fix the orbit solver");
  expect(host!.querySelector('[aria-label="Loading session"]')).toBeNull();
});
