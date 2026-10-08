import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session, Turn } from "@telar/engine-client";

GlobalRegistrator.register({ url: "http://localhost/projects/project_1/sessions/session_header_1" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

let pathname = "/projects/project_1/sessions/session_header_1";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionCockpit } = await import("./session-cockpit");
const { stubBoxSize } = await import("@/test/dom");
const { SidebarProvider } = await import("@/ui/sidebar");
const { clearConnections } = await import("@telar/client/journal");

const STARTED = 1_700_000_000_000;

const record = (id: string): Session =>
  ({
    id,
    title: "anchored controls",
    projectId: "project_1",
    environmentId: "env_1",
    state: "active",
    createdAt: STARTED,
    updatedAt: STARTED,
    providerInstanceId: "instance_1",
    driver: "claude",
    workspace: { mode: "local", path: "/tmp/project_1" },
    envMode: "local",
    runtimeMode: "standard",
    interactionMode: "interactive",
    detached: false,
    activity: "idle",
  }) as unknown as Session;

const turn = (id: string): Turn =>
  ({ runId: `run_${id}`, sessionId: id, sequence: 1, input: "hello", state: "completed", acceptedAt: STARTED, updatedAt: STARTED, resultText: "the answer" }) as unknown as Turn;

const realFetch = globalThis.fetch;

function wire(id: string) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/bootstrap")) {
      return Response.json({ session: record(id), turns: [turn(id)], items: [], tasks: [], requests: [], cursor: 1, events: [], subscriptions: [] });
    }
    if (url.includes("/events")) return Response.json({ events: [], cursor: 1, more: false });
    if (url.includes("/browser")) return Response.json({ browser: { tabs: [], canStart: false } });
    if (/\/projects(\?|$)/.test(url)) return Response.json({ projects: [{ id: "project_1", name: "exoplanets", root: "/tmp" }] });
    if (url.includes("/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/inbox")) return Response.json({ inbox: {} });
    if (url.includes("/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
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
  globalThis.fetch = realFetch;
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function settle() {
  for (let pass = 0; pass < 8; pass += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(id: string) {
  pathname = `/projects/project_1/sessions/${id}`;
  window.history.replaceState(null, "", pathname);
  wire(id);
  await act(async () => {
    root!.render(
      <SidebarProvider>
        <SessionCockpit projectId="project_1" sessionId={id} projectName="exoplanets" />
      </SidebarProvider>,
    );
  });
  await settle();
}

async function press(element: HTMLElement) {
  act(() => element.click());
  await settle();
}

const masthead = () => host!.querySelector("header")!;
const panel = () => host!.querySelector('[aria-label="Right panel"]');
const conversation = () => host!.querySelector('[role="log"]')!;
const card = () => host!.querySelector('[aria-label="Workspace card"]')!;
const labelled = (label: string) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const workspaceToggle = () => labelled("Workspace")!;

const panelToggles = () => host!.querySelectorAll('button[aria-label="Open right panel"], button[aria-label="Close right panel"]');

describe("the header's controls", () => {
  test("Workspace stays in the chat header; the panel toggle moves to the panel's strip while it is open", async () => {
    await show("session_header_1");
    expect(panel()).toBeNull();
    expect(masthead().contains(workspaceToggle())).toBe(true);
    expect(masthead().contains(labelled("Open right panel"))).toBe(true);

    await press(labelled("Open right panel")!);
    expect(panelToggles()).toHaveLength(1);
    expect(panel()!.contains(labelled("Close right panel"))).toBe(true);
    expect(masthead().contains(workspaceToggle())).toBe(true);
    expect(panel()!.contains(workspaceToggle())).toBe(false);
  });

  test("the same button closes the panel it opened", async () => {
    await show("session_header_2");
    await press(labelled("Open right panel")!);
    await press(labelled("Close right panel")!);
    expect(panelToggles()).toHaveLength(1);
    expect(labelled("Open right panel")).not.toBeNull();
    expect(masthead().contains(workspaceToggle())).toBe(true);
  });
});

const key = (name: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: name })));
const pointerDown = (target: Element) => act(() => void target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
const cardOpen = () => workspaceToggle().getAttribute("aria-pressed") === "true";

describe("the Workspace card beside a wide chat, and as a popover", () => {
  stubBoxSize(1400, 900);

  test("docked, it sits outside the transcript and stays open through Esc and clicks on the conversation", async () => {
    await show("session_header_3");
    expect(cardOpen()).toBe(true);
    expect(conversation().contains(card())).toBe(false);
    expect(masthead().contains(card())).toBe(false);
    await key("Escape");
    await pointerDown(conversation());
    expect(cardOpen()).toBe(true);
  });

  test("with the panel open it becomes a popover the toggle opens and Esc closes", async () => {
    await show("session_header_5");
    await press(labelled("Open right panel")!);
    expect(cardOpen()).toBe(false);
    await press(workspaceToggle());
    expect(cardOpen()).toBe(true);
    expect(panel()!.contains(card())).toBe(false);
    await key("Escape");
    expect(cardOpen()).toBe(false);
  });

  test("as a popover, a click on the conversation closes it and a click inside does not", async () => {
    await show("session_header_6");
    await press(labelled("Open right panel")!);
    await press(workspaceToggle());
    await pointerDown(card());
    expect(cardOpen()).toBe(true);
    await pointerDown(conversation());
    expect(cardOpen()).toBe(false);
  });
});
