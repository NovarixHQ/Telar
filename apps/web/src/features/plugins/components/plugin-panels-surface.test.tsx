/**
 * THE "PLUGINS" TAB — an installed plugin's panel drawn from its blocks.
 *
 *   the blocks    heading, text, key-value, table and log render as the cockpit's own
 *   an action     posts its verb with its input, then redraws the panel
 *   a confirm     declined, nothing is posted
 *   the sources   only an enabled, running plugin contributes a panel
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PluginStatus } from "@telar/engine-client";

GlobalRegistrator.register({ url: "http://localhost/" });
mock.module("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { fakeSessionsStream } = await import("@/test/sessions-stream");
const { PluginPanelsSurface } = await import("./plugin-panels-surface");
const { panelSourceKey, pluginPanelSources } = await import("../panels");

const status = (id: string, panels: { id: string; label: string; verb: string; refreshOn?: string[] }[], state: PluginStatus["state"] = "ready"): PluginStatus => ({
  meta: { id, api: 1, name: id === "echo" ? "Echo" : id, version: "1", toolPrefixes: [], readTools: [], eventKinds: [], settings: [], panels },
  state,
});

const PANELS = pluginPanelSources([status("echo", [{ id: "jobs", label: "Jobs", verb: "status" }])], ["echo"]);

let cleared = 0;
let panelReads = 0;
let stream = fakeSessionsStream();
let posted: { url: string; body: unknown }[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
const realSetTimeout = window.setTimeout;
const realConfirm = window.confirm;

beforeEach(() => {
  cleared = 0;
  panelReads = 0;
  stream = fakeSessionsStream();
  posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.endsWith("/api/sessions/stream")) return stream.answer(init?.signal);
    posted.push({ url, body });
    if (url.endsWith("/plugins/echo/clear")) {
      cleared += 1;
      return json({ ok: true });
    }
    if (url.endsWith("/plugins/latex/compile")) {
      cleared += 1;
      return json({ ok: true });
    }
    if (url.endsWith("/plugins/latex/panel")) {
      panelReads += 1;
      return json({
        blocks: [
          { type: "action", label: "Compile", verb: "compile", field: { name: "path", placeholder: "Default: main.tex" } },
          { type: "status", text: "Failed · main.tex", tone: "error" },
          { type: "file", label: "Open PDF", path: "main.pdf" },
          { type: "issues", items: [{ severity: "error", message: "Undefined control sequence.", file: "main.tex", line: 3 }] },
          { type: "log", title: "Log tail", lines: ["! Undefined control sequence."], collapsed: true },
        ],
      });
    }
    if (url.endsWith("/plugins/echo/status")) {
      return json({
        blocks: [
          { type: "heading", text: "Jobs" },
          { type: "text", text: `Cleared ${cleared} times` },
          { type: "keyValue", items: [{ key: "Queue", value: 2 }] },
          { type: "table", columns: ["Job", "State"], rows: [["a", "done"], ["b", null]] },
          { type: "log", lines: ["started", "finished"] },
          { type: "chart", points: [] },
          { type: "action", label: "Clear", verb: "clear", input: { all: true }, confirm: "Clear every job?" },
        ],
      });
    }
    return json({});
  }) as typeof fetch;
  window.setTimeout = ((fn: () => void) => {
    queueMicrotask(fn);
    return 0;
  }) as unknown as typeof window.setTimeout;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.setTimeout = realSetTimeout;
  window.confirm = realConfirm;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await Promise.resolve());
};

async function mount(panels = PANELS, onOpenFile?: (path: string) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<PluginPanelsSurface sessionId="session_one" hostId="local" panels={panels} {...(onOpenFile ? { onOpenFile } : {})} />));
  await flush();
  return { host, done: () => act(() => root.unmount()) };
}

const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label) as HTMLButtonElement;

describe("a panel's blocks", () => {
  test("each kind renders, and one this build does not know is skipped", async () => {
    const { host, done } = await mount();
    expect(posted[0]?.url).toBe("/api/sessions/session_one/plugins/echo/status");
    expect(host.querySelector("h3")?.textContent).toBe("Jobs");
    expect(host.textContent).toContain("Cleared 0 times");
    expect(host.querySelector("dt")?.textContent).toBe("Queue");
    expect(host.querySelector("dd")?.textContent).toBe("2");
    expect([...host.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["Job", "State"]);
    expect([...host.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["a", "done", "b", "—"]);
    expect(host.querySelector('[role="log"]')?.textContent).toBe("started\nfinished");
    expect(host.textContent).toContain("Echo · Jobs");
    done();
  });

  test("an action posts its verb with its input, then redraws", async () => {
    window.confirm = () => true;
    const { host, done } = await mount();
    await act(async () => button(host, "Clear").click());
    await flush();
    expect(posted.find((call) => call.url.endsWith("/clear"))?.body).toEqual({ all: true });
    expect(host.textContent).toContain("Cleared 1 times");
    done();
  });

  test("a declined confirm posts nothing", async () => {
    window.confirm = () => false;
    const { host, done } = await mount();
    await act(async () => button(host, "Clear").click());
    await flush();
    expect(cleared).toBe(0);
    done();
  });
});

describe("LaTeX's compile panel, drawn from its blocks", () => {
  const LATEX = pluginPanelSources([status("latex", [{ id: "compile", label: "Compile", verb: "panel" }])], ["latex"]);

  test("a problem and the PDF open their file; the log stays folded until asked", async () => {
    const opened: string[] = [];
    const { host, done } = await mount(LATEX, (path) => opened.push(path));
    expect(posted[0]?.url).toBe("/api/sessions/session_one/plugins/latex/panel");
    expect(host.textContent).toContain("Failed · main.tex");
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Undefined control sequence."))!.click());
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Open PDF"))!.click());
    expect(opened).toEqual(["main.tex", "main.pdf"]);
    expect(host.querySelector('[role="log"]')).toBeNull();
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Log tail")!.click());
    expect(host.querySelector('[role="log"]')?.textContent).toBe("! Undefined control sequence.");
    done();
  });

  test("a compile event on its own session redraws the panel; another session's, or another name, does not", async () => {
    const live = pluginPanelSources([status("latex", [{ id: "compile", label: "Compile", verb: "panel", refreshOn: ["compile.finished"] }])], ["latex"]);
    const { done } = await mount(live);
    expect(panelReads).toBe(1);
    const compiled = (sessionId: string, name = "compile.finished") =>
      stream.announce({ type: "plugin.event", at: 1, id: 2, scope: "session", sessionId, pluginId: "latex", name, data: { ok: true } });
    compiled("session_two");
    compiled("session_one", "compile.started");
    await flush();
    expect(panelReads).toBe(1);
    compiled("session_one");
    await flush();
    expect(panelReads).toBe(2);
    done();
  });

  test("Compile posts the typed path with its verb", async () => {
    const { host, done } = await mount(LATEX);
    const input = host.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "paper/main.tex");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(host, "Compile").click());
    await flush();
    expect(posted.find((call) => call.url.endsWith("/latex/compile"))?.body).toEqual({ path: "paper/main.tex" });
    done();
  });
});

describe("the tab", () => {
  test("come only from an enabled, running plugin", () => {
    const statuses = [status("echo", [{ id: "jobs", label: "Jobs", verb: "status" }]), status("broken", [{ id: "x", label: "X", verb: "x" }], "failed")];
    expect(pluginPanelSources(statuses, [])).toEqual([]);
    expect(pluginPanelSources(statuses, ["broken"])).toEqual([]);
    expect(pluginPanelSources(statuses, ["echo"]).map(panelSourceKey)).toEqual(["echo/jobs"]);
  });
});
