const { describe, expect, test } = require("bun:test");
const {
  DESKTOP_NOTICE, DESKTOP_APPROVE, DESKTOP_APPROVED, DESKTOP_DISMISS,
  parseNotice, routeOf, shouldNotifyDesktop, createDesktopNotifier,
} = require("./desktop-notifications");

const crypto = require("node:crypto");

const alertId = (sessionId) => crypto.createHash("sha256").update(sessionId).digest("hex");

class FakeNotification {
  static made = [];
  static removed = [];
  static remove(id) {
    FakeNotification.removed.push(id);
  }
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.shown = false;
    this.closed = false;
    FakeNotification.made.push(this);
  }
  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }
  show() {
    this.shown = true;
  }
  close() {
    this.closed = true;
    this.handlers.close?.({});
  }
}

function harness(context = {}, enabled = () => true) {
  FakeNotification.made = [];
  FakeNotification.removed = [];
  const sent = [];
  const opened = [];
  const notifier = createDesktopNotifier({
    Notification: FakeNotification,
    send: (message) => sent.push(message),
    context: () => context,
    open: (route) => opened.push(route),
    chime: { options: () => ({ silent: true }), shown() {} },
    enabled,
  });
  return { notifier, sent, opened };
}

const notice = (patch = {}) => ({
  type: DESKTOP_NOTICE, kind: "blocked", sessionId: "s1", title: "Fix the build",
  body: "A session needs your input or approval.", path: "/projects/p1/sessions/s1",
  id: alertId(patch.sessionId ?? "s1"), ...patch,
});

describe("the channel's contract", () => {
  test("both halves spell the message types the same", async () => {
    const server = await import("../../../engine/src/domains/push/desktop.ts");
    for (const [name, value] of Object.entries({ DESKTOP_NOTICE, DESKTOP_APPROVE, DESKTOP_APPROVED, DESKTOP_DISMISS })) {
      expect(server[name]).toBe(value);
    }
  });

  test("a notice must be well formed, and its path must stay inside the app", () => {
    expect(parseNotice(notice())).toMatchObject({ sessionId: "s1", path: "/projects/p1/sessions/s1" });
    for (const bad of [
      null, "notice", { ...notice(), type: "other" }, notice({ kind: "exploded" }), notice({ sessionId: "" }),
      notice({ title: "x".repeat(161) }), notice({ path: "https://evil.example" }), notice({ path: "//evil.example" }),
      notice({ path: "/\\evil.example" }), notice({ request: 7 }), notice({ id: "x" }), { ...notice(), id: undefined },
    ]) expect(parseNotice(bad)).toBeNull();
  });
});

describe("shouldNotifyDesktop", () => {
  test("skips the session on screen in the focused window, and only that", () => {
    const n = { path: "/projects/p1/sessions/s1" };
    expect(shouldNotifyDesktop(n, { focused: true, viewingPath: "/projects/p1/sessions/s1" })).toBe(false);
    expect(shouldNotifyDesktop(n, { focused: false, viewingPath: "/projects/p1/sessions/s1" })).toBe(true);
    expect(shouldNotifyDesktop(n, { focused: true, viewingPath: "/projects/p1/sessions/s2" })).toBe(true);
    expect(shouldNotifyDesktop(n)).toBe(true);
  });

  test("the viewing path is the window's route", () => {
    expect(routeOf("http://127.0.0.1:3000/projects/p1/sessions/s1?panel=diff")).toBe("/projects/p1/sessions/s1");
    expect(routeOf("not a url")).toBeNull();
  });
});

