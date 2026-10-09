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
const live = (id: string, title: string, projectId: string, activity: string, updatedAt: number, read: Partial<{ lastTurnSequence: number; lastReadTurnSequence: number }> = {}) => ({
  id, title, projectId, activity, updatedAt, state: "active", createdAt: 1, driver: "claude", workspace: { mode: "none" }, ...read,
});
let journal: Record<string, Record<string, unknown>[]> = {};
const turn = (sessionId: string, sequence: number, input: string, state: string, resultText?: string) => ({
  runId: `run_${sessionId}_${sequence}`, sessionId, sequence, input, state, acceptedAt: 1, updatedAt: 1, ...(resultText ? { resultText, startedAt: 1, endedAt: 2 } : {}),
});
const LIVE = [
  live("s_transit", "Transit light-curve analysis", "project_2", "idle", 300, { lastTurnSequence: 2, lastReadTurnSequence: 1 }),
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
    const id = /sessions\/([^/?]+)/.exec(url)?.[1] ?? "";
    if (url.includes("/bootstrap") || (url.includes("/sessions/") && url.includes("turns="))) {
      return Response.json({ session: { ...LIVE.find((row) => row.id === id), environmentId: "env", providerInstanceId: "claude", envMode: "local" }, turns: journal[id] ?? [], items: [], tasks: [], requests: [], cursor: 1, events: [], subscriptions: [] });
    }
    if (url.includes("/events")) return Response.json({ events: [], cursor: 1, more: false });
    if (url.includes("/api/sessions/stream")) return new Response(new ReadableStream({ start() {} }));
    if (url.includes("/attachments")) return Response.json({ attachment: { id: `att_${calls.length}` } });
    if (url.includes("/turns")) {
      if (method === "POST" && journal[id]) journal[id] = [...journal[id], turn(id, journal[id].length + 1, body.input, "running")];
      return Response.json({ runId: "run_1", state: "queued" });
    }
    if (url.includes("/api/projects")) return Response.json({ projects: PROJECTS });
    if (url.includes("/api/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/api/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
}

const GRANTED = { accessibility: true };
const DENIED = { accessibility: false };

function fakeBridge(context: FrontContext | null) {
  const sent: Parameters<QuickComposerBridge["sent"]>[0][] = [];
  const settings: Permission[] = [];
  let closed = 0;
  let held = 0;
  const layouts: { height: number; composerTop: number }[] = [];
  const drags: unknown[] = [];
  let room: Parameters<QuickComposerBridge["onRoom"]>[0] = () => {};
  let pushPermissions: (permissions: Permissions) => void = () => {};
  const bridge: QuickComposerBridge = {
    context: async () => context,
    onOpen: () => () => {},
    close: async () => void (closed += 1),
    layout: (metrics) => void layouts.push(metrics),
    onRoom: (listener) => {
      room = listener;
      return () => {};
    },
    drag: (input) => void drags.push(input),
    sent: async (input) => void sent.push(input),
    onPermissions: (listener) => {
      pushPermissions = listener;
      return () => {};
    },
    openSettings: async (permission) => void settings.push(permission),
    hold: () => void (held += 1),
    failed: () => {},
  };
  return { bridge, sent, settings, layouts, drags, room: (next: Parameters<typeof room>[0]) => act(() => room(next)), closed: () => closed, held: () => held, recheck: (permissions: Permissions) => act(() => pushPermissions(permissions)) };
}

const front = (permissions: Permissions, extra: Partial<FrontContext> = {}): FrontContext => ({ app: "Notes", title: "", selection: "", permissions, grantee: "Telar Dev", ...extra });

beforeEach(() => {
  clearConnections();
  window.localStorage.clear();
  calls = [];
  journal = { s_sales: [turn("s_sales", 1, "Can you check the build?", "completed", "Need to run the build first.\n\n**Shall I run it?**")] };
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

function gesture(target: Element, moveTo: number) {
  const card = target.closest('[data-slot="quick-card"]')!;
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 40, clientY: 30, screenX: 0, screenY: 0 }));
    card.dispatchEvent(new PointerEvent("pointermove", { screenX: moveTo, screenY: 0 }));
    card.dispatchEvent(new PointerEvent("pointerup", {}));
  });
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

