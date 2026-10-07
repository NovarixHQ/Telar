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
  const show = async (bounds = { x: 0, y: 80, width: 800, height: 500 }) => {
    manager.setBounds("s", bounds, win.webContents);
    await manager.setVisible("s", true, win.webContents);
    await manager.applyGeometry(manager.activeTab("s"));
  };
  return { ...harness, win, show, active: () => manager.activeTab("s") };
}

describe("popping a browser out into its own window", () => {
  test("the same live pages move into the window — nothing is recreated or reloaded", async () => {
    const { children, manager, views, win } = await popped();
    expect(views).toHaveLength(2);
    expect([...win.children]).toEqual(views);
    expect(views.some((view) => children.has(view))).toBe(false);
    expect(views.map((view) => view.webContents.url)).toEqual(["https://one.example/", "https://two.example/"]);
    expect(views.flatMap((view) => view.webContents.reloads)).toEqual([]);
    expect(manager.state("s").popped).toBe(true);
  });

  test("the window is opened for this session's browser and its project", async () => {
    const { win } = await popped();
    expect(win.options).toEqual({ scope: "s", project: "none" });
  });

  test("the window's own host rect places the page, and fit follows that window", async () => {
    const { active, manager, show, views } = await popped();
    await show();
    const view = views.find((candidate) => candidate === active().view);
    expect(view.visible).toBe(true);
    expect(view.bounds).toEqual({ x: 0, y: 80, width: 800, height: 500 });
    expect(manager.state("s").tabs.find((tab) => tab.active).viewport).toMatchObject({ width: 800, height: 500, mode: "fit" });
  });

  test("the window's zoom scales the page's place, not the cockpit's", async () => {
    const { active, setCockpitZoom, show, win } = await popped();
    setCockpitZoom(2);
    win.zoomFactor = 1.5;
    await show({ x: 0, y: 40, width: 400, height: 300 });
    expect(active().view.bounds).toEqual({ x: 0, y: 60, width: 600, height: 450 });
  });

  test("the panel can no longer show or move a popped browser", async () => {
    const { active, manager, show } = await popped();
    await show();
    await manager.setVisible("s", true);
    manager.setBounds("s", { x: 0, y: 0, width: 300, height: 200 });
    await manager.applyGeometry(active());
    expect(manager.visibleScopeKey).toBeNull();
    expect(active().view.bounds).toEqual({ x: 0, y: 80, width: 800, height: 500 });

    await manager.setVisible("s", false);
    expect(active().view.visible).toBe(true);
  });

  test("its state reaches the window as well as the cockpit", async () => {
    const { manager, messages, win } = await popped();
    manager.emitState("s");
    const pushed = (list) => list.filter((message) => message.channel === "telar:browser:state" && message.payload.scopeKey === "s").at(-1)?.payload;
    expect(pushed(win.messages)).toMatchObject({ popped: true });
    expect(pushed(messages)).toMatchObject({ popped: true });
  });

  test("an agent cannot open a window over the person's screen", async () => {
    const harness = makeHarness();
    await harness.manager.createTab("s", "https://one.example/");
    await expect(harness.manager.performAction("s", { action: "pop-out" })).rejects.toThrow("Unknown desktop browser action");
    expect(harness.stageWindows).toHaveLength(0);
  });

  test("asking again shows the window it already has", async () => {
    const { manager, stageWindows, win } = await popped();
    await manager.action("s", { action: "pop-out" });
    await manager.action("s", { action: "show-window" });
    expect(stageWindows).toHaveLength(1);
    expect(win.focused).toBe(2);
  });
});

