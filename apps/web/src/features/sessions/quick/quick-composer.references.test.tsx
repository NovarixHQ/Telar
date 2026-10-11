import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { flush, installTestDom, mount } from "@/test/dom";
import type { QuickComposerBridge } from "./front-context";

installTestDom();
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

const listing = (...files: string[]) => ({ listing: { files, truncated: false } });
const LOCAL = { projects: [{ id: "project_1", name: "Telar", root: "/tmp", createdAt: 2 }], files: listing("README.md", "src/app.ts") };
const REMOTE = { projects: [{ id: "project_9", name: "Studio", root: "/srv", createdAt: 1 }], files: listing("notes/plan.md") };
let urls: string[] = [];
let remote = false;
let modes: string[] = [];

function wire() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const raw = String(input);
    urls.push(raw);
    const hosted = /^\/api\/hosts\/([^/]+)(\/.*)$/.exec(raw);
    const engine = hosted ? REMOTE : LOCAL;
    const url = hosted ? `/api${hosted[2]}` : raw;
    if (raw === "/api/hosts") return Response.json({ hosts: remote ? [{ id: "studio", name: "Studio Mac", baseUrl: "https://studio", addedAt: 1 }] : [] });
    if (url.endsWith("/files")) return Response.json(engine.files);
    if (url.includes("/api/sessions/live")) return Response.json({ sessions: [], projects: engine.projects, daemonId: hosted ? "studio" : "local" });
    if (url.includes("/api/sessions/stream")) return new Response(new ReadableStream({ start() {} }));
    if (url.includes("/api/projects")) return Response.json({ projects: remote && !hosted ? [] : engine.projects });
    if (url.includes("/api/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/api/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
}

const bridge: QuickComposerBridge = {
  context: async () => null,
  onOpen: () => () => {},
  close: async () => undefined,
  mode: (mode) => void modes.push(mode),
  onResized: () => () => {},
  onMoved: () => () => {},
  sent: async () => undefined,
  hold: () => {},
  failed: () => {},
  onPermissions: () => () => {},
  openSettings: async () => undefined,
};

beforeEach(() => {
  clearConnections();
  window.localStorage.clear();
  urls = [];
  remote = false;
  modes = [];
  wire();
});

const editor = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="composer-editor"]')!;
const options = (host: HTMLElement) => [...host.querySelectorAll('[role="listbox"] [role="option"]')].map((row) => row.textContent ?? "");

async function open() {
  const { host } = await mount(
    <SidebarProvider>
      <QuickComposer bridge={bridge} />
    </SidebarProvider>,
  );
  await flush(() => Boolean(host.querySelector('[aria-label="Project"]')?.textContent?.match(/Telar|Studio/)));
  return host;
}

async function type(host: HTMLElement, text: string) {
  const box = editor(host);
  act(() => {
    box.focus();
    box.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush(() => options(host).some((row) => !row.includes("Reading")));
}

describe("@ in the quick composer", () => {
  test("lists the chosen project's files in a grown window, and picking one inserts the reference", async () => {
    const host = await open();
    await type(host, "look at @READ");
    expect(options(host).some((row) => row.includes("README.md"))).toBe(true);
    expect(modes.at(-1)).toBe("expanded");
    await act(async () => void editor(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await flush();
    expect(editor(host).textContent).toContain("README.md");
    expect(host.querySelector('[role="listbox"][aria-label="Files and folders"]')).toBeNull();
    expect(modes.at(-1)).toBe("compact");
  });

  test("reads a remote project's files from its own host", async () => {
    remote = true;
    const host = await open();
    await type(host, "@plan");
    expect(options(host).some((row) => row.includes("plan.md"))).toBe(true);
    expect(urls).toContain("/api/hosts/studio/projects/project_9/files");
  });
});
