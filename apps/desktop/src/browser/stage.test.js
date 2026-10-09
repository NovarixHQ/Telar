const { describe, expect, test } = require("bun:test");
const { makeHarness, textOf } = require("../../test/browser-manager-harness");
const { managerForScope } = require("./browser-manager");

async function popped(options = {}) {
  const harness = makeHarness(options);
  const { manager } = harness;
  await manager.createTab("s", "https://one.example/");
  await manager.createTab("s", "https://two.example/", "human");
  manager.setBounds("s", { x: 0, y: 0, width: 900, height: 600 });
  await manager.setVisible("s", true);
  await manager.action("s", { action: "pop-out" });
  const win = harness.stageWindows.at(-1);
  const stage = manager.poppedStages.get("s");
  const show = async (bounds = { x: 0, y: 80, width: 800, height: 500 }) => {
    manager.setBounds("s", bounds, win.webContents);
    await manager.setVisible("s", true, win.webContents);
    await manager.applyGeometry(manager.activeTab("s", stage));
  };
  const [panelTab, windowTab] = manager.scopeTabs("s");
  return { ...harness, win, stage, show, panelTab, windowTab, active: () => manager.activeTab("s", stage) };
}

const titles = (state) => state.tabs.map((tab) => tab.url);

describe("popping a tab out into its own window", () => {
  test("only the chosen tab moves, as the same live page — nothing is recreated or reloaded", async () => {
    const { children, manager, panelTab, views, win, windowTab } = await popped();
    expect(views).toHaveLength(2);
    expect([...win.children]).toEqual([windowTab.view]);
    expect(children.has(panelTab.view)).toBe(true);
    expect(children.has(windowTab.view)).toBe(false);
    expect(views.flatMap((view) => view.webContents.reloads)).toEqual([]);
    expect(manager.state("s").popped).toBe(true);
  });

  test("a tab chosen by index moves instead of the current one", async () => {
    const { manager, stageWindows } = makeHarness();
    await manager.createTab("s", "https://one.example/");
    await manager.createTab("s", "https://two.example/", "human");
    await manager.action("s", { action: "pop-out", index: 0 });
    expect(stageWindows[0].children.has(manager.scopeTabs("s")[0].view)).toBe(true);
    expect(manager.state("s").tabs.map((tab) => tab.url)).toEqual(["https://two.example/"]);
  });

  test("the window is opened for this session's browser and its project", async () => {
    const { win } = await popped();
    expect(win.options).toEqual({ scope: "s", project: "none" });
  });

  test("the panel and the window each see only their own tabs, with the session-wide index", async () => {
    const { manager, win } = await popped();
    expect(titles(manager.state("s"))).toEqual(["https://one.example/"]);
    expect(manager.state("s").tabs[0]).toMatchObject({ index: 0, active: true });
    const windowed = manager.state("s", win.webContents);
    expect(titles(windowed)).toEqual(["https://two.example/"]);
    expect(windowed.tabs[0]).toMatchObject({ index: 1, active: true });
  });

  test("each window is pushed its own view of the state", async () => {
    const { manager, messages, win } = await popped();
    manager.emitState("s");
    const pushed = (list) => list.filter((message) => message.channel === "telar:browser:state" && message.payload.scopeKey === "s").at(-1)?.payload;
    expect(titles(pushed(win.messages))).toEqual(["https://two.example/"]);
    expect(titles(pushed(messages))).toEqual(["https://one.example/"]);
    expect(pushed(messages).popped).toBe(true);
  });

  test("the window's own host rect places its page, and fit follows that window", async () => {
    const { active, manager, show, win } = await popped();
    await show();
    expect(active().view.visible).toBe(true);
    expect(active().view.bounds).toEqual({ x: 0, y: 80, width: 800, height: 500 });
    expect(manager.state("s", win.webContents).tabs[0].viewport).toMatchObject({ width: 800, height: 500, mode: "fit" });
  });

  test("the window's zoom scales its page's place, not the cockpit's", async () => {
    const { active, setCockpitZoom, show, win } = await popped();
    setCockpitZoom(2);
    win.zoomFactor = 1.5;
    await show({ x: 0, y: 40, width: 400, height: 300 });
    expect(active().view.bounds).toEqual({ x: 0, y: 60, width: 600, height: 450 });
  });

  test("the panel keeps showing and placing its own tab while the window is open", async () => {
    const { manager, panelTab, show, windowTab } = await popped();
    await show();
    manager.setBounds("s", { x: 0, y: 0, width: 300, height: 200 });
    await manager.setVisible("s", true);
    await manager.applyGeometry(panelTab);
    expect(panelTab.view.visible).toBe(true);
    expect(panelTab.view.bounds).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(windowTab.view.bounds).toEqual({ x: 0, y: 80, width: 800, height: 500 });

    await manager.setVisible("s", false);
    expect(panelTab.view.visible).toBe(false);
    expect(windowTab.view.visible).toBe(true);
  });

  test("a new tab opens where the person asked for it", async () => {
    const { manager, win } = await popped();
    await manager.action("s", { action: "new", url: "https://panel.example/" });
    await manager.action("s", { action: "new", url: "https://window.example/" }, win.webContents);
    expect(titles(manager.state("s"))).toEqual(["https://one.example/", "https://panel.example/"]);
    expect(titles(manager.state("s", win.webContents))).toEqual(["https://two.example/", "https://window.example/"]);
    expect(win.children.size).toBe(2);
  });

  test("toolbar actions from the window act on the window's page", async () => {
    const { manager, panelTab, win, windowTab } = await popped();
    await manager.action("s", { action: "reload" }, win.webContents);
    expect(windowTab.view.webContents.reloads).toHaveLength(1);
    expect(panelTab.view.webContents.reloads).toHaveLength(0);
  });

  test("selecting a tab makes it current only where it lives", async () => {
    const { manager, win } = await popped();
    await manager.action("s", { action: "new", url: "https://window.example/" }, win.webContents);
    await manager.action("s", { action: "select", index: 1 }, win.webContents);
    expect(manager.state("s", win.webContents).tabs.find((tab) => tab.active).url).toBe("https://two.example/");
    expect(manager.state("s").tabs.find((tab) => tab.active).url).toBe("https://one.example/");
  });

  test("an agent cannot open a window over the person's screen", async () => {
    const harness = makeHarness();
    await harness.manager.createTab("s", "https://one.example/");
    await expect(harness.manager.performAction("s", { action: "pop-out" })).rejects.toThrow("Unknown desktop browser action");
    expect(harness.stageWindows).toHaveLength(0);
  });

  test("popping out another tab joins the window it already has", async () => {
    const { manager, stageWindows, win } = await popped();
    await manager.action("s", { action: "pop-out" });
    expect(stageWindows).toHaveLength(1);
    expect(win.children.size).toBe(2);
    expect(manager.state("s").tabs).toEqual([]);
    await manager.action("s", { action: "show-window" });
    expect(win.focused).toBe(1);
  });
});

