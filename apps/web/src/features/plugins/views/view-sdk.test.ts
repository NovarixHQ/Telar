import { afterEach, describe, expect, test } from "bun:test";
import { VIEW_BRIDGE_VERSION, VIEW_SDK_SOURCE } from "@telar/engine-client";
import { installTestDom } from "@/test/dom";
import { assetReference, newNonce, viewDocument } from "./view-document";

installTestDom();

// The cockpit's own page API lives at `window.telar` too, installed once per process; this file must hand it back.
const pageApi = Object.getOwnPropertyDescriptor(window, "telar");
const realPostMessage = window.postMessage;
afterEach(() => {
  delete (window as { telar?: unknown }).telar;
  if (pageApi) Object.defineProperty(window, "telar", pageApi);
  window.postMessage = realPostMessage;
});

type Telar = {
  context(): Promise<unknown>;
  call(verb: string, input?: Record<string, unknown>): Promise<unknown>;
  onTheme(listener: (theme: unknown) => void): void;
};

function loadSdk() {
  const sent: { nonce: string; id: number; request: unknown }[] = [];
  window.postMessage = ((message: never) => void sent.push(message)) as typeof window.postMessage;
  delete (window as { telar?: unknown }).telar;
  new Function(VIEW_SDK_SOURCE)();
  const host = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: window }));
  return { telar: (window as unknown as { telar: Telar }).telar, sent, host };
}

describe("the SDK inside the frame", () => {
  test("a call goes out as a versioned envelope and resolves with the host's reply", async () => {
    const { telar, sent, host } = loadSdk();
    const answer = telar.call("notebook/read", { path: "a.ipynb" });
    expect(sent).toEqual([{ telarView: VIEW_BRIDGE_VERSION, nonce: "", id: 0, request: { op: "call", verb: "notebook/read", input: { path: "a.ipynb" } } }] as never);
    host({ telarView: VIEW_BRIDGE_VERSION, type: "reply", id: 0, ok: true, value: { cells: [] } });
    expect(await answer).toEqual({ cells: [] });

    const refused = telar.call("tool");
    host({ telarView: VIEW_BRIDGE_VERSION, type: "reply", id: 1, ok: false, error: "a view may not call tools" });
    await expect(refused).rejects.toThrow("a view may not call tools");
  });

  test("the host's theme becomes the frame's CSS variables and scheme, at init and on every change", async () => {
    const { telar, host } = loadSdk();
    const seen: unknown[] = [];
    telar.onTheme((theme) => seen.push(theme));
    host({ telarView: VIEW_BRIDGE_VERSION, type: "init", context: { plugin: "echo", view: "log", path: "a.log" }, theme: { scheme: "light", variables: { "--background": "#ffffff" } } });
    expect(await telar.context()).toEqual({ plugin: "echo", view: "log", path: "a.log" });
    const sheet = () => [...document.head.querySelectorAll("style")].at(-1)?.textContent ?? "";
    expect(sheet()).toContain("--background:#ffffff;");
    expect(document.documentElement.dataset.scheme).toBe("light");

    host({ telarView: VIEW_BRIDGE_VERSION, type: "theme", theme: { scheme: "dark", variables: { "--background": "#101010" } } });
    expect(sheet()).toContain("--background:#101010;");
    expect(document.documentElement.dataset.scheme).toBe("dark");
    expect(seen).toHaveLength(2);
  });
});

describe("the frame's document", () => {
  test("a reference stays inside the plugin's views folder: climbing stops at its root, and other origins are dropped", () => {
    expect(assetReference("notebook.html", "views.css")).toBe("views.css");
    expect(assetReference("pages/log.html", "../lib/log.js")).toBe("lib/log.js");
    expect(assetReference("log.html", "../../../server.js")).toBe("server.js");
    expect(assetReference("log.html", "https://cdn.example/x.js")).toBeUndefined();
    expect(assetReference("log.html", "//cdn.example/x.js")).toBeUndefined();
    expect(assetReference("log.html", "data:text/javascript,alert(1)")).toBeUndefined();
    expect(assetReference("log.html", "x.js?v=1")).toBeUndefined();
  });

  test("the plugin's own meta tags cannot loosen the policy, and the SDK always loads first", async () => {
    const nonce = newNonce();
    const html = '<meta http-equiv="Content-Security-Policy" content="script-src *"><base href="https://evil.example/"><script src="telar-view.js"></script><script>go()</script>';
    const doc = new DOMParser().parseFromString(await viewDocument("v.html", html, async () => "", nonce), "text/html");
    expect([...doc.querySelectorAll('meta[http-equiv]')].map((meta) => meta.getAttribute("content"))).toEqual([expect.stringContaining(`script-src 'nonce-${nonce}'`)]);
    expect(doc.querySelector("base")).toBeNull();
    const scripts = [...doc.querySelectorAll("script")];
    expect(scripts.map((script) => script.textContent)).toEqual([VIEW_SDK_SOURCE, "go()"]);
  });
});
