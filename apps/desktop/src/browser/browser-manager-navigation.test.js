const { describe, expect, test } = require("bun:test");

const { makeHarness, textOf } = require("../../test/browser-manager-harness");
describe("navigation replacement — ERR_ABORTED from a superseded load is not a failure", () => {
  function replacing(views, finalUrl) {
    const wc = views[0].webContents;
    wc.loadURL = async function (url) {
      this.emit("did-start-loading");
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });

      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      const error = new Error(`ERR_ABORTED (-3) loading '${url}'`);
      error.errno = -3;
      error.code = "ERR_ABORTED";
      queueMicrotask(() => {
        this.url = finalUrl;
        this.title = "Landed";
        this.emit("did-navigate");
        this.emit("did-stop-loading");
      });
      throw error;
    };
    return wc;
  }

  test("a page that replaces its own load answers with the replacement's outcome, human and agent paths alike", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank");
    replacing(views, "https://landed.example/");
    const state = await manager.action("s", { action: "navigate", url: "https://bounce.example/?themeRefresh=1" });
    expect(state.tabs[0].url).toBe("https://landed.example/");
    const result = await manager.callTool("s", "browser_navigate", { url: "https://bounce.example/?themeRefresh=1" });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("landed.example");
  });

  test("an abort with NO replacement, and any other failure, still fails the agent's navigate", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank");
    const wc = views[0].webContents;
    wc.loadURL = async function () {
      this.emit("did-start-loading");
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      this.emit("did-stop-loading");
      const error = new Error("ERR_ABORTED (-3)");
      error.errno = -3;
      throw error;
    };
    wc.isLoading = () => false;
    const stopped = await manager.callTool("s", "browser_navigate", { url: "https://stopped.example/" });
    expect(stopped.isError).toBe(true);
    expect(textOf(stopped)).toContain("ERR_ABORTED");
    wc.loadURL = async function () {
      const error = new Error("ERR_CONNECTION_REFUSED (-102)");
      error.errno = -102;
      throw error;
    };
    const dead = await manager.callTool("s", "browser_navigate", { url: "https://dead.example/" });
    expect(dead.isError).toBe(true);
    expect(textOf(dead)).toContain("CONNECTION_REFUSED");
  });

  test("a replacement that itself fails reports THAT failure", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank");
    const wc = views[0].webContents;
    wc.loadURL = async function (url) {
      this.emit("did-start-loading");
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      const error = new Error(`ERR_ABORTED (-3) loading '${url}'`);
      error.errno = -3;
      queueMicrotask(() => this.emit("did-fail-load", null, -105, "ERR_NAME_NOT_RESOLVED", "https://nowhere.example/", true));
      throw error;
    };
    wc.isLoading = () => true;
    const state = await manager.action("s", { action: "navigate", url: "https://bounce.example/" });
    expect(state.tabs[0].loadError).toEqual({ code: "ERR_NAME_NOT_RESOLVED", url: "https://nowhere.example/" });
  });
});

