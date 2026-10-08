/**
 * Mounted against a fake host and a real xterm.js. That an image renders cannot be checked here (no canvas, no
 * WebGL2), so the image tests assert that the addon activated.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flush } from "@/test/dom";
import { TERMINAL_IMAGE_OPTIONS } from "../emulator";
import { TerminalSurface } from "./terminal-surface";
import type { LiveTerminal, TerminalChunk, TerminalEnding, TerminalOpenRequest } from "../bridge";
import type { RunView } from "../run/types";
import { readTerminalTab, terminalTabParams } from "../tab";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

type Fake = {
  opens: TerminalOpenRequest[];
  kills: string[];
  writes: Array<{ id: string; data: string }>;
  resizes: Array<{ id: string; cols: number; rows: number }>;
  push: (chunk: TerminalChunk) => void;
  end: (ending: TerminalEnding) => void;
};

function installBridge(
  options: { live?: LiveTerminal[]; openId?: string; ending?: TerminalEnding } = {},
): Fake {
  const opens: TerminalOpenRequest[] = [];
  const kills: string[] = [];
  const writes: Array<{ id: string; data: string }> = [];
  const resizes: Array<{ id: string; cols: number; rows: number }> = [];
  const data: Array<(chunk: TerminalChunk) => void> = [];
  const exits: Array<(ending: TerminalEnding) => void> = [];
  const terminal = {
    open: async (request: TerminalOpenRequest) => {
      opens.push(request);
      if (options.ending) return { id: "term_failed", ending: options.ending };
      return { id: options.openId ?? "term_new", pid: 4242 };
    },
    write: async (id: string, payload: string) => {
      writes.push({ id, data: payload });
      return { ok: true };
    },
    resize: async (id: string, cols: number, rows: number) => {
      resizes.push({ id, cols, rows });
      return { ok: true };
    },
    kill: async (id: string) => {
      kills.push(id);
      return { ok: true };
    },
    list: async () => ({ terminals: options.live ?? [] }),
    onData: (listener: (chunk: TerminalChunk) => void) => {
      data.push(listener);
      return () => data.splice(data.indexOf(listener), 1);
    },
    onExit: (listener: (ending: TerminalEnding) => void) => {
      exits.push(listener);
      return () => exits.splice(exits.indexOf(listener), 1);
    },
  };
  (window as unknown as { telarDesktop?: unknown }).telarDesktop = { terminal };
  return {
    opens,
    kills,
    writes,
    resizes,
    push: (chunk) => data.forEach((listener) => listener(chunk)),
    end: (ending) => exits.forEach((listener) => listener(ending)),
  };
}

let mounted: Root | undefined;

const CHECKOUT = "/Users/someone/code/telar";
const realFetch = globalThis.fetch;
const listing = () => Response.json({ listing: { workspacePath: CHECKOUT, repository: true, files: [], source: "git", truncated: false, readAt: 1 } });

beforeEach(() => {
  globalThis.fetch = (async () => listing()) as unknown as typeof fetch;
});

afterEach(() => {
  const root = mounted;
  mounted = undefined;
  if (root) act(() => root.unmount());
  globalThis.fetch = realFetch;
  delete (window as unknown as { telarDesktop?: unknown }).telarDesktop;
});

async function mount(props: Parameters<typeof TerminalSurface>[0] = {}): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(<TerminalSurface {...props} />);
  });
  await flush();
  return host;
}

function retry(host: HTMLElement): HTMLButtonElement | null {
  return ([...host.querySelectorAll("button")] as HTMLButtonElement[]).find((button) => button.textContent?.includes("home folder")) ?? null;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
  await flush();
}

/** A keydown from inside the surface, where xterm's textarea would send it; returns whether it was taken. */
async function press(host: HTMLElement, key: string, modifiers: { metaKey?: boolean; shiftKey?: boolean } = {}): Promise<boolean> {
  const target = (host.querySelector('[data-testid="terminal-host"]') ?? host.firstElementChild ?? host) as HTMLElement;
  const event = new KeyboardEvent("keydown", { key, metaKey: modifiers.metaKey ?? true, shiftKey: modifiers.shiftKey ?? false, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("without the desktop shell", () => {
  test("it says why there is no terminal instead of drawing an empty one", async () => {
    const host = await mount();
    expect(host.textContent).toContain("desktop shell");
    expect(host.textContent).toContain("this computer");
  });
});

describe("opening a shell", () => {
  test("one mount asks for exactly one shell, and writes its id to the tab's params", async () => {
    const bridge = installBridge({ openId: "term_a" });
    const written: Array<Record<string, string>> = [];
    await mount({ sessionId: "session_a", onParams: (params) => written.push(params) });

    expect(bridge.opens.length).toBe(1);
    expect(readTerminalTab(written.at(-1) ?? {}).terminalId).toBe("term_a");
  });
  test("the emulator's own size is what the PTY is told, so SIGWINCH is not a guess", async () => {
    const bridge = installBridge({ openId: "term_a" });
    await mount({ sessionId: "session_a" });
    expect(bridge.opens[0]?.cols).toBeGreaterThan(0);
    expect(bridge.opens[0]?.rows).toBeGreaterThan(0);
  });

  test("the shell starts in the session's checkout, not wherever Electron was launched", async () => {
    const bridge = installBridge({ openId: "term_a" });
    await mount({ sessionId: "session_a" });
    expect(bridge.opens[0]?.cwd).toBe(CHECKOUT);
  });

  test("an engine that cannot answer still gets you a terminal", async () => {
    globalThis.fetch = (async () => {
      throw new Error("engine away");
    }) as unknown as typeof fetch;
    const bridge = installBridge({ openId: "term_a" });
    await mount({ sessionId: "session_a" });
    expect(bridge.opens.length).toBe(1);
    expect(bridge.opens[0]?.cwd).toBeUndefined();
  });

  test("a spawn that never started is reported as never started", async () => {
    installBridge({ ending: { id: "term_failed", fate: "failed", error: "ENOENT" } });
    const host = await mount({ sessionId: "session_a" });
    expect(host.textContent).toContain("never started");
  });
});

describe("a cwd the host refuses (#851)", () => {
  /** The exact shape `unusableCwd` writes in apps/desktop/terminal-host.js. */
  const CWD_REFUSAL = {
    id: "term_failed",
    fate: "failed" as const,
    error: "Telar cannot start a terminal in /private/tmp/exoplanets: ENOENT (no such file or directory). No process was started.",
  };

  test("the refusal is the tab's whole content — no xterm underneath it", async () => {
    installBridge({ ending: CWD_REFUSAL });
    const host = await mount({ sessionId: "session_a" });

    expect(host.textContent).toContain("never started");
    expect(host.querySelector(".xterm")).toBeNull();
    expect(retry(host)).not.toBeNull();
    expect(retry(host)?.textContent).toContain("home folder");
  });

  test("the action retries the same tab with no cwd, so the host falls back to the shell's own default", async () => {
    const bridge = installBridge({ ending: CWD_REFUSAL });
    const host = await mount({ sessionId: "session_a" });
    expect(bridge.opens.length).toBe(1);
    expect(bridge.opens[0]?.cwd).toBe(CHECKOUT);

    await click(retry(host) as HTMLButtonElement);

    expect(bridge.opens.length).toBe(2);
    // The host's fallback is triggered by the key being absent, not by its value.
    expect("cwd" in (bridge.opens[1] ?? {})).toBe(false);
  });

  test("a `failed` ending that is not about the cwd keeps today's banner instead", async () => {
    installBridge({ ending: { id: "term_failed", fate: "failed", error: "spawn /bin/nope ENOENT" } });
    const host = await mount({ sessionId: "session_a" });

    expect(host.textContent).toContain("never started");
    expect(retry(host)).toBeNull();
  });
});

describe("re-adopting a running shell", () => {
  test("a terminal the host still lists is adopted, not replaced", async () => {
    const bridge = installBridge({ live: [{ id: "term_old", pid: 99 }] });
    await mount({ sessionId: "session_a", params: terminalTabParams({ terminalId: "term_old" }) });
    expect(bridge.opens).toEqual([]);
    expect(bridge.kills).toEqual([]);
  });

  test("a terminal that has since died is replaced rather than left blank", async () => {
    const bridge = installBridge({ live: [], openId: "term_new" });
    const written: Array<Record<string, string>> = [];
    await mount({ sessionId: "session_a", params: terminalTabParams({ terminalId: "term_gone", title: "zsh" }), onParams: (params) => written.push(params) });
    expect(bridge.opens.length).toBe(1);
    expect(readTerminalTab(written.at(-1) ?? {})).toEqual({ terminalId: "term_new", title: "zsh" });
  });
});

describe("the shell's title", () => {
  test("an OSC title is written to the tab's params, keeping its PTY id", async () => {
    const bridge = installBridge({ openId: "term_a" });
    const written: Array<Record<string, string>> = [];
    function Tab() {
      const [params, setParams] = useState<Record<string, string>>({});
      return <TerminalSurface sessionId="session_a" params={params} onParams={(next) => (written.push(next), setParams(next))} />;
    }
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    mounted = root;
    await act(async () => root.render(<Tab />));
    await flush();
    await act(async () => {
      bridge.push({ id: "term_a", data: "\x1b]0;vim notes.md\x07" });
    });
    await flush(() => readTerminalTab(written.at(-1) ?? {}).title !== undefined);
    expect(readTerminalTab(written.at(-1) ?? {})).toEqual({ terminalId: "term_a", title: "vim notes.md" });
  });
});

describe("keys inside the surface", () => {
  test("Cmd+T opens another Terminal tab and Cmd+W closes this one", async () => {
    installBridge({ openId: "term_a" });
    const calls: string[] = [];
    const host = await mount({ sessionId: "session_a", onOpenNew: () => calls.push("new"), onCloseSelf: () => calls.push("close") });

    expect(await press(host, "t")).toBe(true);
    expect(await press(host, "w")).toBe(true);
    expect(calls).toEqual(["new", "close"]);
  });

  test("a key it does not own is left for the shell", async () => {
    installBridge({ openId: "term_a" });
    const calls: string[] = [];
    const host = await mount({ sessionId: "session_a", onOpenNew: () => calls.push("new"), onCloseSelf: () => calls.push("close") });

    expect(await press(host, "k")).toBe(false);
    expect(await press(host, "t", { metaKey: false })).toBe(false);
    expect(await press(host, "w", { shiftKey: true })).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("what a terminal's ending is allowed to say", () => {
  test("an observed exit says so, plainly", async () => {
    const bridge = installBridge({ openId: "term_a" });
    const host = await mount({ sessionId: "session_a" });
    await act(async () => {
      bridge.end({ id: "term_a", fate: "exited", exitCode: 0 });
    });
    expect(host.textContent).toContain("Shell exited.");
  });

  test("another terminal's ending is not this tab's", async () => {
    const bridge = installBridge({ openId: "term_a" });
    const host = await mount({ sessionId: "session_a" });
    await act(async () => {
      bridge.end({ id: "term_b", fate: "exited", exitCode: 1 });
    });
    expect(host.textContent).not.toContain("Shell exited");
  });
});

describe("a run's tab", () => {
  const run: RunView = {
    terminalId: "term_run",
    runId: "run_1",
    projectId: "project_1",
    sessionId: "session_a",
    origin: "run",
    title: "tests",
    configId: "cfg_test",
    configName: "tests",
    command: "bun test",
    worktreePath: CHECKOUT,
    cwd: CHECKOUT,
    status: "running",
    activity: "idle",
    lastExit: { exitCode: 1, at: 2 },
    readiness: { kind: "none" },
    startedAt: 1,
    env: [],
  };

  test("shows the run, not a shell, and Run again restarts that run", async () => {
    const posted: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/run/status")) return Response.json({ terminals: [run] });
      if (url.includes("/run/configs")) return Response.json({ configurations: [] });
      if (url.includes("/run/restart")) return Response.json({ ...run, activity: "busy" });
      if (url.includes("/run/")) return new Response("", { status: 404 });
      return listing();
    }) as typeof fetch;
    const bridge = installBridge({ live: [{ id: "term_run" }] });
    const host = await mount({
      sessionId: "session_a",
      params: terminalTabParams({ terminalId: "term_run", title: "tests", run: { runId: "run_1", configId: "cfg_test" } }),
    });
    await flush(() => host.querySelector('button[aria-label="Run tests again"]') !== null);

    expect(bridge.opens).toEqual([]);
    expect(host.textContent).toContain("bun test");
    await click(host.querySelector('button[aria-label="Run tests again"]') as HTMLButtonElement);

    expect(posted.find((entry) => entry.url.includes("/run/restart"))?.body).toEqual({ terminalId: "run_1" });
    expect(posted.some((entry) => entry.url.includes("/run/stop"))).toBe(false);
  });
});

describe("closing the surface", () => {
  test("unmounting does NOT kill the shell — a tab switch is not a goodbye", async () => {
    const bridge = installBridge({ openId: "term_a" });
    await mount({ sessionId: "session_a" });
    const root = mounted;
    mounted = undefined;
    act(() => root?.unmount());
    // `closeTerminalTab` ends it, from the cockpit that can tell a switch from a close.
    expect(bridge.kills).toEqual([]);
  });
});

describe("image protocols", () => {
  test("SIXEL and iTerm2 IIP are on, and size reports with them", async () => {
    expect(TERMINAL_IMAGE_OPTIONS.sixelSupport).toBe(true);
    expect(TERMINAL_IMAGE_OPTIONS.iipSupport).toBe(true);
    expect(TERMINAL_IMAGE_OPTIONS.enableSizeReports).toBe(true);
  });

  test("there is no kitty switch to set, because the addon implements no kitty", async () => {
    // @xterm/addon-image has no kitty support; this fails the day it gains some, so enabling it is a decision.
    const options = Object.keys(TERMINAL_IMAGE_OPTIONS);
    expect(options.some((key) => key.toLowerCase().includes("kitty"))).toBe(false);
    const typings = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../node_modules/@xterm/addon-image/typings/addon-image.d.ts"),
      "utf8",
    );
    expect(typings).toContain("sixelSupport");
    expect(typings).toContain("iipSupport");
    expect(typings.toLowerCase()).not.toContain("kitty");
  });

  test("loading the addon really does turn the size reports on", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const { ImageAddon } = await import("@xterm/addon-image");

    const term = new Terminal({ cols: 20, rows: 4, allowProposedApi: true });
    // xterm's default `windowOptions` is one object shared by every instance, so clear this one's first.
    term.options.windowOptions = {};
    expect(term.options.windowOptions?.getCellSizePixels ?? false).toBe(false);

    term.loadAddon(new ImageAddon(TERMINAL_IMAGE_OPTIONS));
    expect(term.options.windowOptions?.getCellSizePixels).toBe(true);
    expect(term.options.windowOptions?.getWinSizePixels).toBe(true);
  });
});

describe("resize is one fit per frame, and one SIGWINCH per grid change", () => {
  /** rAF stubbed to a queue this test drains by hand. */
  let queued: Array<FrameRequestCallback> = [];
  const realRaf = window.requestAnimationFrame;
  const realCancel = window.cancelAnimationFrame;
  beforeEach(() => {
    queued = [];
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      queued[handle - 1] = () => {};
    }) as typeof window.cancelAnimationFrame;
  });
  afterEach(() => {
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancel;
  });
  const paint = () => {
    const frame = queued.splice(0);
    for (const cb of frame) cb(performance.now());
  };

  test("five resize signals in one frame fit once and signal the PTY at most once", async () => {
    const fake = installBridge();
    await mount({ sessionId: "s1" });
    await act(async () => {
      paint();
    });
    const before = fake.resizes.length;
    await act(async () => {
      for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event("telar:panel-resized"));
    });
    // Nothing has painted yet: the burst is queued, not sent.
    expect(fake.resizes.length).toBe(before);
    await act(async () => {
      paint();
    });
    // At most one SIGWINCH per frame; zero here, since a headless grid does not move.
    expect(fake.resizes.length - before).toBeLessThanOrEqual(1);
  });

  test("a frame that leaves cols and rows unchanged sends no SIGWINCH", async () => {
    const fake = installBridge();
    await mount({ sessionId: "s1" });
    await act(async () => {
      paint();
    });
    const settled = fake.resizes.length;
    await act(async () => {
      window.dispatchEvent(new Event("telar:panel-resized"));
      paint();
      window.dispatchEvent(new Event("telar:panel-resized"));
      paint();
    });
    expect(fake.resizes.length).toBe(settled);
  });
});
