import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import type { PluginStatus } from "@telar/engine-client";
import { installTestDom, mount, flush } from "@/test/dom";
import { DATA_SCIENCE_STATUS } from "@/test/plugin-statuses";
import { setPluginStatuses } from "./contributions";
import { PluginFileView } from "./plugin-file-view";

installTestDom();
// Happy DOM fetches a parsed document's stylesheets, which a browser's DOMParser never does.
Object.assign((window as unknown as { happyDOM: { settings: object } }).happyDOM.settings, { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true });

const DS_VIEWS = path.resolve(import.meta.dir, "../../../../../engine/plugins/data-science/views");

const ECHO_STATUS: PluginStatus = {
  meta: {
    id: "echo",
    api: 1,
    name: "Echo",
    version: "0.1.0",
    toolPrefixes: [],
    readTools: [],
    eventKinds: [],
    settings: [],
    viewers: [{ id: "log", label: "Log", entry: "log.html", extensions: [".log"], mimes: [] }],
    fileScope: [".txt"],
  },
  state: "ready",
};

const ECHO_ASSETS: Record<string, string> = {
  "log.html": '<html><head><script src="https://cdn.example/evil.js"></script></head><body><pre id="out"></pre><script src="lib/log.js"></script></body></html>',
  "lib/log.js": "telar.readFile().then((file) => (out.textContent = file.text));",
};

type Call = { method: string; url: URL };

function serve(assets: (plugin: string, asset: string) => string | undefined, json: Record<string, () => unknown> = {}) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const asset = /^\/api\/plugin-assets\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (asset) {
      const text = assets(asset[1]!, decodeURIComponent(asset[2]!));
      return text === undefined ? Response.json({ error: { code: "not_found", message: "no asset" } }, { status: 404 }) : new Response(text, { headers: { "content-type": "text/html" } });
    }
    const answer = json[`${method} ${url.pathname}`];
    return answer ? Response.json(answer()) : Response.json({ error: { code: "not_found", message: `no route ${url.pathname}` } }, { status: 404 });
  }) as typeof fetch;
  return calls;
}

const frameOf = (host: HTMLElement) => host.querySelector("iframe");

function parse(doc: string | null): Document {
  return new DOMParser().parseFromString(doc ?? "", "text/html");
}

function captured(frame: HTMLIFrameElement) {
  const posted: { type?: string; [key: string]: unknown }[] = [];
  const target = frame.contentWindow!;
  target.postMessage = ((message: unknown) => void posted.push(message as never)) as typeof target.postMessage;
  return posted;
}

describe("a notebook opens in Data Science's viewer", () => {
  test("the frame is sandboxed, under a nonce CSP, drawn from the plugin's own files", async () => {
    setPluginStatuses([DATA_SCIENCE_STATUS]);
    serve((plugin, asset) => (plugin === "data-science" ? fs.readFileSync(path.join(DS_VIEWS, asset), "utf8") : undefined));
    const { host } = await mount(<PluginFileView path="work/analysis.ipynb" enabledPlugins={["data-science"]} sessionId="session_1" fallback={<p>code view</p>} />);
    await flush(() => Boolean(frameOf(host)));

    const frame = frameOf(host)!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.title).toBe("Data science · Notebook");
    const doc = parse(frame.getAttribute("srcdoc"));
    const policy = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
    const nonce = /'nonce-([0-9a-f]{32})'/.exec(policy)?.[1];
    expect(nonce).toBeDefined();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    const scripts = [...doc.querySelectorAll("script")];
    expect(scripts.length).toBe(2);
    expect(scripts.every((script) => script.getAttribute("nonce") === nonce)).toBe(true);
    expect(scripts[0]!.textContent).toContain("telarView");
    expect(scripts[1]!.textContent).toContain('telar.call("notebook/read"');
    expect(doc.querySelector("link")).toBeNull();
    expect([...doc.querySelectorAll("style")].some((style) => style.textContent?.includes(".bar {"))).toBe(true);
  });

  test("with Data Science off the file falls back to the code view", async () => {
    setPluginStatuses([DATA_SCIENCE_STATUS]);
    serve(() => undefined);
    const { host } = await mount(<PluginFileView path="analysis.ipynb" enabledPlugins={[]} sessionId="session_1" fallback={<p>code view</p>} />);
    expect(frameOf(host)).toBeNull();
    expect(host.textContent).toBe("code view");
  });
});

