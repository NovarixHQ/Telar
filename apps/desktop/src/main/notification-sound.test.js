const { describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DEV_SOUNDS, SOUNDS, SOUND_FILES, createChime } = require("./notification-sound");
const { createDesktopNotifier, DESKTOP_NOTICE } = require("./desktop-notifications");

class FakeNotification {
  constructor(options) {
    this.options = options;
    this.handlers = {};
  }
  on(event, handler) {
    this.handlers[event] = handler;
    return this;
  }
  show() {
    if (FakeNotification.allowed) this.handlers.show?.();
  }
  close() {}
}

function show(packaged, kind = "finished", allowed = true) {
  FakeNotification.allowed = allowed;
  const made = [];
  const played = [];
  const notifier = createDesktopNotifier({
    Notification: class extends FakeNotification { constructor(o) { super(o); made.push(this); } },
    send() {}, context: () => ({}), open() {}, chime: createChime({ packaged, play: (file) => played.push(file) }),
  });
  notifier.handleServerMessage({
    type: DESKTOP_NOTICE, kind, id: "a".repeat(64), sessionId: "s1", title: "Fix the build",
    body: "A session finished. Its result is ready to review.", path: "/main", sound: "telar-hilo-done",
  });
  return { options: made[0].options, played };
}

const IOS_SOUNDS = path.join(__dirname, "..", "..", "..", "ios", "TelarMobile", "Sounds");

describe("a banner's sound", () => {
  test("packaged, macOS plays Felt's bundled .caf for the kind, whatever the notice names, and the shell plays nothing", () => {
    expect([show(true, "finished"), show(true, "blocked"), show(true, "failed")].map(({ options }) => options.sound)).toEqual([
      "telar-felt-done.caf", "telar-felt-needs.caf", "telar-felt-error.caf",
    ]);
    const { options, played } = show(true);
    expect(options.silent).toBeUndefined();
    expect(played).toEqual([]);
  });

  test("every sound a banner can name ships as a .caf the packaged app bundles", () => {
    for (const file of SOUND_FILES) expect(fs.existsSync(path.join(IOS_SOUNDS, file))).toBe(true);
  });

  test("in dev, the banner is silent and the shell plays the cockpit's copy", () => {
    const { options, played } = show(false, "blocked");
    expect(options).toMatchObject({ silent: true });
    expect(options.sound).toBeUndefined();
    expect(played).toEqual([path.join(DEV_SOUNDS, "telar-felt-needs.wav")]);
    for (const name of Object.values(SOUNDS)) expect(fs.existsSync(path.join(DEV_SOUNDS, `${name}.wav`))).toBe(true);
  });

  test("a banner macOS refuses to show makes no sound in dev", () => {
    expect(show(false, "finished", false).played).toEqual([]);
  });
});

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-sounds-"));
  const from = path.join(home, "Resources");
  fs.mkdirSync(from);
  for (const file of fs.readdirSync(IOS_SOUNDS).filter((name) => name.endsWith(".caf"))) fs.copyFileSync(path.join(IOS_SOUNDS, file), path.join(from, file));
  fs.writeFileSync(path.join(from, "unrelated.caf"), "x");
  return { from, home, to: path.join(home, "Library", "Sounds") };
}

function install({ from, home }, packaged = true) {
  const logs = [];
  createChime({ packaged, play() {} }).install({ from, home, log: (line) => logs.push(line) });
  return logs;
}

describe("installing the sounds into ~/Library/Sounds", () => {
  test("packaged, Felt's sounds land under the exact names the banner asks for, and nothing else does", () => {
    const locations = tempHome();
    expect(install(locations)).toEqual([]);
    expect(fs.readdirSync(locations.to).sort()).toEqual([...SOUND_FILES].sort());
    expect(fs.readFileSync(path.join(locations.to, "telar-felt-done.caf"))).toEqual(fs.readFileSync(path.join(locations.from, "telar-felt-done.caf")));
  });

  test("a changed or damaged sound is replaced, and the user's own sounds are left alone", () => {
    const locations = tempHome();
    fs.mkdirSync(locations.to, { recursive: true });
    fs.writeFileSync(path.join(locations.to, "Mine.aiff"), "mine");
    install(locations);
    fs.writeFileSync(path.join(locations.from, "telar-felt-needs.caf"), "a new take");
    fs.writeFileSync(path.join(locations.to, "telar-felt-error.caf"), "");
    install(locations);
    expect(fs.readFileSync(path.join(locations.to, "telar-felt-needs.caf"), "utf8")).toBe("a new take");
    expect(fs.readFileSync(path.join(locations.to, "telar-felt-error.caf"))).toEqual(fs.readFileSync(path.join(locations.from, "telar-felt-error.caf")));
    expect(fs.readFileSync(path.join(locations.to, "Mine.aiff"), "utf8")).toBe("mine");
    expect(fs.readdirSync(locations.to)).toHaveLength(4);
  });

  test("when the folder can't be written, it logs and the banner still names the sound", () => {
    const locations = tempHome();
    fs.mkdirSync(path.dirname(locations.to), { recursive: true });
    fs.writeFileSync(locations.to, "not a folder");
    expect(install(locations)).toHaveLength(1);
    expect(show(true, "failed").options.sound).toBe("telar-felt-error.caf");
  });

  test("in dev, nothing is installed", () => {
    const locations = tempHome();
    install(locations, false);
    expect(fs.existsSync(path.join(locations.home, "Library"))).toBe(false);
  });
});