describe("a page that fails to load is page state, not a failed action", () => {
  function refusing(wc) {
    wc.loadURL = async function (url) {
      this.emit("did-start-loading");
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      this.emit("did-fail-load", null, -102, "ERR_CONNECTION_REFUSED", url, true);
      this.url = url;
      this.emit("did-stop-loading");
      throw Object.assign(new Error(`ERR_CONNECTION_REFUSED (-102) loading '${url}'`), { errno: -102, code: "ERR_CONNECTION_REFUSED" });
    };
  }

  test("a refused load answers with an error page on the tab and hides the native view; the next page clears it", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank", "human");
    manager.setBounds("s", { x: 0, y: 0, width: 640, height: 400 });
    await manager.setVisible("s", true);
    const tab = manager.activeTab("s");
    const wc = views[0].webContents;
    const loadURL = wc.loadURL;
    refusing(wc);
    const state = await manager.action("s", { action: "navigate", url: "http://localhost:5173/" });
    await tab.geometry.queue;
    expect(state.tabs[0].loadError).toEqual({ code: "ERR_CONNECTION_REFUSED", url: "http://localhost:5173/" });
    expect(views[0].visible).toBe(false);
    wc.loadURL = loadURL;
    const next = await manager.action("s", { action: "navigate", url: "https://one.example/" });
    await tab.geometry.queue;
    expect(next.tabs[0].loadError).toBeNull();
    expect(views[0].visible).toBe(true);
  });

  test("a new tab whose page fails answers with that tab, so a link opened in it never falls back to the system browser", async () => {
    const { manager } = makeHarness();
    const make = manager.createView;
    manager.createView = (options) => {
      const view = make(options);
      refusing(view.webContents);
      return view;
    };
    const state = await manager.action("s", { action: "new", url: "http://localhost:5173/" });
    expect(state.tabs.map((tab) => [tab.url, tab.active, tab.loadError])).toEqual([
      ["http://localhost:5173/", true, { code: "ERR_CONNECTION_REFUSED", url: "http://localhost:5173/" }],
    ]);
  });

  test("aborted loads and subframe failures leave no error page", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank", "human");
    const wc = views[0].webContents;
    wc.loadURL = async function (url) {
      this.emit("did-start-loading");
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      this.emit("did-fail-load", null, -102, "ERR_CONNECTION_REFUSED", "https://ads.example/frame", false);
      this.emit("did-fail-load", null, -3, "ERR_ABORTED", url, true);
      this.emit("did-stop-loading");
      throw Object.assign(new Error(`ERR_ABORTED (-3) loading '${url}'`), { errno: -3 });
    };
    wc.isLoading = () => false;
    const state = await manager.action("s", { action: "navigate", url: "https://stopped.example/" });
    expect(state.tabs[0].loadError).toBeNull();
  });

  test("a failure that is not a page load still rejects", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank", "human");
    views[0].webContents.loadURL = async function () {
      throw new Error("The tab was closed while the page was still loading.");
    };
    await expect(manager.action("s", { action: "navigate", url: "https://one.example/" })).rejects.toThrow(/tab was closed/);
  });
});

describe("the start page's contract — onVisited and the hidden blank view", () => {
  test("onVisited fires for a committed http(s) top-level navigation only: not blank, not an error status, not an extension page", async () => {
    const visited = [];
    const { manager, views } = makeHarness({ onVisited: (scopeKey, url) => visited.push([scopeKey, url]) });
    await manager.createTab("s", "https://one.example/");
    const wc = views[0].webContents;
    wc.url = "https://two.example/path"; wc.emit("did-navigate", null, "https://two.example/path", 200);
    wc.url = "https://err.example/"; wc.emit("did-navigate", null, "https://err.example/", 404);
    wc.url = "chrome-extension://abc/x.html"; wc.emit("did-navigate", null, "chrome-extension://abc/x.html", 200);
    wc.url = "about:blank"; wc.emit("did-navigate", null, "about:blank", 0);
    expect(visited).toEqual([["s", "https://one.example/"], ["s", "https://two.example/path"]]);
  });

  test("onTitled reports a page's title for its history row, never an extension page's", async () => {
    const titled = [];
    const { manager, views } = makeHarness({ onTitled: (scopeKey, url, title) => titled.push([scopeKey, url, title]) });
    await manager.createTab("s", "https://one.example/");
    const wc = views[0].webContents;
    wc.url = "https://one.example/"; wc.emit("page-title-updated", null, "One");
    wc.url = "chrome-extension://abc/x.html"; wc.emit("page-title-updated", null, "Extension");
    expect(titled).toEqual([["s", "https://one.example/", "One"]]);
  });

  test("a blank active tab shows NO native view (the DOM start page is under it); a navigation reveals it", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank", "human");
    manager.setBounds("s", { x: 0, y: 0, width: 640, height: 400 });
    await manager.setVisible("s", true);
    const tab = manager.activeTab("s");
    await tab.geometry.queue;
    expect(views[0].visible).toBe(false);
    await manager.action("s", { action: "navigate", url: "https://one.example/" });
    await tab.geometry.queue;
    expect(views[0].visible).toBe(true);
    expect(views[0].bounds).toEqual({ x: 0, y: 0, width: 640, height: 400 });
  });
});

