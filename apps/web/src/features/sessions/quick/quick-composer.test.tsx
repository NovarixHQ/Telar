import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import type { Session } from "@telar/engine-client";
import { flush, installTestDom, mount } from "@/test/dom";
import type { FrontContext, Permission, Permissions, QuickComposerBridge } from "./front-context";

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

const PROJECTS = [
  { id: "project_1", name: "Telar", root: "/tmp", createdAt: 2 },
  { id: "project_2", name: "exoplanets", root: "/tmp/exo", createdAt: 1 },
];
const live = (id: string, title: string, projectId: string, activity: string, updatedAt: number) => ({ id, title, projectId, activity, updatedAt, state: "active", createdAt: 1 });
const LIVE = [
  live("s_transit", "Transit light-curve analysis", "project_2", "idle", 300),
  live("s_sales", "Sales dashboard and checkout", "project_2", "blocked", 100),
  live("s_readme", "Expand scratch README", "project_1", "working", 50),
];

function wire() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });
    const create = /\/api\/projects\/(project_\d)\/sessions$/.exec(url);
    if (method === "POST" && create) return Response.json({ session: { ...session(body.id, body.title), projectId: create[1] } });
    if (url.includes("/api/sessions/live")) return Response.json({ sessions: LIVE, projects: PROJECTS });
    if (url.includes("/answer")) return Response.json({ runId: "run_9", sequence: 3, text: "Need to run the build first.\n\n**Shall I run it?**", from: 0, totalChars: 46, more: false });
    if (url.includes("/attachments")) return Response.json({ attachment: { id: `att_${calls.length}` } });
    if (url.includes("/turns")) return Response.json({ runId: "run_1", state: "queued" });
    if (url.includes("/api/projects")) return Response.json({ projects: PROJECTS });
    if (url.includes("/api/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/api/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
}

const GRANTED = { accessibility: true, screen: true };
const DENIED = { accessibility: false, screen: false };

function fakeBridge(context: FrontContext | null) {
  const sent: Parameters<QuickComposerBridge["sent"]>[0][] = [];
  const settings: Permission[] = [];
  let closed = 0;
  let held = 0;
  const drags: unknown[] = [];
  let pushPermissions: (permissions: Permissions) => void = () => {};
  const bridge: QuickComposerBridge = {
    context: async () => context,
    onOpen: () => () => {},
    close: async () => void (closed += 1),
    resize: () => {},
    sent: async (input) => void sent.push(input),
    onPermissions: (listener) => {
      pushPermissions = listener;
      return () => {};
    },
    openSettings: async (permission) => void settings.push(permission),
    hold: () => void (held += 1),
    failed: () => {},
    drag: (input) => void drags.push(input),
  };
  return { bridge, sent, settings, drags, closed: () => closed, held: () => held, recheck: (permissions: Permissions) => act(() => pushPermissions(permissions)) };
}

const front = (permissions: Permissions, extra: Partial<FrontContext> = {}): FrontContext => ({ app: "Notes", title: "", selection: "", screenshot: null, permissions, grantee: "Telar Dev", ...extra });

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

async function type(host: HTMLElement, text: string) {
  const box = editor(host);
  act(() => {
    box.textContent = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

async function press(host: HTMLElement, key: string, keys: KeyboardEventInit = {}) {
  await act(async () => void editor(host).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...keys })));
  await flush();
}

const options = (host: HTMLElement) => [...host.querySelectorAll('[role="option"]')].map((row) => row.textContent ?? "");

async function typeAndPress(host: HTMLElement, text: string, keys: KeyboardEventInit = {}) {
  await type(host, text);
  const box = editor(host);
  await act(async () => void box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...keys })));
  await flush(() => calls.some((call) => call.url.includes("/turns")));
  await flush();
}

const created = () => calls.find((call) => call.method === "POST" && call.url.endsWith("/api/projects/project_1/sessions"))?.body as { id: string };