describe("the agent keeps driving tabs in either place", () => {
  test("it lists every tab in the session, wherever it lives", async () => {
    const { manager } = await popped();
    const listed = textOf(await manager.callTool("s", "browser_tabs", { action: "list" }));
    expect(listed).toContain("https://one.example/");
    expect(listed).toContain("https://two.example/");
  });

  test("snapshot, a click at coordinates and a screenshot all act on the windowed page", async () => {
    const { active, manager, show } = await popped();
    await manager.resizeTab(active(), { preset: "default" });
    await show({ x: 0, y: 0, width: 640, height: 400 });
    await manager.focusAgentTab("s", 1);

    const snapshot = await manager.callTool("s", "browser_snapshot", {});
    expect(snapshot.isError).toBeFalsy();
    expect(textOf(snapshot)).toContain("Count 0");

    const clicked = await manager.callTool("s", "browser_click", { x: 100, y: 60 });
    expect(clicked.isError).toBeFalsy();
    const pressed = active().view.webContents.debugger.commands.find((entry) => entry.params?.type === "mousePressed");
    expect(pressed.params).toMatchObject({ x: 50, y: 30 });

    const shot = await manager.callTool("s", "browser_take_screenshot", {});
    expect(shot.content[0]).toMatchObject({ type: "image", data: "cG5n" });
    expect(active().view.webContents.captures).toEqual([]);
  });

  test("its tab keeps its identity when it moves between the panel and the window", async () => {
    const { manager, win, windowTab } = await popped();
    await manager.focusAgentTab("s", 1);
    win.close();
    expect(manager.peekTarget("s", {})).toBe(windowTab);
    expect(windowTab.view.webContents.reloads).toEqual([]);
  });

  test("a popped scope wins the agent's routing like a shown one", async () => {
    const owner = await popped();
    const other = makeHarness();
    await other.manager.createTab("s", "https://elsewhere.example/");
    other.manager.setBounds("s", { x: 0, y: 0, width: 400, height: 300 });
    expect(managerForScope([owner.manager, other.manager], "s", other.manager)).toBe(owner.manager);
  });

  test("a page taking focus in its own window is not pulled back to the cockpit", async () => {
    const { manager, window, windowTab } = await popped();
    windowTab.lastHumanInputAt = undefined;
    const wc = windowTab.view.webContents;
    wc.isFocused = () => true;
    wc.emit("focus");
    expect(window.webContents.focused).toBe(0);

    await manager.setVisible("s", false);
    await manager.action("s", { action: "bring-back" });
    wc.emit("focus");
    expect(window.webContents.focused).toBe(1);
  });

  test("the page's context menu opens over its own window", async () => {
    const { active, menus, show, win } = await popped();
    await show();
    active().view.webContents.emit("context-menu", {}, { x: 1, y: 1, pageURL: "https://two.example/" });
    expect(menus.at(-1).window).toBe(win);
  });
});