describe("navigation replacement — the waiter's endings", () => {
  function stalledReplacement(views) {
    const wc = views[0].webContents;
    wc.isLoading = () => true;
    wc.loadURL = async function () {
      this.emit("did-start-loading");
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      throw Object.assign(new Error("ERR_ABORTED (-3)"), { errno: -3 });
    };
    return wc;
  }
  const EVENTS = ["did-start-navigation", "did-navigate", "did-navigate-in-page", "did-fail-load", "did-stop-loading", "destroyed"];

  test("a replacement whose load STOPS before any commit is a failure, not a success", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank");
    const wc = stalledReplacement(views);
    const pending = manager.callTool("s", "browser_navigate", { url: "https://bounce.example/" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    wc.emit("did-stop-loading");
    expect(textOf(await pending)).toContain("stopped before a page committed");
  });

  test("a tab closed mid-replacement rejects; a same-document replacement counts as a commit", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "about:blank");
    const wc = stalledReplacement(views);
    const closed = manager.action("s", { action: "navigate", url: "https://bounce.example/" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    wc.emit("destroyed");
    await expect(closed).rejects.toThrow(/closed while the page/);
    const { manager: m2, views: v2 } = makeHarness();
    await m2.createTab("s", "about:blank");
    const wc2 = stalledReplacement(v2);
    const inPage = m2.action("s", { action: "navigate", url: "https://bounce.example/" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    wc2.url = "https://bounce.example/#landed";
    wc2.emit("did-navigate-in-page");
    await expect(inPage).resolves.toBeTruthy();
  });

  test("the deadline rejects AND removes every listener it attached", async () => {
    const { manager, views } = makeHarness({ rpcTimeoutMs: 30 });
    await manager.createTab("s", "about:blank");
    const wc = stalledReplacement(views);
    const before = EVENTS.map((name) => wc.listenerCount(name));
    await expect(manager.action("s", { action: "navigate", url: "https://bounce.example/" })).rejects.toThrow(/never settled/);
    expect(EVENTS.map((name) => wc.listenerCount(name))).toEqual(before);
  });
});

describe("page favicon", () => {
  test("the page's favicon reaches tab state, stays within the site and clears when the tab moves to another", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "https://one.example/");
    const wc = views[0].webContents;
    const favicon = () => manager.state("s").tabs[0].favicon;

    wc.emit("page-favicon-updated", {}, ["https://one.example/f.ico"]);
    expect(favicon()).toBe("https://one.example/f.ico");

    wc.url = "https://one.example/next";
    wc.emit("did-navigate", {}, wc.url, 200);
    expect(favicon()).toBe("https://one.example/f.ico");

    wc.url = "https://two.example/";
    wc.emit("did-navigate", {}, wc.url, 200);
    expect(favicon()).toBeNull();
  });

  test("candidates a remote cockpit cannot load are skipped", async () => {
    const { manager, views } = makeHarness();
    await manager.createTab("s", "https://one.example/");
    const wc = views[0].webContents;
    wc.emit("page-favicon-updated", {}, [`data:image/png;base64,${"A".repeat(5000)}`, "file:///etc/icon.png", "data:image/svg+xml,<svg/>"]);
    expect(manager.state("s").tabs[0].favicon).toBe("data:image/svg+xml,<svg/>");
    wc.emit("page-favicon-updated", {}, ["chrome://favicon/x"]);
    expect(manager.state("s").tabs[0].favicon).toBeNull();
  });
});
