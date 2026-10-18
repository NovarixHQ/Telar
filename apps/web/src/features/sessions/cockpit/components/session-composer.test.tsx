import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act, useEffect } from "react";
import { flush, installTestDom, mount } from "@/test/dom";

installTestDom();

let edges: { reach: () => void }[] = [];
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
  private targets: Element[] = [];
  constructor(private readonly callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    edges.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  reach() {
    this.callback(this.targets.map((target) => ({ target, isIntersecting: true })));
  }
  disconnect() {
    edges = edges.filter((edge) => edge !== this);
  }
  unobserve() {}
};
let resized: (() => void)[] = [];
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
  constructor(callback: ResizeObserverCallback) {
    resized.push(() => callback([{ contentRect: { height: box.scrollHeight } } as ResizeObserverEntry], this as unknown as ResizeObserver));
  }
  observe() {}
  disconnect() {}
};
const box = { scrollHeight: 0, clientHeight: 0 };

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/projects/project_1/sessions/s_1",
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionComposer, MINI_TRANSCRIPT_CAP } = await import("./session-composer");
const { useSessionSync } = await import("../hooks/use-session-sync");
const { useTranscriptModel } = await import("../hooks/use-transcript-model");
const { usePublishPanelFullscreen } = await import("@/features/panel");
const { runCommand } = await import("@/features/commands");
const { clearConnections } = await import("@telar/client/journal");

const turn = (sequence: number, input: string, resultText: string, state = "completed") => ({
  runId: `run_${sequence}`, sessionId: "s_1", sequence, input, state, acceptedAt: sequence, updatedAt: sequence, resultText, startedAt: sequence, endedAt: sequence,
});

let recent: ReturnType<typeof turn>[] = [];
let older: ReturnType<typeof turn>[] = [];
let olderAsks = 0;
let arrived: { id: number; at: number; sessionId: string; runId: string; type: string; turn: unknown; replayed: boolean }[] = [];

function wire() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const snapshot = (turns: unknown[], page: { before: string | null; more: boolean }) =>
      Response.json({ session: { id: "s_1", title: "Build", projectId: "project_1", state: "active", activity: "idle", createdAt: 1, updatedAt: 1, driver: "claude", workspace: { mode: "none" }, environmentId: "env", providerInstanceId: "claude", envMode: "local" }, turns, items: [], tasks: [], requests: [], cursor: 1, events: [], subscriptions: [], page });
    if (url.includes("/api/engine/v2/sessions/stream")) return new Response(new ReadableStream({ start() {} }));
    if (url.includes("/delta")) return Response.json({}, { status: 404 });
    if (url.includes("/events")) return Response.json({ events: arrived, cursor: arrived.at(-1)?.id ?? 1, more: false });
    if (url.includes("before=")) {
      olderAsks += 1;
      return snapshot(older, { before: null, more: false });
    }
    if (url.includes("/api/engine/v2/sessions/s_1")) return snapshot(recent, { before: older.length ? "run_3" : null, more: older.length > 0 });
    return Response.json({});
  }) as typeof fetch;
}

let hydrate: () => void = () => {};

function Fullscreen() {
  usePublishPanelFullscreen(true);
  const sync = useSessionSync({ hostId: "local", sessionId: "s_1", initiallyLoading: true });
  const model = useTranscriptModel("s_1", sync);
  useEffect(() => {
    hydrate = sync.hydrate;
  });
  const composer = { draft: "", ready: true, attachments: [], onAttach: () => {}, busy: false, sending: false, backgroundTasks: 0, onDraftChange: () => {}, onSubmit: () => {}, onStop: () => {}, onStopBackground: () => {}, onRuntimeMode: () => {} };
  return <SessionComposer composer={composer} sync={sync} model={model} onDecide={() => {}} />;
}

const transcript = () => document.querySelector<HTMLElement>('[data-slot="live-transcript"]');
const says = (text: string) => transcript()?.textContent?.includes(text) ?? false;

const scroller = () => transcript()!.firstElementChild as HTMLElement;
function stubLayout(scrollHeight: number, clientHeight: number) {
  Object.assign(box, { scrollHeight, clientHeight });
  Object.defineProperty(scroller(), "scrollHeight", { get: () => box.scrollHeight, configurable: true });
  Object.defineProperty(scroller(), "clientHeight", { get: () => box.clientHeight, configurable: true });
  scroller().scrollTop = scrollHeight - clientHeight;
}

async function openMini() {
  await mount(<Fullscreen />);
  await flush(() => false);
  await act(async () => void runCommand("mini-composer"));
  await flush(() => transcript() !== null);
}

beforeEach(() => {
  clearConnections();
  edges = [];
  olderAsks = 0;
  arrived = [];
  resized = [];
  older = [turn(1, "Where is the config?", "In apps/engine."), turn(2, "And the tests?", "Next to each file.")];
  recent = [turn(3, "Run the build", "The build passed."), turn(4, "Ship it", "Merged.")];
  wire();
});

describe("the mini composer's conversation over a full panel", () => {
  test("shows the session's recent turns, not only the last exchange", async () => {
    await openMini();
    expect(says("Run the build")).toBe(true);
    expect(says("Merged.")).toBe(true);
    expect(says("Where is the config?")).toBe(false);
    expect(says("Scroll up for earlier turns")).toBe(true);
  });

  test("scrolling up to its top edge pages in earlier turns through the session's own paging", async () => {
    await openMini();
    await act(async () => edges.at(-1)!.reach());
    await flush(() => says("Where is the config?"));
    expect(olderAsks).toBe(1);
    expect(says("Where is the config?")).toBe(true);
    expect(says("In apps/engine.")).toBe(true);
    expect(says("Merged.")).toBe(true);
    expect(says("Scroll up for earlier turns")).toBe(false);
  });

  test("a turn that arrives while it is open is drawn below the others, and the view follows it down", async () => {
    await openMini();
    stubLayout(1_200, 300);
    const next = turn(5, "Tag a nightly", "Working on it…", "running");
    recent = [...recent, next];
    arrived = [{ id: 2, at: 5, sessionId: "s_1", runId: next.runId, type: "turn.accepted", turn: next, replayed: false }];
    await act(async () => hydrate());
    await flush(() => says("Tag a nightly"));
    await act(async () => {
      box.scrollHeight = 1_600;
      for (const notify of resized) notify();
      await new Promise((settle) => setTimeout(settle, 50));
    });
    expect(box.scrollHeight - box.clientHeight - scroller().scrollTop).toBeLessThanOrEqual(1);
    const text = transcript()!.textContent!;
    expect(text.indexOf("Tag a nightly")).toBeGreaterThan(text.indexOf("Merged."));
  });

  test("grows with the conversation up to its cap, then scrolls inside it", async () => {
    await openMini();
    expect(transcript()!.style.maxHeight).toBe(MINI_TRANSCRIPT_CAP);
    expect(transcript()!.style.height).toBe("");
  });

  test("a session with no turns yet opens the composer with nothing above it", async () => {
    recent = [];
    older = [];
    await mount(<Fullscreen />);
    await flush(() => false);
    await act(async () => void runCommand("mini-composer"));
    expect(document.querySelector('[role="dialog"][aria-label="Message"]')).not.toBeNull();
    expect(transcript()).toBeNull();
  });
});