describe("an installed plugin's viewer works the same way", () => {
  async function opened() {
    setPluginStatuses([DATA_SCIENCE_STATUS, ECHO_STATUS]);
    const calls = serve((plugin, asset) => (plugin === "echo" ? ECHO_ASSETS[asset] : undefined), {
      "GET /api/sessions/session_1/files": () => ({ file: { path: "logs/app.log", text: "booted", sha256: "x", binary: false, truncated: false } }),
    });
    const { host } = await mount(<PluginFileView path="logs/app.log" enabledPlugins={["echo"]} sessionId="session_1" fallback={<p>code view</p>} />);
    await flush(() => Boolean(frameOf(host)));
    const frame = frameOf(host)!;
    const nonce = /'nonce-([0-9a-f]{32})'/.exec(frame.getAttribute("srcdoc") ?? "")![1]!;
    return { calls, frame, nonce, posted: captured(frame) };
  }

  const ask = (frame: HTMLIFrameElement, nonce: string, id: number, request: unknown, origin = "null") =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { telarView: 1, nonce, id, request }, origin, source: frame.contentWindow }));
    });

  test("its own script is inlined with the nonce, and a script from anywhere else is dropped", async () => {
    const { frame, nonce } = await opened();
    expect(frame.title).toBe("Echo · Log");
    const scripts = [...parse(frame.getAttribute("srcdoc")).querySelectorAll("script")];
    expect(scripts.map((script) => script.getAttribute("src"))).toEqual([null, null]);
    expect(scripts[1]!.textContent).toBe(ECHO_ASSETS["lib/log.js"]!);
    expect(scripts.every((script) => script.getAttribute("nonce") === nonce)).toBe(true);
  });

  test("it reads the file it was opened on through the bridge, and is refused one outside its scope", async () => {
    const { calls, frame, nonce, posted } = await opened();
    await ask(frame, nonce, 7, { op: "read" });
    await flush(() => posted.some((message) => message.id === 7));
    expect(calls.filter((call) => call.url.pathname === "/api/sessions/session_1/files").map((call) => call.url.searchParams.get("path"))).toEqual(["logs/app.log"]);
    expect(posted.find((message) => message.id === 7)).toMatchObject({ type: "reply", ok: true, value: { text: "booted" } });

    await ask(frame, nonce, 8, { op: "read", path: "secrets.json" });
    await flush(() => posted.some((message) => message.id === 8));
    expect(posted.find((message) => message.id === 8)).toMatchObject({ type: "reply", ok: false, error: "echo may not read secrets.json" });

    await ask(frame, "0".repeat(32), 9, { op: "read" });
    await ask(frame, nonce, 10, { op: "read" }, "http://localhost");
    await flush();
    expect(posted.some((message) => message.id === 9 || message.id === 10)).toBe(false);
  });

  test("the cockpit's theme reaches the frame on load and follows it live", async () => {
    const { frame, posted } = await opened();
    await act(async () => void frame.dispatchEvent(new Event("load")));
    expect(posted.find((message) => message.type === "init")).toMatchObject({ context: { plugin: "echo", view: "log", path: "logs/app.log" }, theme: { scheme: "light" } });

    await act(async () => void document.documentElement.classList.add("dark"));
    await flush(() => posted.some((message) => message.type === "theme" && (message.theme as { scheme: string }).scheme === "dark"));
    expect(posted.filter((message) => message.type === "theme").at(-1)).toMatchObject({ theme: { scheme: "dark" } });
    await act(async () => void document.documentElement.classList.remove("dark"));
  });
});
