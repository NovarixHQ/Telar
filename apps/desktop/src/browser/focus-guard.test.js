const { describe, expect, test } = require("bun:test");

const { makeHarness, textOf } = require("../../test/browser-manager-harness");

function focusOf(manager) {
  const cockpit = manager.window.webContents;
  const calls = { cockpit: 0, page: 0, window: 0 };
  let holder = cockpit;
  cockpit.isFocused = () => holder === cockpit;
  cockpit.focus = () => {
    calls.cockpit += 1;
    holder = cockpit;
  };
  manager.window.focus = () => { calls.window += 1; };
  const page = (wc) => {
    wc.isFocused = () => holder === wc;
    wc.focus = () => { calls.page += 1; };
    return wc;
  };
  const steal = (wc) => {
    holder = wc;
    wc.emit("focus");
  };
  return { calls, page, steal, inCockpit: () => holder === cockpit };
}

function stealOn(focus, wc, method, when = () => true) {
  const debug = wc.debugger;
  const send = debug.sendCommand.bind(debug);
  debug.sendCommand = async (name, params) => {
    const answer = await send(name, params);
    if (name === method && when(params)) focus.steal(wc);
    return answer;
  };
}

async function agentTab(scope, url, { shown = false, now } = {}) {
  const harness = makeHarness(now ? { now } : {});
  const focus = focusOf(harness.manager);
  await harness.manager.callTool(scope, "browser_tabs", { action: "new", url });
  if (shown) await harness.manager.setVisible(scope, true);
  const wc = focus.page(harness.views[0].webContents);
  await harness.manager.callTool(scope, "browser_snapshot", {});
  return { ...harness, focus, wc };
}

describe("agent actions leave keyboard focus where the person is typing", () => {
  test("a click in another conversation's hidden tab hands focus straight back to the composer", async () => {
    const { manager, focus, wc } = await agentTab("other", "https://agent.example/");
    stealOn(focus, wc, "Input.dispatchMouseEvent", (params) => params.type === "mousePressed");

    const result = await manager.callTool("other", "browser_click", { target: "e1", element: "Count" });

    expect(textOf(result)).toBe("Clicked Count.");
    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
    expect(focus.calls.window).toBe(0);
  });

  test("typing into a field of the tab shown in the panel does not keep focus in the page", async () => {
    const { manager, focus, wc } = await agentTab("s", "https://agent.example/", { shown: true });
    stealOn(focus, wc, "Runtime.callFunctionOn");

    const result = await manager.callTool("s", "browser_type", { target: "e1", element: "Count", text: "hello" });

    expect(result.isError).toBeFalsy();
    expect(wc.debugger.commands.some((entry) => entry.method === "Input.insertText" && entry.params.text === "hello")).toBe(true);
    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });

  test("navigating a background tab does not take focus from the composer", async () => {
    const { manager, focus, wc } = await agentTab("other", "https://agent.example/");
    const load = wc.loadURL.bind(wc);
    wc.loadURL = async (url) => {
      await load(url);
      focus.steal(wc);
    };

    await manager.callTool("other", "browser_navigate", { url: "https://next.example/" });

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
    expect(focus.calls.window).toBe(0);
  });

  test("a hidden tab that grabs focus between actions gives it back", async () => {
    const { focus, wc } = await agentTab("other", "https://agent.example/");
    focus.steal(wc);
    expect(focus.inCockpit()).toBe(true);
  });

  test("an agent navigating the shown tab does not take focus from the composer", async () => {
    const { manager, focus, wc } = await agentTab("s", "https://agent.example/", { shown: true });
    const load = wc.loadURL.bind(wc);
    wc.loadURL = async (url) => {
      await load(url);
      focus.steal(wc);
    };

    await manager.callTool("s", "browser_navigate", { url: "https://next.example/" });

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });
});

describe("the shown page changing leaves keyboard focus in the composer", () => {
  async function shownTab() {
    let clock = 1_000_000;
    const harness = await agentTab("s", "https://app.example/", { shown: true, now: () => clock });
    clock += 5_000;
    return { ...harness, tick: (ms) => { clock += ms; } };
  }

  test("a reload from the panel that focuses the page hands focus back", async () => {
    const { manager, focus, wc } = await shownTab();
    wc.reload = () => focus.steal(wc);

    await manager.action("s", { action: "reload" });

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });

  test("an address bar navigation that focuses the page hands focus back", async () => {
    const { manager, focus, wc } = await shownTab();
    const load = wc.loadURL.bind(wc);
    wc.loadURL = async (url) => {
      await load(url);
      focus.steal(wc);
    };

    await manager.action("s", { action: "navigate", url: "https://next.example/" });

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });

  test("a page that reloads itself, redirects or retitles never keeps focus", async () => {
    const { focus, wc } = await shownTab();
    wc.emit("did-start-loading");
    focus.steal(wc);
    wc.emit("did-navigate");
    wc.emit("page-title-updated", {}, "Rebuilt");
    wc.emit("page-favicon-updated", {}, ["https://app.example/favicon.ico"]);
    wc.emit("did-stop-loading");

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });

  test("a failed load does not focus the page", async () => {
    const { focus, wc } = await shownTab();
    wc.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://gone.example/", true);

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });

  test("clicking into the page keeps focus there", async () => {
    const { manager, focus, wc } = await shownTab();
    manager.noteHumanInputFromWebContents(wc, "pointerdown");
    focus.steal(wc);

    expect(focus.inCockpit()).toBe(false);
    expect(focus.calls.cockpit).toBe(0);
  });

  test("a click reported after the focus it caused takes focus back into the page", async () => {
    const { manager, focus, wc } = await shownTab();
    focus.steal(wc);
    expect(focus.inCockpit()).toBe(true);

    manager.noteHumanInputFromWebContents(wc, "pointerdown");

    expect(focus.calls.page).toBe(1);
  });

  test("a scroll or a late click does not pull focus back into the page", async () => {
    const { manager, focus, wc, tick } = await shownTab();
    focus.steal(wc);
    manager.noteHumanInputFromWebContents(wc, "wheel");
    tick(1_000);
    manager.noteHumanInputFromWebContents(wc, "pointerdown");

    expect(focus.inCockpit()).toBe(true);
    expect(focus.calls.page).toBe(0);
  });
});