describe("the agent keeps driving a popped browser", () => {
  test("snapshot, a click at coordinates and a screenshot all act on the popped page", async () => {
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

  test("a popped scope wins the agent's routing like a shown one", async () => {
    const owner = await popped();
    const other = makeHarness();
    await other.manager.createTab("s", "https://elsewhere.example/");
    other.manager.setBounds("s", { x: 0, y: 0, width: 400, height: 300 });
    expect(managerForScope([owner.manager, other.manager], "s", other.manager)).toBe(owner.manager);
  });

  test("a page taking focus in its own window is not pulled back to the cockpit", async () => {
    const { manager, window } = await popped();
    const wc = manager.scopeTabs("s")[0].view.webContents;
    wc.isFocused = () => true;
    wc.emit("focus");
    expect(window.webContents.focused).toBe(0);

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
  test("Bring back puts the same pages back in the panel and closes the window", async () => {
    const { children, manager, views, win } = await popped();
    await manager.action("s", { action: "bring-back" });
    expect(win.isDestroyed()).toBe(true);
    expect(views.every((view) => children.has(view))).toBe(true);
    expect(manager.state("s").popped).toBe(false);
    expect(views).toHaveLength(2);

    manager.setBounds("s", { x: 0, y: 0, width: 900, height: 600 });
    await manager.setVisible("s", true);
    await manager.applyGeometry(manager.activeTab("s"));
    expect(manager.activeTab("s").view.bounds).toEqual({ x: 0, y: 0, width: 900, height: 600 });
  });

  test("closing the window brings it back too", async () => {
    const { children, manager, views, win } = await popped();
    win.close();
    expect(views.every((view) => children.has(view))).toBe(true);
    expect(win.children.size).toBe(0);
    expect(manager.state("s").popped).toBe(false);
  });

  test("closing its last tab ends the browser and closes the window, in one push the panel can act on", async () => {
    const { manager, messages, win } = await popped();
    manager.closeTab("s", 1);
    const before = messages.length;
    manager.closeTab("s", 0);
    expect(win.isDestroyed()).toBe(true);
    expect(manager.isPopped("s")).toBe(false);
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

describe("a popped browser stays alive", () => {
  test("the live-page budget never puts a popped page to sleep", async () => {
    const { manager } = await popped({ maxLiveViews: 3 });
    for (const url of ["https://a.example/", "https://b.example/", "https://c.example/"]) await manager.createTab("other", url, "human");
    expect(manager.scopeTabs("s").every((tab) => tab.view)).toBe(true);
    expect(manager.scopeTabs("other").filter((tab) => tab.view)).toHaveLength(1);
  });

  test("letting go of the scope without closing it leaves the window's pages alone", async () => {
    const { manager, win } = await popped();
    manager.releaseScope("s");
    expect(win.isDestroyed()).toBe(false);
    expect(manager.scopeTabs("s").every((tab) => tab.view)).toBe(true);
  });

  test("a page woken while popped wakes in the window", async () => {
    const { manager, win } = await popped();
    const tab = manager.scopeTabs("s")[0];
    manager.hibernateTab(tab);
    expect(win.children.size).toBe(1);
    await manager.wakeTab(tab);
    expect(win.children.has(tab.view)).toBe(true);
  });
});

describe("floating on top", () => {
  test("the window's own control makes it compact and says so to the window and the panel", async () => {
    const { manager, messages, win } = await popped();
    await manager.action("s", { action: "compact", on: true });
    expect(win.compact).toBe(true);
    expect(manager.state("s").compact).toBe(true);
    const last = (list) => list.filter((message) => message.channel === "telar:browser:state").at(-1).payload;
    expect(last(win.messages).compact).toBe(true);
    expect(last(messages).compact).toBe(true);

    await manager.action("s", { action: "compact", on: false });
    expect(manager.state("s").compact).toBe(false);
  });

  test("the agent keeps working in a floating window", async () => {
    const { active, manager, show } = await popped();
    await manager.action("s", { action: "compact", on: true });
    await show({ x: 0, y: 28, width: 480, height: 270 });
    await manager.focusAgentTab("s", 1);
    expect((await manager.callTool("s", "browser_snapshot", {})).isError).toBeFalsy();
    const shot = await manager.callTool("s", "browser_take_screenshot", {});
    expect(shot.content[0]).toMatchObject({ type: "image" });
    expect(active().view.visible).toBe(true);
  });

  test("only a browser in its own window can float, and the agent cannot make it", async () => {
    const harness = makeHarness();
    await harness.manager.createTab("s", "https://one.example/");
    await expect(harness.manager.action("s", { action: "compact", on: true })).rejects.toThrow("Only a browser in its own window");
    const { manager } = await popped();
    await expect(manager.performAction("s", { action: "compact", on: true })).rejects.toThrow("Unknown desktop browser action");
  });
});
