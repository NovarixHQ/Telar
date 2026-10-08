import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { flush, installTestDom, mount as mountElement } from "@/test/dom";
import { GroupedTerminalSurface } from "./grouped-terminal-surface";
import type { LiveTerminal, TerminalActivity, TerminalOpenRequest } from "../bridge";
import type { RunView } from "../run/types";
import { activateShell, addShell, emptyWorkspace, nextShellId, readWorkspace, setShellTerminal, upsertRunShell, workspaceParams } from "../workspace";

installTestDom();

type Fake = { opens: TerminalOpenRequest[]; kills: string[]; closes: string[] };

function installBridge(options: { live?: LiveTerminal[]; openId?: string; activity?: TerminalActivity[] } = {}): Fake {
  const fake: Fake = { opens: [], kills: [], closes: [] };
  const terminal = {
    open: async (request: TerminalOpenRequest) => (fake.opens.push(request), { id: options.openId ?? "term_new", pid: 4242 }),
    write: async () => ({ ok: true }),
    resize: async () => ({ ok: true }),
    kill: async (id: string) => (fake.kills.push(id), { ok: true }),
    list: async () => ({ terminals: options.live ?? [] }),
    ...(options.activity
      ? {
          active: async (ids?: string[]) => ({ terminals: options.activity!.filter((entry) => !ids || ids.includes(entry.id)) }),
          close: async (id: string) => (fake.closes.push(id), { ok: true }),
        }
      : {}),
    onData: () => () => undefined,
    onExit: () => () => undefined,
  };
  (window as unknown as { telarDesktop?: unknown }).telarDesktop = { terminal };
  return fake;
}

const CHECKOUT = "/Users/someone/code/telar";
const listing = () => Response.json({ listing: { workspacePath: CHECKOUT, repository: true, files: [], source: "git", truncated: false, readAt: 1 } });

beforeEach(() => {
  globalThis.fetch = (async () => listing()) as unknown as typeof fetch;
});

afterEach(() => {
  delete (window as unknown as { telarDesktop?: unknown }).telarDesktop;
});

/** The tab as the panel holds it: params in, params out, and a close the panel answers. */
async function mount(initial: Record<string, string>, { sessionId = "session_a" }: { sessionId?: string } = {}) {
  const tab: { params: Record<string, string>; closed: number; set?: (params: Record<string, string>) => void } = { params: initial, closed: 0 };
  function Tab() {
    const [params, setParams] = useState(initial);
    tab.params = params;
    tab.set = setParams;
    return <GroupedTerminalSurface sessionId={sessionId} params={params} onParams={setParams} onCloseSelf={() => (tab.closed += 1)} />;
  }
  const { host } = await mountElement(<Tab />);
  await flush();
  return { host, tab };
}

function restored(...terminals: string[]): Record<string, string> {
  let state = emptyWorkspace();
  for (const terminal of terminals) {
    const id = nextShellId(state);
    state = setShellTerminal(addShell(state, id), id, terminal);
  }
  return workspaceParams(activateShell(state, state.shells[0]!.id));
}

const chips = (host: HTMLElement) => [...host.querySelectorAll('[role="tablist"][aria-label="Terminal tabs"] [role="tab"]')] as HTMLButtonElement[];
const button = (host: HTMLElement, label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
  await flush();
}

async function key(host: HTMLElement, letter: string, options: { shiftKey?: boolean; code?: string } = {}) {
  const target = (host.querySelector('[role="tablist"]')?.parentElement ?? host) as HTMLElement;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: letter, code: options.code ?? "", metaKey: true, shiftKey: options.shiftKey ?? false, bubbles: true, cancelable: true }));
  });
  await flush();
}