describe("the banner and its actions", () => {
  test("a plain notice shows title and body with Open only; a click opens its session", () => {
    const { notifier, opened, sent } = harness();
    notifier.handleServerMessage(notice());
    const [banner] = FakeNotification.made;
    expect(banner.shown).toBe(true);
    expect(banner.options).toEqual({ id: alertId("s1"), title: "Fix the build", body: "A session needs your input or approval.", silent: true, actions: [{ type: "button", text: "Open" }] });
    banner.handlers.click();
    expect(opened).toEqual(["/projects/p1/sessions/s1"]);
    expect(sent).toEqual([]);
  });

  test("nothing is shown while desktop notifications are off, and the next notice shows once they are on", () => {
    let on = false;
    const { notifier } = harness({}, () => on);
    notifier.handleServerMessage(notice());
    expect(FakeNotification.made).toHaveLength(0);
    on = true;
    notifier.handleServerMessage(notice());
    expect(FakeNotification.made).toHaveLength(1);
  });

  test("nothing is shown for the session already on screen", () => {
    const { notifier } = harness({ focused: true, viewingPath: "/projects/p1/sessions/s1" });
    notifier.handleServerMessage(notice());
    expect(FakeNotification.made).toHaveLength(0);
  });

  test("Approve sends exactly the request this banner carried, with its session", () => {
    const { notifier, sent, opened } = harness();
    notifier.handleServerMessage(notice({ request: "r1" }));
    const [banner] = FakeNotification.made;
    expect(banner.options.actions.map((a) => a.text)).toEqual(["Approve", "Open"]);
    banner.handlers.action({ actionIndex: 0 });
    expect(sent).toEqual([{ type: DESKTOP_APPROVE, sessionId: "s1", requestId: "r1" }]);
    expect(opened).toEqual([]);

    notifier.handleServerMessage({ type: DESKTOP_APPROVED, sessionId: "s1", requestId: "r1", ok: true });
    expect(opened).toEqual([]);
  });

  test("an Approve that does not land opens the session instead", () => {
    const { notifier, opened } = harness();
    notifier.handleServerMessage(notice({ request: "r1" }));
    FakeNotification.made[0].handlers.action({ actionIndex: 0 });
    notifier.handleServerMessage({ type: DESKTOP_APPROVED, sessionId: "s1", requestId: "r1", ok: false });
    expect(opened).toEqual(["/projects/p1/sessions/s1"]);

    notifier.handleServerMessage({ type: DESKTOP_APPROVED, sessionId: "s9", requestId: "r9", ok: false });
    expect(opened).toHaveLength(1);
  });

  test("Open, and the legacy index argument, both open without approving", () => {
    const { notifier, sent, opened } = harness();
    notifier.handleServerMessage(notice({ request: "r1" }));
    FakeNotification.made[0].handlers.action({ actionIndex: 1 });
    notifier.handleServerMessage(notice({ sessionId: "s2", path: "/main" }));
    FakeNotification.made[1].handlers.action(undefined, 0);
    expect(sent).toEqual([]);
    expect(opened).toEqual(["/projects/p1/sessions/s1", "/main"]);
  });

  test("a newer notice for the same session replaces the old banner, so a stale Approve is gone", () => {
    const { notifier } = harness();
    notifier.handleServerMessage(notice({ request: "r1" }));
    notifier.handleServerMessage(notice({ kind: "finished", body: "A session finished. Its result is ready to review." }));
    expect(FakeNotification.made[0].closed).toBe(true);
    expect(notifier.liveCount()).toBe(1);
  });

  test("the banner is posted under the alert id every device shares, and a dismiss removes that id even after the shell forgot it", async () => {
    const server = await import("../../../engine/src/domains/push/push.ts");
    expect(server.alertId("s1")).toBe(alertId("s1"));
    const { notifier } = harness();
    notifier.handleServerMessage(notice());
    expect(FakeNotification.made[0].options.id).toBe(alertId("s1"));

    const restarted = harness().notifier;
    restarted.handleServerMessage({ type: DESKTOP_DISMISS, sessionId: "s1", id: alertId("s1") });
    restarted.handleServerMessage({ type: DESKTOP_DISMISS, sessionId: "s2", id: "not-an-id" });
    expect(FakeNotification.removed).toEqual([alertId("s1")]);
  });
});

describe("read elsewhere", () => {
  test("a dismiss closes that session's banner and no other, and junk is ignored", () => {
    const { notifier, opened } = harness();
    notifier.handleServerMessage(notice());
    notifier.handleServerMessage(notice({ sessionId: "s2", path: "/projects/p1/sessions/s2" }));
    const [first, second] = FakeNotification.made;
    for (const junk of [{ type: DESKTOP_DISMISS }, { type: DESKTOP_DISMISS, sessionId: 7 }, { type: DESKTOP_DISMISS, sessionId: "x".repeat(300) }]) notifier.handleServerMessage(junk);
    expect(notifier.liveCount()).toBe(2);
    notifier.handleServerMessage({ type: DESKTOP_DISMISS, sessionId: "s1" });
    expect([first.closed, second.closed]).toEqual([true, false]);
    expect(notifier.liveCount()).toBe(1);

    expect(opened).toEqual([]);
    notifier.handleServerMessage({ type: DESKTOP_DISMISS, sessionId: "never-shown" });
    expect(notifier.liveCount()).toBe(1);
  });
});
