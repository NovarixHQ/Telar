import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopBrowserBridge, DesktopBrowserPanelState, DesktopBrowserTab } from "../types";
import { describeLoadError, errorText } from "../load-error";
import { DesktopBrowserSurface } from "./desktop-browser-surface";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refused = { code: "ERR_CONNECTION_REFUSED", url: "http://localhost:5173/" };

const tab = (patch: Partial<DesktopBrowserTab> = {}): DesktopBrowserTab => ({
  index: 0,
  id: "tab_1",
  title: "localhost:5173",
  url: "http://localhost:5173/",
  active: true,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  viewport: { width: 1280, height: 800, preset: "default", mode: "fit" },
  ...patch,
});

const state = (patch: Partial<DesktopBrowserTab>): DesktopBrowserPanelState => ({ scopeKey: "session_a", tabs: [tab(patch)] });

const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

async function waitFor(ready: () => boolean) {
  for (let attempt = 0; attempt < 30 && !ready(); attempt += 1) await tick();
}

let unmount: (() => void) | null = null;
afterEach(() => { unmount?.(); unmount = null; });
afterAll(async () => { await GlobalRegistrator.unregister(); });

async function mount(initial: DesktopBrowserPanelState, action: DesktopBrowserBridge["action"]) {
  let latest = initial;
  const listeners = new Set<(next: DesktopBrowserPanelState) => void>();
  const bridge: DesktopBrowserBridge = {
    getState: async () => latest,
    action,
    setBounds: async () => {},
    setVisible: async () => {},
    onState: (listener) => { listeners.add(listener); return () => void listeners.delete(listener); },
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<DesktopBrowserSurface bridge={bridge} scopeKey="session_a" projectId="project_a" />); });
  await waitFor(() => Boolean(host.querySelector('[role="tab"]')));
  unmount = () => { act(() => root.unmount()); host.remove(); };
  return { host, push: (next: DesktopBrowserPanelState) => act(() => { latest = next; for (const listener of listeners) listener(next); }) };
}

const alerts = (host: Element) => [...host.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const button = (host: Element, label: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === label);

describe("a page that failed to load", () => {
  test("the page area says why, with the host, and no band appears", async () => {
    const { host } = await mount(state({ loadError: refused }), async () => state({ loadError: refused }));
    const page = alerts(host);
    expect(page).toHaveLength(1);
    expect(page[0]).toContain("Can’t reach this page");
    expect(page[0]).toContain("Nothing is listening on localhost:5173.");
  });

  test("Retry reloads the page, and a page that then loads replaces the error view", async () => {
    const actions: Record<string, unknown>[] = [];
    const { host, push } = await mount(state({ loadError: refused }), async (_scope, action) => {
      actions.push(action);
      return state({ loading: true, loadError: refused });
    });
    await act(async () => { button(host, "Retry")!.click(); });
    await waitFor(() => Boolean(host.querySelector('[aria-busy="true"]')));
    expect(actions).toContainEqual({ action: "reload" });
    expect(alerts(host)).toHaveLength(1);
    await push(state({ loadError: null }));
    expect(alerts(host)).toEqual([]);
  });

  test("an action that genuinely fails shows a band without the shell's IPC wrapper", async () => {
    const { host } = await mount(state({ loadError: refused }), async () => {
      throw new Error("Error invoking remote method 'telar:browser:action': Error: The tab was closed while the page was still loading.");
    });
    await act(async () => { button(host, "Retry")!.click(); });
    await waitFor(() => alerts(host).length > 1);
    const band = alerts(host).find((text) => !text.includes("Can’t reach"));
    expect(band).toStartWith("The tab was closed while the page was still loading.");
  });
});

describe("the reason a load failed", () => {
  test("common net errors read in plain language; anything else names its code", () => {
    const reason = (code: string, url = "https://app.example:8443/x") => describeLoadError({ code, url }).reason;
    expect(describeLoadError(refused).host).toBe("localhost:5173");
    expect(reason("ERR_NAME_NOT_RESOLVED")).toBe("No server could be found at app.example.");
    expect(reason("ERR_CONNECTION_TIMED_OUT")).toBe("app.example:8443 took too long to respond.");
    expect(reason("ERR_INTERNET_DISCONNECTED")).toBe("This computer is not connected to the internet.");
    expect(reason("ERR_CERT_AUTHORITY_INVALID")).toBe("app.example:8443 did not offer a secure connection that could be trusted.");
    expect(reason("ERR_EMPTY_RESPONSE")).toBe("The page could not be loaded (ERR_EMPTY_RESPONSE).");
  });

  test("a page whose renderer kept dying says it crashed, not that it is unreachable", () => {
    expect(describeLoadError({ code: "ERR_RENDERER_GONE", url: "https://www.youtube.com/" })).toMatchObject({ title: "This page crashed", host: "www.youtube.com" });
  });

  test("errors shown to people drop the IPC prefix", () => {
    expect(errorText(new Error("Error invoking remote method 'telar:browser:action': Error: Boom"), "x")).toBe("Boom");
    expect(errorText("nope", "fallback")).toBe("fallback");
  });
});