describe("bringing it back", () => {
  test("Bring back returns the window's pages to the panel, current, and closes the window", async () => {
    const { children, manager, views, win, windowTab } = await popped();
    await manager.action("s", { action: "bring-back" }, win.webContents);
    expect(win.isDestroyed()).toBe(true);
    expect(views.every((view) => children.has(view))).toBe(true);
    expect(manager.state("s").popped).toBe(false);
    expect(manager.activeTab("s")).toBe(windowTab);

    manager.setBounds("s", { x: 0, y: 0, width: 900, height: 600 });
    await manager.setVisible("s", true);
    await manager.applyGeometry(windowTab);
    expect(windowTab.view.bounds).toEqual({ x: 0, y: 0, width: 900, height: 600 });
  });

  test("closing the window returns its tabs to the panel and leaves the panel's own", async () => {
    const { children, manager, views, win } = await popped();
    await manager.action("s", { action: "new", url: "https://window.example/" }, win.webContents);
    win.close();
    expect(views.every((view) => children.has(view))).toBe(true);
    expect(win.children.size).toBe(0);
    expect(manager.state("s").popped).toBe(false);
    expect(titles(manager.state("s"))).toEqual(["https://one.example/", "https://two.example/", "https://window.example/"]);
  });

  test("closing the window's last tab closes the window and keeps the panel's tabs", async () => {
    const { manager, panelTab, win } = await popped();
    manager.closeTab("s", 1);
    expect(win.isDestroyed()).toBe(true);
    expect(manager.isPopped("s")).toBe(false);
    expect(manager.activeTab("s")).toBe(panelTab);
  });

  test("closing the session's last tab ends the browser and closes the window, in one push the panel can act on", async () => {
    const { manager, messages, win } = await popped();
    manager.closeTab("s", 0);
    const before = messages.length;
    manager.closeTab("s", 0);
    expect(win.isDestroyed()).toBe(true);
    const pushes = messages.slice(before).filter((message) => message.channel === "telar:browser:state");
    expect(pushes.map((message) => Boolean(message.payload.ended))).toEqual([true]);
  });

  test("closing the session's Browser tab closes its window and its pages", async () => {
    const { manager, win } = await popped();
    manager.releaseScope("s", true, { closedByPerson: true });
    expect(win.isDestroyed()).toBe(true);
    expect(manager.scopeTabs("s").every((tab) => !tab.view)).toBe(true);
  });

  test("closing the cockpit closes its pop-outs", async () => {
    const { manager, win } = await popped();
    manager.destroy();
    expect(win.isDestroyed()).toBe(true);
  });

  test("a window the person closes is reported closed, one the cockpit takes down is not", async () => {
    const closed = [];
    const first = await popped({ onStageClosed: (scope) => closed.push(scope) });
    first.win.close();
    expect(closed).toEqual(["s"]);

    const second = await popped({ onStageClosed: (scope) => closed.push(scope) });
    second.manager.destroy();
    expect(closed).toEqual(["s"]);
  });
});