describe("the quick composer", () => {
  test("Enter starts a session in the project and hands it back without opening Telar", async () => {
    const { host, sent } = await open(front(GRANTED));
    await typeAndPress(host, "Review this PR");
    const { id } = created();
    expect(calls.find((call) => call.url.endsWith(`/api/sessions/${id}/turns`))?.body).toMatchObject({ input: "Review this PR" });
    expect(sent).toEqual([{ route: `/projects/project_1/sessions/${id}`, title: "Review this PR", detail: "Telar", open: false }]);
  });

  test("⌘Enter starts it and asks for Telar to open on it", async () => {
    const { host, sent } = await open(front(GRANTED));
    await typeAndPress(host, "Look at this", { metaKey: true });
    expect(sent[0]?.open).toBe(true);
  });

  test("offers the front window and the selection without attaching them", async () => {
    const { host } = await open(front(GRANTED, { app: "Safari", title: "pull/1439", selection: "two\nlines", screenshot: "data:image/png;base64,iVBORw0KGgo=" }));
    expect(host.querySelector('[aria-label^="Remove "]')).toBeNull();
    const offer = [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Attach pull/1439"))!;
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Attach selected text")).toBe(true);
    await act(async () => offer.click());
    await flush();
    expect(host.querySelector('[aria-label="Remove Safari · pull-1439.png"]')).not.toBeNull();
    await typeAndPress(host, "Explain");
    expect(calls.filter((call) => call.url.includes("/attachments"))).toHaveLength(1);
  });

  test("⌘⇧A attaches the front window, and again takes it off", async () => {
    const { host } = await open(front(GRANTED, { app: "Safari", title: "pull/1439", screenshot: "data:image/png;base64,iVBORw0KGgo=" }));
    await press(host, "A", { metaKey: true, shiftKey: true });
    expect(host.querySelector('[aria-label="Remove Safari · pull-1439.png"]')).not.toBeNull();
    await press(host, "A", { metaKey: true, shiftKey: true });
    expect(host.querySelector('[aria-label="Remove Safari · pull-1439.png"]')).toBeNull();
  });

  test("without the permissions it explains them, attaches nothing, and still sends", async () => {
    const { host, sent } = await open(front(DENIED));
    expect(host.querySelector('[role="note"]')?.textContent).toContain("Allow “Telar Dev”");
    expect(host.querySelector('[aria-label^="Remove "]')).toBeNull();
    await typeAndPress(host, "Plain text only");
    expect(sent).toHaveLength(1);
  });

  test("shows no greeting heading", async () => {
    const { host } = await open(front(GRANTED));
    expect(host.querySelector("h1")).toBeNull();
    expect(host.textContent).not.toContain("What's next for");
  });

  test("the permissions notice sits above the composer, and Skip hides it for good", async () => {
    const denied = front(DENIED);
    const { host } = await open(denied);
    const note = host.querySelector('[role="note"]')!;
    expect(note.compareDocumentPosition(editor(host)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const skip = [...note.querySelectorAll("button")].find((button) => button.textContent === "Skip")!;
    await act(async () => skip.click());
    expect(host.querySelector('[role="note"]')).toBeNull();
    const reopened = await open(denied);
    expect(reopened.host.querySelector('[role="note"]')).toBeNull();
  });

  test("each missing permission gets its own button, and a granted one says so", async () => {
    const { host, settings } = await open(front({ accessibility: true, screen: false }));
    const row = (key: Permission) => host.querySelector<HTMLElement>(`[data-permission="${key}"]`)!;
    expect(row("accessibility").textContent).toContain("Granted");
    expect(row("accessibility").querySelector("button")).toBeNull();
    await act(async () => row("screen").querySelector("button")!.click());
    expect(settings).toEqual(["screen"]);
  });

  test("a grant made in System Settings updates the rows, and the notice goes once both are in", async () => {
    const { host, recheck } = await open(front(DENIED));
    recheck({ accessibility: true, screen: false });
    expect(host.querySelector('[data-permission="accessibility"]')?.textContent).toContain("Granted");
    expect(host.querySelector('[data-permission="screen"] button')).not.toBeNull();
    recheck(GRANTED);
    expect(host.querySelector('[role="note"]')).toBeNull();
  });

  test("the project picker sits in the card's control row, with the send hint under the card", async () => {
    const { host } = await open(front(GRANTED));
    const controls = host.querySelector('[data-slot="composer-controls"]')!;
    expect(controls.querySelector('[aria-label="Project"]')?.textContent).toContain("Telar");
    const hint = host.querySelector('[data-slot="quick-hint"]')!;
    expect(hint.textContent).toBe("↵ send · ⌘↵ send & open · # destination · esc close");
    expect(editor(host).compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("names its destination once, in the chip, with no strip under the card", async () => {
    const { host } = await open(front(GRANTED));
    expect(host.querySelectorAll('[aria-label="Project"]')).toHaveLength(1);
    expect(host.querySelector('[data-slot="composer-foot"]')?.textContent ?? "").not.toContain("Telar");
  });

  test("opening the file picker keeps it up while the picker has focus", async () => {
    const { host, held } = await open(front(GRANTED));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(held()).toBe(1);
  });

  test("dragging the hint hands main the grab point once, and the release once", async () => {
    const { host, drags } = await open(front(GRANTED));
    const hint = host.querySelector<HTMLElement>('[data-slot="quick-hint"]')!;
    const surface = hint.closest('[data-surface="quick"]')!;
    act(() => {
      hint.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 300, clientY: 180, screenX: 100, screenY: 50 }));
      for (const x of [110, 130, 160]) surface.dispatchEvent(new PointerEvent("pointermove", { screenX: x, screenY: 40 }));
      surface.dispatchEvent(new PointerEvent("pointerup", {}));
    });
    expect(drags).toEqual([{ phase: "start", offsetX: 300, offsetY: 180 }, { phase: "end" }]);
  });

  test("the empty field drags once the press moves, a click there does not, and a field with text never does", async () => {
    const { host, drags } = await open(front(GRANTED));
    const surface = host.querySelector('[data-surface="quick"]')!;
    const press = (moveTo: number) =>
      act(() => {
        editor(host).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 30, screenX: 0, screenY: 0 }));
        surface.dispatchEvent(new PointerEvent("pointermove", { screenX: moveTo, screenY: 0 }));
        surface.dispatchEvent(new PointerEvent("pointerup", {}));
      });
    press(1);
    expect(drags).toEqual([]);
    press(20);
    expect(drags).toEqual([{ phase: "start", offsetX: 40, offsetY: 30 }, { phase: "end" }]);
    await type(host, "half a thought");
    press(20);
    expect(drags).toHaveLength(2);
  });

  test("dragging the card's padding moves the window, but the text field and buttons never start a drag", async () => {
    const { host, drags } = await open(front(GRANTED));
    const surface = host.querySelector('[data-surface="quick"]')!;
    const down = (target: Element) => act(() => void target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, screenX: 10, screenY: 10 })));
    const up = () => act(() => void surface.dispatchEvent(new PointerEvent("pointerup", {})));
    await type(host, "draft");
    down(editor(host));
    down(host.querySelector('[aria-label="Project"]')!);
    up();
    expect(drags).toEqual([]);
    down(host.querySelector('[data-slot="input-group"]')!);
    up();
    expect(drags).toEqual([{ phase: "start", offsetX: 0, offsetY: 0 }, { phase: "end" }]);
  });

  test("on text, only a press held for a moment drags; a quick sweep is left to select", async () => {
    const { host, drags } = await open(front(DENIED));
    const text = host.querySelector('[role="note"] p')!;
    const surface = host.querySelector('[data-surface="quick"]')!;
    const at = (type: string, init: PointerEventInit, timeStamp: number) => {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
      Object.defineProperty(event, "timeStamp", { value: timeStamp });
      act(() => void (type === "pointerdown" ? text : surface).dispatchEvent(event));
    };
    at("pointerdown", { screenX: 0, screenY: 0 }, 1000);
    at("pointermove", { screenX: 20, screenY: 0 }, 1050);
    expect(drags).toEqual([]);
    at("pointerdown", { screenX: 0, screenY: 0 }, 2000);
    at("pointermove", { screenX: 1, screenY: 0 }, 2200);
    at("pointerup", {}, 2300);
    expect(drags).toEqual([{ phase: "start", offsetX: 0, offsetY: 0 }, { phase: "end" }]);
  });

  test("the empty composer says # picks where the message goes, and so does the hint", async () => {
    const { host } = await open(front(GRANTED));
    expect(host.querySelector('[data-slot="input-group"]')?.textContent).toContain("Ask anything · # to reply to a session or pick a project · / commands");
    expect(host.querySelector('[data-slot="quick-hint"]')?.textContent).toContain("# destination");
  });

  test("pressing a button in the control row does not drag", async () => {
    const { host, drags } = await open(front(GRANTED));
    const send = host.querySelector('[data-slot="composer-controls"] button')!;
    act(() => void send.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
    expect(drags).toEqual([]);
  });

  test("Esc hides it", async () => {
    const { closed } = await open(null);
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(closed()).toBe(1);
  });
});

