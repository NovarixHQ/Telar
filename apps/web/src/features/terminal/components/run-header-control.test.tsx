import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { headerMode } from "../hooks/use-run-header";
import { RunHeaderControl } from "./run-header-control";
import { RunConfigEditor } from "./run-config-editor";
import { RunGlyph } from "../run/icons";
import type { RunApi } from "../run/api";
import type { RunConfigurationView, RunStatusAnswer, RunView } from "../run/types";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const realFetch = globalThis.fetch;
afterAll(async () => {
  globalThis.fetch = realFetch;
  await GlobalRegistrator.unregister();
});

const view = (over: Partial<RunView> = {}): RunView => ({
  terminalId: "term_1",
  runId: "term_1",
  projectId: "project_1",
  sessionId: "session_1",
  origin: "run",
  title: "dev server",
  configId: "config_dev",
  configName: "dev server",
  command: "bun dev",
  worktreePath: "/Users/x/code/telar",
  cwd: "/Users/x/code/telar",
  status: "ready",
  activity: "busy",
  readiness: { kind: "none" },
  startedAt: 1,
  env: [],
  ...over,
});

/** A client that records what the control asked it to do. */
function recordingApi(status: RunStatusAnswer) {
  const calls: string[] = [];
  const api = {
    configurations: async () => ({ configurations: [{ id: "config_dev", name: "dev server" }] }),
    status: async () => status,
    start: async (_s: string, configId: string) => (calls.push(`start:${configId}`), view()),
  } as unknown as RunApi;
  return { api, calls };
}

const render = (api: RunApi) => renderToStaticMarkup(<RunHeaderControl sessionId="session_1" api={api} onWatchOutput={() => {}} />);

describe("the pill", () => {
  test("says Run over nothing open", () => {
    const { api } = recordingApi({ terminals: [] });
    expect(render(api)).toContain("Run this project");
  });

  test("the first paint names no deployment slot to replace, switch or release", () => {
    const { api } = recordingApi({ terminals: [] });
    const html = render(api);
    for (const word of ["Replace", "Switch", "Release", "Restart"]) expect(html).not.toContain(word);
  });
});

describe("the empty state", () => {
  const config = (over: Partial<RunConfigurationView> = {}): RunConfigurationView =>
    ({ id: "config_dev", name: "dev server", ...over }) as RunConfigurationView;

  test("no saved configuration is the one setup case", () => {
    expect(headerMode([])).toBe("setup");
    // An unread list is unknown, not empty.
    expect(headerMode(undefined)).toBe("run");
    expect(headerMode([config()])).toBe("run");
  });

  test("the setup case opens the editor, which paints the form rather than a menu", () => {
    const html = renderToStaticMarkup(<RunConfigEditor onSave={() => {}} onCancel={() => {}} />);
    expect(html).toContain("Command");
    expect(html).toContain('aria-label="Server"');
    expect(html).toContain('role="radio" aria-checked="true" aria-label="Play"');
    expect(html).not.toContain("Give this configuration a name.");
  });

  test("a configuration's own glyph differs from the default one", () => {
    const server = renderToStaticMarkup(<RunGlyph icon="server" className="size-3.5" />);
    const unset = renderToStaticMarkup(<RunGlyph className="size-3.5" />);
    expect(unset).toContain("<svg");
    expect(server).not.toBe(unset);
  });
});

describe("the open menu", () => {
  let mounted: Root | undefined;
  beforeEach(() => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  });
  afterEach(() => {
    const root = mounted;
    mounted = undefined;
    if (root) act(() => root.unmount());
    document.body.innerHTML = "";
  });

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function openMenu(status: RunStatusAnswer) {
    const recorded = recordingApi(status);
    const host = document.createElement("div");
    document.body.append(host);
    mounted = createRoot(host);
    await act(async () => mounted!.render(<RunHeaderControl sessionId="session_1" api={recorded.api} onWatchOutput={() => {}} />));
    await flush();
    const trigger = host.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
      trigger.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
      trigger.click();
    });
    await flush();
    return recorded;
  }

  const buttons = () => [...document.body.querySelectorAll("button")] as HTMLButtonElement[];

  test("Run hands the configuration to the engine, which opens or reuses its shell", async () => {
    const { calls } = await openMenu({ terminals: [view()] });
    const run = buttons().find((button) => button.getAttribute("aria-label") === "Run dev server");
    expect(run?.textContent).toBe("Run dev server");
    await act(async () => run!.click());
    await flush();
    expect(calls).toEqual(["start:config_dev"]);
  });

  test("an open terminal changes nothing: no Open section, no status, no stop control", async () => {
    await openMenu({ terminals: [view()] });
    const menu = document.body.textContent ?? "";
    expect(menu).toContain("Run dev server");
    expect(menu).toContain("New configuration");
    expect(menu).toContain("Show terminals");
    expect(document.body.querySelector('[aria-label="Open terminals"]')).toBeNull();
    expect(menu).not.toMatch(/Running|Ready|Idle|Open/);
    expect(buttons().some((button) => /^(End|Stop|Restart) /.test(button.getAttribute("aria-label") ?? ""))).toBe(false);
  });

  test("the button reads Run while a terminal is busy", async () => {
    await openMenu({ terminals: [view()] });
    const trigger = document.body.querySelector('button[aria-label="Run this project"]');
    expect(trigger?.textContent).toBe("Run");
  });
});