describe("a popped tab stays alive", () => {
  test("the live-page budget never puts a windowed page to sleep", async () => {
    const { manager, windowTab } = await popped({ maxLiveViews: 3 });
    for (const url of ["https://a.example/", "https://b.example/", "https://c.example/"]) await manager.createTab("other", url, "human");
    expect(windowTab.view).toBeTruthy();
  });

  test("letting go of the panel puts its pages to sleep but leaves the window's alone", async () => {
    const { manager, panelTab, win, windowTab } = await popped();
    manager.releaseScope("s");
    expect(win.isDestroyed()).toBe(false);
    expect(windowTab.view).toBeTruthy();
    expect(panelTab.view).toBeNull();
  });

  test("a page woken while popped wakes in the window", async () => {
    const { manager, win, windowTab } = await popped();
    manager.hibernateTab(windowTab);
    expect(win.children.size).toBe(0);
    await manager.wakeTab(windowTab);
    expect(win.children.has(windowTab.view)).toBe(true);
  });

  test("tabs left in the window reopen there at launch", async () => {
    let saved = null;
    const tabStore = { load: () => saved, save: (document) => { saved = document; }, flushSync: (document) => { saved = document; } };
    const first = await popped({ tabStore });
    first.manager.persistSync();
    const second = makeHarness({ tabStore });
    second.manager.popOut("s", { restore: true });
    const win = second.stageWindows[0];
    expect(titles(second.manager.state("s", win.webContents))).toEqual(["https://two.example/"]);
    expect(titles(second.manager.state("s"))).toEqual(["https://one.example/"]);
  });
});

describe("picture in picture", () => {
  test("the panel's button floats its current page in a small on-top window", async () => {
    const { manager, stageWindows } = makeHarness();
    await manager.createTab("s", "https://one.example/");
    await manager.createTab("s", "https://two.example/", "human");
    await manager.action("s", { action: "float", on: true, index: 1 });
    const win = stageWindows[0];
    expect(win.compact).toBe(true);
    expect(manager.state("s")).toMatchObject({ popped: true, compact: true });
    expect(titles(manager.state("s", win.webContents))).toEqual(["https://two.example/"]);
    expect(titles(manager.state("s"))).toEqual(["https://one.example/"]);
  });

  test("closing it puts the page back in the panel as the current tab", async () => {
    const { manager, stageWindows } = makeHarness();
    await manager.createTab("s", "https://one.example/");
    await manager.action("s", { action: "float", on: true });
    const win = stageWindows[0];
    const [tab] = manager.scopeTabs("s");
    win.close();
    expect(manager.state("s")).toMatchObject({ popped: false });
    expect(manager.activeTab("s")).toBe(tab);
    expect(win.children.size).toBe(0);
  });

  test("the window's own control makes it compact and says so to the window and the panel", async () => {
    const { manager, messages, win } = await popped();
    await manager.action("s", { action: "float" }, win.webContents);
    expect(win.compact).toBe(true);
    expect(manager.state("s").compact).toBe(true);
    const last = (list) => list.filter((message) => message.channel === "telar:browser:state").at(-1).payload;
    expect(last(win.messages).compact).toBe(true);
    expect(last(messages).compact).toBe(true);

    await manager.action("s", { action: "float" }, win.webContents);
    expect(manager.state("s").compact).toBe(false);
    expect(win.children.size).toBe(1);
  });

  test("turning floating off for a browser in the panel opens no window", async () => {
    const { manager, stageWindows } = makeHarness();
    await manager.createTab("s", "https://one.example/");
    await manager.action("s", { action: "float", on: false });
    expect(stageWindows).toHaveLength(0);
  });

  test("the agent keeps working in a floating window", async () => {
    const { active, manager, show, win } = await popped();
    await manager.action("s", { action: "float", on: true }, win.webContents);
    await show({ x: 0, y: 28, width: 480, height: 270 });
    await manager.focusAgentTab("s", 1);
    expect((await manager.callTool("s", "browser_snapshot", {})).isError).toBeFalsy();
    const shot = await manager.callTool("s", "browser_take_screenshot", {});
    expect(shot.content[0]).toMatchObject({ type: "image" });
    expect(active().view.visible).toBe(true);
  });

  test("the agent cannot float a window over the person's screen", async () => {
    const { manager } = await popped();
    await expect(manager.performAction("s", { action: "float", on: true })).rejects.toThrow("Unknown desktop browser action");
  });
});