describe("the strip of shells", () => {
  test("a fresh tab opens one shell in the checkout and writes it to the tab", async () => {
    const bridge = installBridge({ openId: "term_a" });
    const { host, tab } = await mount({});
    expect(bridge.opens.map((open) => open.cwd)).toEqual([CHECKOUT]);
    expect(chips(host).map((chip) => chip.textContent)).toEqual(["Shell 1"]);
    expect(readWorkspace(tab.params).shells).toEqual([{ id: "shell", terminalId: "term_a" }]);
  });

  test("a tab restored with three shells re-adopts all three, opens nothing, and keeps every pane mounted", async () => {
    const bridge = installBridge({ live: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] });
    const { host } = await mount(restored("t1", "t2", "t3"));
    expect(bridge.opens).toEqual([]);
    expect(chips(host).map((chip) => chip.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect([...host.querySelectorAll('[data-testid="terminal-pane"]')].map((pane) => pane.getAttribute("data-active"))).toEqual(["true", "false", "false"]);
  });

  test("+ opens one more shell and selects it; closing a chip ends it and focuses its neighbour", async () => {
    const bridge = installBridge({ live: [{ id: "t1" }, { id: "t2" }], openId: "t3" });
    const { host, tab } = await mount(restored("t1", "t2"));
    await click(button(host, "New shell"));
    expect(bridge.opens).toHaveLength(1);
    expect(chips(host)[2]?.getAttribute("aria-selected")).toBe("true");

    await click(chips(host)[1]!);
    await click(button(host, "Close Shell 2"));
    expect(bridge.kills).toEqual(["t2"]);
    expect(chips(host).map((chip) => chip.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(readWorkspace(tab.params).shells.map((shell) => shell.terminalId)).toEqual(["t1", "t3"]);
  });

  test("a run chip the cockpit writes while the tab shows appears, selected when it says so", async () => {
    installBridge({ live: [{ id: "t1" }] });
    const { host, tab } = await mount(restored("t1"));
    const withRun = upsertRunShell(readWorkspace(tab.params), { title: "web dev", run: { runId: "run_1", configId: "" } }, { focus: true });
    await act(async () => tab.set?.(workspaceParams(withRun)));
    await flush();
    expect(chips(host).map((chip) => [chip.textContent, chip.getAttribute("aria-selected")])).toEqual([
      ["Shell 1", "false"],
      ["web dev", "true"],
    ]);
  });
});

describe("the strip's keys", () => {
  test("Cmd+T opens a shell, Cmd+1/2 select, Cmd+Shift+] walks, Cmd+W closes the active one", async () => {
    const bridge = installBridge({ live: [{ id: "t1" }], openId: "t2" });
    const { host } = await mount(restored("t1"));
    await key(host, "t");
    expect(chips(host)).toHaveLength(2);
    await key(host, "1");
    expect(chips(host)[0]?.getAttribute("aria-selected")).toBe("true");
    await key(host, "}", { shiftKey: true, code: "BracketRight" });
    expect(chips(host)[1]?.getAttribute("aria-selected")).toBe("true");
    await key(host, "w");
    expect(chips(host)).toHaveLength(1);
    expect(bridge.kills).toEqual(["t2"]);
  });

  test("Cmd+W on the last shell empties the tab first, then asks the panel to close it", async () => {
    const bridge = installBridge({ live: [{ id: "t1" }] });
    const { host, tab } = await mount(restored("t1"));
    await key(host, "w");
    expect(bridge.kills).toEqual(["t1"]);
    expect(tab.params).toEqual({});
    expect(tab.closed).toBe(1);
    expect(bridge.opens).toEqual([]);
  });
});

describe("closing chips", () => {
  const realConfirm = window.confirm;
  afterEach(() => {
    window.confirm = realConfirm;
  });

  test("a busy shell asks, and no keeps it open", async () => {
    const bridge = installBridge({ live: [{ id: "t1" }, { id: "t2" }], activity: [{ id: "t2", active: true, processes: 3, command: "bun test --watch" }] });
    const asked: string[] = [];
    window.confirm = ((message?: string) => (asked.push(String(message)), false)) as typeof window.confirm;
    const { host } = await mount(restored("t1", "t2"));
    await click(button(host, "Close Shell 2"));
    expect(asked[0]).toStartWith("End “bun test --watch” (3 processes)?");
    expect(bridge.closes).toEqual([]);
    expect(chips(host)).toHaveLength(2);
  });

  test("Close idle terminals ends the idle shells without asking, and keeps the busy one", async () => {
    const bridge = installBridge({
      live: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
      activity: [
        { id: "t1", active: true, processes: 2, command: "bun run dev" },
        { id: "t2", active: false, processes: 0 },
        { id: "t3", active: false, processes: 0 },
      ],
    });
    const { host } = await mount(restored("t1", "t2", "t3"));
    await click(button(host, "Close idle terminals"));
    expect(bridge.closes.sort()).toEqual(["t2", "t3"]);
    expect(chips(host)).toHaveLength(1);
  });

  test("closing a run's chip ends the run through the engine, and Run again restarts it", async () => {
    const run = { terminalId: "term_run", runId: "term_run", sessionId: "session_a", title: "web dev #2", configId: "cfg_web", command: "bun run dev", status: "ready", activity: "idle", startedAt: 1, env: [] } as unknown as RunView;
    const posted: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") posted.push(url);
      if (url.includes("/run/status")) return Response.json({ terminals: [run] });
      if (url.includes("/run/configs")) return Response.json({ configurations: [] });
      if (url.includes("/run/")) return Response.json(run);
      return listing();
    }) as typeof fetch;
    const bridge = installBridge({ live: [{ id: "t1" }], activity: [{ id: "term_run", active: false, processes: 0 }] });
    const params = workspaceParams(upsertRunShell(readWorkspace(restored("t1")), { terminalId: "term_run", title: "web dev #2", run: { runId: "term_run", configId: "cfg_web" } }));
    const { host } = await mount(params);
    await flush(() => host.querySelector('button[aria-label="Run web dev #2 again"]') !== null);
    await click(button(host, "Run web dev #2 again"));
    expect(posted.some((url) => url.includes("/run/restart"))).toBe(true);
    await click(button(host, "Close web dev #2"));
    expect(posted.some((url) => url.includes("/run/stop"))).toBe(true);
    expect(bridge.closes).toEqual([]);
    expect(chips(host).map((chip) => chip.textContent)).toEqual(["Shell 1"]);
  });
});
