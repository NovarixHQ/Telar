const { beforeEach, describe, expect, test } = require("bun:test");
const { electron, resetElectron } = require("../../test/fake-electron");
const { readFrontContext } = require("./front-context");

const script = (out) => (_cmd, _args, _options, done) => done(null, JSON.stringify(out));
const source = (id, name, png) => ({ id, name, thumbnail: { isEmpty: () => false, toDataURL: () => png } });

beforeEach(() => resetElectron());

describe("reading the app in front", () => {
  test("without permissions it still names the app, with nothing attached", async () => {
    electron.desktopCapturer.sources = [source("window:9:0", "Plan", "data:image/png;base64,AA==")];
    const context = await readFrontContext({ runScript: script({ app: "Notes", title: "", selection: "" }) });
    expect(context).toEqual({ app: "Notes", title: "", selection: "", screenshot: null, permissions: { accessibility: false, screen: false } });
  });

  test("with both grants it attaches the front window, skipping Telar's own, and the selection", async () => {
    electron.desktopCapturer.sources = [
      source("window:1:0", "Telar", "data:image/png;base64,TELAR"),
      source("window:7:0", "Other", "data:image/png;base64,OTHER"),
      source("window:9:0", "Plan", "data:image/png;base64,PLAN"),
    ];
    const context = await readFrontContext({
      ownSourceIds: ["window:1:0"],
      granted: { accessibility: true, screen: true },
      runScript: script({ app: "Notes", title: "Plan", selection: "two lines" }),
    });
    expect(context.screenshot).toBe("data:image/png;base64,PLAN");
    expect(context.selection).toBe("two lines");
  });

  test("a failed script leaves the composer with no context rather than failing", async () => {
    const context = await readFrontContext({ runScript: (_c, _a, _o, done) => done(new Error("timeout"), "") });
    expect(context).toMatchObject({ app: "", selection: "", screenshot: null });
  });
});