const strip = (host: HTMLElement) => [...host.querySelectorAll('[role="toolbar"] button')].map((pill) => pill.getAttribute("title")?.split(" · ")[0]);
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

  test("offers the selection without attaching it, and never offers the window", async () => {
    const { host } = await open(front(GRANTED, { app: "Safari", title: "pull/1439", selection: "two\nlines" }));
    expect(host.querySelector('[aria-label^="Remove "]')).toBeNull();
    const offers = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(offers).toContain("Attach selected text");
    expect(offers.some((label) => label?.includes("pull/1439"))).toBe(false);
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Attach selected text")!.click());
    expect(host.querySelector('[aria-label="Remove Selected text.txt"]')).not.toBeNull();
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

  test("the missing permission has a button for its pane, and the notice goes once it is granted", async () => {
    const { host, settings, recheck } = await open(front(DENIED));
    await act(async () => host.querySelector<HTMLElement>('[data-permission="accessibility"] button')!.click());
    expect(settings).toEqual(["accessibility"]);
    recheck(GRANTED);
    expect(host.querySelector('[role="note"]')).toBeNull();
  });

  test("the project picker sits in the card's control row, with nothing under the card", async () => {
    const { host } = await open(front(GRANTED));
    const controls = host.querySelector('[data-slot="composer-controls"]')!;
    expect(controls.querySelector('[aria-label="Project"]')?.textContent).toContain("Telar");
    expect(host.querySelector('[data-slot="quick-hint"]')).toBeNull();
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

  test("the empty field drags the window through main once a press moves; a click, or a field with text, does not", async () => {
    const { host, drags } = await open(front(GRANTED));
    gesture(editor(host), 1);
    expect(drags).toEqual([]);
    gesture(editor(host), 20);
    expect(drags).toEqual([{ phase: "start", offsetX: 40, offsetY: 30 }, { phase: "end" }]);
    await type(host, "half a thought");
    gesture(editor(host), 20);
    expect(drags).toHaveLength(2);
  });

  test("reports its height and where the composer starts, so main can size the window around it", async () => {
    const { layouts } = await open(front(GRANTED));
    await flush(() => layouts.length > 0);
    expect(layouts.at(-1)).toEqual({ height: expect.any(Number), composerTop: expect.any(Number) });
  });

  test("an open menu is drawn in the page, and the window makes room above for it", async () => {
    const { host } = await open(front(GRANTED));
    const root = host.querySelector<HTMLElement>('[data-surface="quick"]')!;
    const before = Number.parseFloat(root.style.paddingTop);
    const access = host.querySelector<HTMLElement>('[aria-label^="Access:"]')!;
    await act(async () => access.click());
    await flush(() => document.body.textContent?.includes("Auto-accept edits") ?? false);
    const menu = [...document.querySelectorAll("[role='dialog'], [data-side]")].find((node) => node.textContent?.includes("Auto-accept edits"));
    expect(menu).toBeTruthy();
    await flush(() => Number.parseFloat(root.style.paddingTop) > before);
    expect(Number.parseFloat(root.style.paddingTop)).toBe(before + 320);
  });

  test("the empty composer says # picks where the message goes", async () => {
    const { host } = await open(front(GRANTED));
    expect(host.querySelector('[data-slot="input-group"]')?.textContent).toContain("Ask anything · # to reply to a session or pick a project · / commands");
  });

  test("Esc hides it", async () => {
    const { closed } = await open(null);
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(closed()).toBe(1);
  });
});

describe("the desktop bridge", () => {
  test("is read once, so a bridge object that is fresh on every read cannot re-run its effects forever", async () => {
    const fake = fakeBridge(front(DENIED));
    let reads = 0;
    Object.defineProperty(window, "telarDesktop", { configurable: true, get: () => ((reads += 1), { quickComposer: { ...fake.bridge } }) });
    const { host } = await mount(
      <SidebarProvider>
        <QuickComposer />
      </SidebarProvider>,
    );
    await flush(() => Boolean(host.querySelector('[role="note"]')));
    expect(reads).toBe(1);
    expect(editor(host)).not.toBeNull();
    Reflect.deleteProperty(window, "telarDesktop");
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

  test("moving the selection survives a scrollIntoView that returns a promise, as Chromium's does", async () => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = (() => Promise.resolve()) as unknown as typeof original;
    try {
      const { host } = await open(front(GRANTED));
      await type(host, "#");
      await flush(() => options(host).length > 2);
      await press(host, "ArrowUp");
      await press(host, "ArrowUp");
      await press(host, "ArrowDown");
      expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("Sales dashboard");
      await type(host, "");
      expect(host.querySelector('[role="listbox"]')).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  test("filters projects and sessions together", async () => {
    const { host } = await open(front(GRANTED));
    await type(host, "#exo");
    await flush(() => options(host).length > 1);
    expect(options(host).at(-1)).toContain("New session in exoplanets");
    expect(options(host).slice(0, -1).map((row) => row.slice(0, 12))).toEqual(["Transit ligh", "Sales dashbo"]);
  });

  test("↑ and ↵ attach a session with its live transcript; ⌘↵ replies to it and opens it", async () => {
    const { host, sent } = await open(front(GRANTED));
    await type(host, "#exo");
    await flush(() => options(host).length > 1);
    await press(host, "ArrowUp");
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("Sales dashboard");
    await press(host, "ArrowDown");
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("New session in exoplanets");
    await press(host, "ArrowUp");
    await press(host, "Enter");
    await flush(() => host.querySelector('[data-slot="quick-transcript"]')?.textContent?.includes("Shall I run it?") ?? false);
    const card = host.querySelector('[data-slot="quick-destination"]')!;
    expect(card.textContent).toContain("Sales dashboard and checkout");
    expect(card.textContent).toContain("exoplanets · Waiting on you");
    const transcript = card.querySelector('[data-slot="quick-transcript"]')!;
    expect(transcript.textContent).toContain("Can you check the build?");
    expect(transcript.textContent).not.toContain("**");
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

describe("an attached conversation", () => {
  test("replying keeps the window open: the card stays and the reply joins its transcript", async () => {
    const { host, sent, closed } = await open(front(GRANTED));
    await type(host, "#sales");
    await flush(() => options(host).length > 0);
    await press(host, "Enter");
    await flush(() => host.querySelector('[data-slot="quick-transcript"]')?.textContent?.includes("Can you check the build?") ?? false);
    await typeAndPress(host, "Yes, go ahead");
    await flush(() => host.querySelector('[data-slot="quick-transcript"]')?.textContent?.includes("Yes, go ahead") ?? false);
    expect(sent).toEqual([]);
    expect(closed()).toBe(0);
    expect(host.querySelector('[data-slot="quick-destination"]')?.textContent).toContain("Sales dashboard and checkout");
  });

  test("a fresh open forgets the draft and the attachment; a quick reopen keeps them", async () => {
    const fake = fakeBridge(front(GRANTED));
    let reopen: (context: FrontContext) => void = () => {};
    fake.bridge.onOpen = (listener) => {
      reopen = listener;
      return () => {};
    };
    const { host } = await mount(
      <SidebarProvider>
        <QuickComposer bridge={fake.bridge} />
      </SidebarProvider>,
    );
    await flush();
    await type(host, "#sales");
    await flush(() => options(host).length > 0);
    await press(host, "Enter");
    await type(host, "half a reply");
    act(() => reopen(front(GRANTED, { fresh: false })));
    await flush();
    expect(host.querySelector('[data-slot="quick-destination"]')).not.toBeNull();
    expect(editor(host).textContent).toBe("half a reply");
    act(() => reopen(front(GRANTED, { fresh: true })));
    await flush();
    expect(host.querySelector('[data-slot="quick-destination"]')).toBeNull();
    expect(editor(host).textContent).toBe("");
  });
});

describe("the attached conversation's transcript", () => {
  test("shows every loaded turn through the newest one", async () => {
    journal.s_transit = [
      turn("s_transit", 1, "add Jul = 310 to the signups chart", "completed", "Added July."),
      turn("s_transit", 2, "Hello", "completed", "Hi. The four artifacts are published."),
    ];
    const { host } = await open(front(GRANTED));
    await type(host, "#transit");
    await flush(() => options(host).length > 0);
    await press(host, "Enter");
    await flush(() => host.querySelector('[data-slot="quick-transcript"]')?.textContent?.includes("The four artifacts") ?? false);
    const text = host.querySelector('[data-slot="quick-transcript"]')!.textContent!;
    expect(text.indexOf("add Jul = 310")).toBeLessThan(text.indexOf("Hello"));
    expect(text.indexOf("Hello")).toBeLessThan(text.indexOf("The four artifacts"));
  });

  test("typing # closes the attached conversation and opens the picker in its place", async () => {
    const { host } = await open(front(GRANTED));
    await type(host, "#sales");
    await flush(() => options(host).length > 0);
    await press(host, "Enter");
    expect(host.querySelector('[data-slot="quick-destination"]')).not.toBeNull();
    await type(host, "#");
    expect(host.querySelector('[data-slot="quick-destination"]')).toBeNull();
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    await press(host, "Escape");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('[data-slot="quick-destination"]')).toBeNull();
    expect(editor(host).textContent).toBe("");
  });

  test("with little room above, the picker opens below the card, its best row nearest the card", async () => {
    const { host, room } = await open(front(GRANTED));
    room({ above: 80, below: 600 });
    await type(host, "#");
    await flush(() => options(host).length > 1);
    const list = host.querySelector('[role="listbox"]')!;
    expect(editor(host).compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(options(host)[0]).toContain("New session in Telar");
    await press(host, "ArrowDown");
    expect(host.querySelector('[aria-selected="true"]')?.textContent).toContain("Sales dashboard");
  });
});

describe("the strip of conversations that need you", () => {
  test("lists waiting first, then unread, then running", async () => {
    const { host } = await open(front(GRANTED));
    await flush(() => strip(host).length > 0);
    expect(strip(host)).toEqual(["Sales dashboard and checkout", "Transit light-curve analysis", "Expand scratch README"]);
  });

  test("↑ from the empty composer focuses it, ←/→ move, ↵ attaches, and ↓ returns to the composer", async () => {
    const { host } = await open(front(GRANTED));
    await flush(() => strip(host).length > 0);
    await press(host, "ArrowUp");
    const pills = [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
    expect(document.activeElement).toBe(pills[0]);
    await act(async () => void pills[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(pills[1]);
    await act(async () => void pills[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(editor(host));
    await act(async () => pills[1]!.click());
    await flush();
    expect(host.querySelector('[data-slot="quick-destination"]')?.textContent).toContain("Transit light-curve analysis");
    expect(strip(host)).not.toContain("Transit light-curve analysis");
  });
});
