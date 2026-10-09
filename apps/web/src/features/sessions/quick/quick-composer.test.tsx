import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import type { Session } from "@telar/engine-client";
import { flush, installTestDom, mount } from "@/test/dom";
import type { FrontContext, QuickComposerBridge } from "./front-context";

installTestDom();
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  disconnect() {}
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/surface/quick",
  useSearchParams: () => new URLSearchParams(),
}));

const { QuickComposer } = await import("./quick-composer");
const { SidebarProvider } = await import("@/ui/sidebar");
const { clearConnections } = await import("@telar/client/journal");

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];

const session = (id: string, title: string) => ({ id, title, projectId: "project_1", providerInstanceId: "claude", driver: "claude", runtimeMode: "auto" }) as unknown as Session;

function wire() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });
    if (method === "POST" && url.endsWith("/api/projects/project_1/sessions")) return Response.json({ session: session(body.id, body.title) });
    if (url.includes("/attachments")) return Response.json({ attachment: { id: `att_${calls.length}` } });
    if (url.includes("/turns")) return Response.json({ runId: "run_1", state: "queued" });
    if (url.includes("/api/projects")) return Response.json({ projects: [{ id: "project_1", name: "Telar", root: "/tmp", createdAt: 1 }] });
    if (url.includes("/api/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/api/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
}

const GRANTED = { accessibility: true, screen: true };

function fakeBridge(context: FrontContext | null) {
  const sent: Parameters<QuickComposerBridge["sent"]>[0][] = [];
  let closed = 0;
  const bridge: QuickComposerBridge = {
    context: async () => context,
    onOpen: () => () => {},
    close: async () => void (closed += 1),
    resize: () => {},
    sent: async (input) => void sent.push(input),
    openSettings: async () => {},
  };
  return { bridge, sent, closed: () => closed };
}

beforeEach(() => {
  clearConnections();
  window.localStorage.clear();
  calls = [];
  wire();
});

async function open(context: FrontContext | null) {
  const fake = fakeBridge(context);
  const { host } = await mount(
    <SidebarProvider>
      <QuickComposer bridge={fake.bridge} />
    </SidebarProvider>,
  );
  await flush();
  return { host, ...fake };
}

const editor = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="composer-editor"]')!;

async function typeAndPress(host: HTMLElement, text: string, keys: KeyboardEventInit = {}) {
  const box = editor(host);
  act(() => {
    box.textContent = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  await act(async () => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...keys })));
  await flush(() => calls.some((call) => call.url.includes("/turns")));
  await flush();
}

const created = () => calls.find((call) => call.method === "POST" && call.url.endsWith("/api/projects/project_1/sessions"))?.body as { id: string };

describe("the quick composer", () => {
  test("Enter starts a session in the project and hands it back without opening Telar", async () => {
    const { host, sent } = await open({ app: "Notes", title: "", selection: "", screenshot: null, permissions: GRANTED });
    await typeAndPress(host, "Review this PR");
    const { id } = created();
    expect(calls.find((call) => call.url.endsWith(`/api/sessions/${id}/turns`))?.body).toMatchObject({ input: "Review this PR" });
    expect(sent).toEqual([{ route: `/projects/project_1/sessions/${id}`, title: "Review this PR", detail: "Telar", open: false }]);
  });

  test("⌘Enter starts it and asks for Telar to open on it", async () => {
    const { host, sent } = await open({ app: "Notes", title: "", selection: "", screenshot: null, permissions: GRANTED });
    await typeAndPress(host, "Look at this", { metaKey: true });
    expect(sent[0]?.open).toBe(true);
  });

  test("attaches the front window and the selection, each removable", async () => {
    const { host } = await open({ app: "Safari", title: "pull/1439", selection: "two\nlines", screenshot: "data:image/png;base64,iVBORw0KGgo=", permissions: GRANTED });
    const removeShot = host.querySelector('[aria-label="Remove Safari · pull-1439.png"]');
    expect(removeShot).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove Selected text.txt"]')).not.toBeNull();
    await act(async () => (removeShot as HTMLElement).click());
    await flush();
    expect(host.querySelector('[aria-label="Remove Safari · pull-1439.png"]')).toBeNull();
    await typeAndPress(host, "Explain");
    expect(calls.filter((call) => call.url.includes("/attachments"))).toHaveLength(1);
  });

  test("without the permissions it explains them, attaches nothing, and still sends", async () => {
    const { host, sent } = await open({ app: "Notes", title: "", selection: "", screenshot: null, permissions: { accessibility: false, screen: false } });
    expect(host.querySelector('[role="note"]')?.textContent).toContain("Telar needs two permissions");
    expect(host.querySelector('[aria-label^="Remove "]')).toBeNull();
    await typeAndPress(host, "Plain text only");
    expect(sent).toHaveLength(1);
  });

  test("shows no greeting heading", async () => {
    const { host } = await open({ app: "Notes", title: "", selection: "", screenshot: null, permissions: GRANTED });
    expect(host.querySelector("h1")).toBeNull();
    expect(host.textContent).not.toContain("What's next for");
  });

  test("the permissions notice sits above the composer, and Skip hides it for good", async () => {
    const denied = { app: "Notes", title: "", selection: "", screenshot: null, permissions: { accessibility: false, screen: false } };
    const { host } = await open(denied);
    const note = host.querySelector('[role="note"]')!;
    expect(note.compareDocumentPosition(editor(host)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const skip = [...note.querySelectorAll("button")].find((button) => button.textContent === "Skip")!;
    await act(async () => skip.click());
    expect(host.querySelector('[role="note"]')).toBeNull();
    const reopened = await open(denied);
    expect(reopened.host.querySelector('[role="note"]')).toBeNull();
  });

  test("Esc hides it", async () => {
    const { closed } = await open(null);
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(closed()).toBe(1);
  });
});
