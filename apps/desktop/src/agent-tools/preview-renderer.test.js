const { describe, expect, test } = require("bun:test");
const { createPreviewRenderer } = require("./preview-renderer");

const PAGE_EVENTS = [
  ["Runtime.consoleAPICalled", { type: "error", args: [{ type: "string", value: "chart failed:" }, { type: "number", value: 3 }], stackTrace: { callFrames: [{ functionName: "draw", url: "", lineNumber: 2, columnNumber: 6 }] } }],
  ["Runtime.consoleAPICalled", { type: "warning", args: [{ type: "string", value: "slow" }], stackTrace: { callFrames: [] } }],
  ["Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "noise" }] }],
  ["Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught", exception: { description: "ReferenceError: x is not defined\n    at <anonymous>:1:1" } } }],
  ["Log.entryAdded", { entry: { source: "security", level: "error", text: "Refused to load the image 'https://cdn.example.com/a.png'" } }],
  ["Log.entryAdded", { entry: { source: "network", level: "error", text: "Failed to load resource" } }],
  ["Network.requestWillBeSent", { requestId: "r1", request: { url: "https://cdn.example.com/a.png" } }],
  ["Network.loadingFailed", { requestId: "r1", errorText: "net::ERR_BLOCKED_BY_CLIENT", blockedReason: "csp" }],
];

function fakeElectron({ contentHeight = 300, broken = [], hang = false, png = Buffer.from("png") } = {}) {
  const windows = [];
  const partitions = [];
  let alive = 0;
  let mostAlive = 0;
  const session = {
    fromPartition(name) {
      const sealed = { name };
      partitions.push(sealed);
      return {
        webRequest: { onBeforeRequest: (filter) => (sealed.filter = filter) },
        setPermissionRequestHandler: (handler) => (sealed.permission = handler),
      };
    },
  };
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.sizes = [];
      this.commands = [];
      windows.push(this);
      mostAlive = Math.max(mostAlive, ++alive);
      const listeners = [];
      this.webContents = {
        setWindowOpenHandler: (handler) => (this.openHandler = handler),
        on: (name, listener) => (this[name] = listener),
        loadURL: async (url) => {
          this.url = url;
          if (hang) return new Promise(() => undefined);
          for (const [method, params] of PAGE_EVENTS) for (const listener of listeners) listener({}, method, params);
        },
        capturePage: async (rect) => {
          this.rect = rect;
          return { toPNG: () => png, resize: ({ width }) => ((this.resizedTo = width), { toPNG: () => Buffer.from("small") }) };
        },
        debugger: {
          attach: (version) => (this.protocol = version),
          on: (name, listener) => name === "message" && listeners.push(listener),
          sendCommand: async (method, params) => {
            this.commands.push({ method, params });
            if (method !== "Runtime.evaluate") return {};
            if (params.expression.includes("createRange")) return { result: { value: contentHeight } };
            if (params.expression.includes("document.images")) return { result: { value: broken } };
            return { result: {} };
          },
        },
      };
    }
    setContentSize(width, height) {
      this.sizes.push([width, height]);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      alive -= 1;
    }
  }
  return { BrowserWindow, session, windows, partitions, mostAlive: () => mostAlive };
}

const request = { html: "<p>hi</p>", width: 728, appearance: "dark", timeoutMs: 5_000 };

describe("the offscreen preview renderer", () => {
  test("draws the page in a hidden offscreen window and reports its console, failed loads and height", async () => {
    const electron = fakeElectron({ broken: ["https://cdn.example.com/a.png", "data:image/svg+xml,broken"] });
    const result = await createPreviewRenderer(electron).render(request);
    const [window] = electron.windows;
    expect(window.options).toMatchObject({ show: false, width: 728, webPreferences: { offscreen: true, sandbox: true, nodeIntegration: false, partition: "telar-preview" } });
    expect(Buffer.from(window.url.split(",")[1], "base64").toString("utf8")).toBe("<p>hi</p>");
    expect(window.commands).toContainEqual({ method: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-color-scheme", value: "dark" }] } });
    expect(window.sizes).toEqual([[728, 300]]);
    expect(window.rect).toEqual({ x: 0, y: 0, width: 728, height: 300 });
    expect(window.destroyed).toBe(true);
    expect(result).toEqual({
      png: Buffer.from("png").toString("base64"),
      contentHeight: 300,
      capturedHeight: 300,
      console: [
        { level: "error", text: "chart failed: 3", stack: "at draw (page:3:7)" },
        { level: "warning", text: "slow" },
        { level: "error", text: "Uncaught ReferenceError: x is not defined", stack: "at <anonymous>:1:1" },
        { level: "error", text: "Refused to load the image 'https://cdn.example.com/a.png'" },
      ],
      failedLoads: [
        { url: "https://cdn.example.com/a.png", reason: "blocked by the artifact's content security policy" },
        { url: "data:image/svg+xml,broken", reason: "the image did not load" },
      ],
    });
  });

  test("caps the capture of a tall page and halves an oversized screenshot", async () => {
    const electron = fakeElectron({ contentHeight: 9_000, png: Buffer.alloc(3_600_000) });
    const result = await createPreviewRenderer(electron).render(request);
    expect(result).toMatchObject({ contentHeight: 9_000, capturedHeight: 4_000, png: Buffer.from("small").toString("base64") });
    expect(electron.windows[0].resizedTo).toBe(364);
  });

  test("seals its partition: no network, no permissions, no popups, no navigation", async () => {
    const electron = fakeElectron();
    await createPreviewRenderer(electron).render(request);
    const [sealed] = electron.partitions;
    const verdict = (url) => {
      let answer;
      sealed.filter({ url }, (value) => (answer = value));
      return answer;
    };
    expect(verdict("https://cdn.example.com/chart.js")).toEqual({ cancel: true });
    expect(verdict("http://127.0.0.1:4100/state")).toEqual({ cancel: true });
    expect(verdict("file:///etc/hosts")).toEqual({ cancel: true });
    expect(verdict("data:text/html;base64,PHA+")).toEqual({ cancel: false });
    let granted;
    sealed.permission({}, "media", (value) => (granted = value));
    expect(granted).toBe(false);
    const [window] = electron.windows;
    expect(window.openHandler()).toEqual({ action: "deny" });
    let prevented = false;
    window["will-navigate"]({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });

  test("closes the window and refuses when the page never settles", async () => {
    const electron = fakeElectron({ hang: true });
    await expect(createPreviewRenderer(electron).render({ ...request, timeoutMs: 20 })).rejects.toThrow("The page did not settle within 1 s.");
    expect(electron.windows[0].destroyed).toBe(true);
  });

  test("renders one page at a time", async () => {
    const electron = fakeElectron();
    const renderer = createPreviewRenderer(electron);
    await Promise.all([renderer.render(request), renderer.render(request), renderer.render(request)]);
    expect(electron.windows).toHaveLength(3);
    expect(electron.mostAlive()).toBe(1);
  });

  test("refuses a bad request without opening a window", async () => {
    const electron = fakeElectron();
    const renderer = createPreviewRenderer(electron);
    expect(() => renderer.render({ ...request, html: "" })).toThrow("needs its html");
    expect(() => renderer.render({ ...request, html: "x".repeat(1_500_001) })).toThrow("too large");
    expect(() => renderer.render({ ...request, width: 100 })).toThrow("240 to 1600");
    expect(() => renderer.render({ ...request, appearance: "sepia" })).toThrow("light or dark");
    expect(() => renderer.render({ ...request, timeoutMs: undefined })).toThrow("timeout");
    expect(electron.windows).toEqual([]);
  });
});