describe("the # destination picker", () => {
  test("lists a new session in the current project, then sessions running or waiting before the most recent", async () => {
    const { host } = await open(front(GRANTED));
    await type(host, "#");
    await flush(() => options(host).length > 1);
    expect(options(host).map((row) => row.split(/(?=Telar|exoplanets)/)[0]).reverse()).toEqual([
      "New session in ",
      "Sales dashboard and checkout",
      "Expand scratch README",
      "Transit light-curve analysis",
    ]);
  });

  test("opens above the composer, its best row nearest the card", async () => {
    const { host } = await open(front(GRANTED));
    await type(host, "#");
    const list = host.querySelector('[role="listbox"]')!;
    expect(list.compareDocumentPosition(editor(host)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await flush(() => options(host).length > 1);
    expect(options(host).at(-1)).toContain("New session in Telar");
    expect(host.querySelector('[aria-selected="true"]')).toBe(list.lastElementChild);
  });

  test("filters projects and sessions together", async () => {
    const { host } = await open(front(GRANTED));
    await type(host, "#exo");
    await flush(() => options(host).length > 1);
    expect(options(host).at(-1)).toContain("New session in exoplanets");
    expect(options(host).slice(0, -1).map((row) => row.slice(0, 12))).toEqual(["Transit ligh", "Sales dashbo"]);
  });

  test("↓ and ↵ attach a session; sending replies to it instead of starting one", async () => {
    const { host, sent } = await open(front(GRANTED));
    await type(host, "#exo");
    await flush(() => options(host).length > 1);
    await press(host, "ArrowUp");
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("Sales dashboard");
    await press(host, "ArrowDown");
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("New session in exoplanets");
    await press(host, "ArrowUp");
    await press(host, "Enter");
    await flush(() => Boolean(host.querySelector('[data-slot="quick-reply"] p')));
    const card = host.querySelector('[data-slot="quick-destination"]')!;
    expect(card.textContent).toContain("Sales dashboard and checkout");
    expect(card.textContent).toContain("exoplanets · Waiting on you");
    const reply = card.querySelector('[data-slot="quick-reply"]')!;
    expect(reply.querySelectorAll("p")).toHaveLength(2);
    expect(reply.textContent).toContain("Shall I run it?");
    expect(reply.textContent).not.toContain("**");
    const more = [...card.querySelectorAll("button")].find((button) => button.textContent === "Show full reply")!;
    await act(async () => more.click());
    expect(more.textContent).toBe("Collapse");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await typeAndPress(host, "Yes, go ahead", { metaKey: true });
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/sessions/s_sales/turns"))?.body).toMatchObject({ input: "Yes, go ahead" });
    expect(calls.some((call) => call.method === "POST" && /\/api\/projects\/.*\/sessions$/.test(call.url))).toBe(false);
    expect(sent).toEqual([{ route: "/projects/project_2/sessions/s_sales", title: "Sales dashboard and checkout", detail: "exoplanets", open: true }]);
  });

  test("⌫ in an empty composer detaches the session, and so does its ✕", async () => {
    const { host } = await open(front(GRANTED));
    const attach = async () => {
      await type(host, "#readme");
      await flush(() => options(host).length > 0);
      await press(host, "Enter");
    };
    await attach();
    expect(host.querySelector('[data-slot="quick-destination"]')).not.toBeNull();
    await type(host, "");
    await press(host, "Backspace");
    expect(host.querySelector('[data-slot="quick-destination"]')).toBeNull();
    await attach();
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Detach session"]')!.click());
    expect(host.querySelector('[data-slot="quick-destination"]')).toBeNull();
  });

  test("⌥↵ on a project starts the session there in a new worktree", async () => {
    const { host, sent } = await open(front(GRANTED));
    await type(host, "#exo");
    await flush(() => options(host).length > 1);
    await press(host, "Enter", { altKey: true });
    expect(host.querySelector('[data-slot="quick-destination"]')?.textContent).toContain("exoplanets· new worktree");
    await typeAndPress(host, "Fix the CI build");
    expect(calls.find((call) => call.method === "POST" && call.url.endsWith("/api/projects/project_2/sessions"))?.body).toMatchObject({ envMode: "worktree" });
    expect(sent[0]?.detail).toBe("exoplanets");
  });

  test("Esc closes the picker without hiding the window", async () => {
    const { host, closed } = await open(front(GRANTED));
    await type(host, "#");
    await press(host, "Escape");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(closed()).toBe(0);
  });
});
