const { expect, test } = require("bun:test");
const { devMenuItem, pairBootedSimulators, registerDevPairing } = require("./pair-simulators");

const XCODE = "/Applications/Xcode.app/Contents/Developer";

const simctlList = (devices) => JSON.stringify({ devices });
const booted = (udid, name) => ({ udid, name, state: "Booted" });

function fakeRunner({ xcrunFound = true, devices = {}, withApp = [] } = {}) {
  const runs = [];
  const run = async (file, args, options = {}) => {
    runs.push({ command: [file, ...args].join(" "), developerDir: options.env?.DEVELOPER_DIR });
    if (args[0] === "--find") return { code: xcrunFound ? 0 : 72, stdout: "" };
    if (args[1] === "list") return { code: 0, stdout: simctlList(devices) };
    if (args[1] === "get_app_container") return { code: withApp.includes(args[2]) ? 0 : 1, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { run, runs };
}

function fakeCockpit({ spends = true } = {}) {
  const calls = [];
  let pending = false;
  let minted = 0;
  return {
    calls,
    cockpit: {
      mint: async () => {
        minted += 1;
        pending = true;
        calls.push("mint");
        return { code: `1000000${minted}` };
      },
      pending: async () => {
        const answer = pending;
        if (spends) pending = false;
        return answer;
      },
      cancel: async () => {
        pending = false;
        calls.push("cancel");
      },
    },
  };
}

const base = { port: 62051, env: {}, exists: (file) => file === `${XCODE}/usr/bin/simctl`, list: () => ["Xcode.app"], wait: async () => {} };

test("each booted iPhone or iPad with Telar is relaunched with its own pairing link, under the Xcode in Applications", async () => {
  const { run, runs } = fakeRunner({
    xcrunFound: false,
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [booted("PHONE", "Telar iPhone"), booted("PAD", "Telar iPad"), booted("BARE", "Spare"), { udid: "OFF", name: "Off", state: "Shutdown" }],
      "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [booted("WATCH", "Watch")],
    },
    withApp: ["PHONE", "PAD", "WATCH"],
  });
  const { cockpit, calls } = fakeCockpit();

  const result = await pairBootedSimulators({ ...base, run, cockpit });

  expect(result).toEqual({ paired: ["Telar iPhone", "Telar iPad"], failed: [] });
  expect(calls).toEqual(["mint", "mint"]);
  const launched = runs.filter((entry) => entry.command.includes("simctl launch"));
  expect(launched.map((entry) => entry.command)).toEqual([
    "xcrun simctl launch --terminate-running-process PHONE io.github.novarix.telar -addHostLink http://localhost:62051/pair#token=10000001",
    "xcrun simctl launch --terminate-running-process PAD io.github.novarix.telar -addHostLink http://localhost:62051/pair#token=10000002",
  ]);
  expect(runs.filter((entry) => entry.command.startsWith("xcrun simctl")).every((entry) => entry.developerDir === XCODE)).toBe(true);
});

test("a code no simulator spends is withdrawn and that simulator is reported unpaired", async () => {
  const { run } = fakeRunner({ devices: { "iOS-26-0": [booted("PAD", "Telar iPad")] }, withApp: ["PAD"] });
  const { cockpit, calls } = fakeCockpit({ spends: false });

  const result = await pairBootedSimulators({ ...base, run, cockpit, timeoutMs: 1_500 });

  expect(result).toEqual({ paired: [], failed: ["Telar iPad"] });
  expect(calls).toEqual(["mint", "cancel"]);
});

test("with no booted simulator that has Telar, no code is minted", async () => {
  const { run, runs } = fakeRunner({ devices: { "iOS-26-0": [booted("BARE", "Spare")] } });
  const { cockpit, calls } = fakeCockpit();

  const result = await pairBootedSimulators({ ...base, run, cockpit });

  expect(result.error).toBe("No booted simulator has Telar installed.");
  expect(calls).toEqual([]);
  expect(runs.some((entry) => entry.command.includes("simctl launch"))).toBe(false);
});

test("a release build registers neither the verb nor the menu item; a dev build registers both", async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const appUrl = "http://127.0.0.1:62051/";
  const pair = async ({ port }) => ({ paired: [`port ${port}`], failed: [] });

  expect(registerDevPairing({ dev: false, appUrl, hostToken: "tlr_x", ipcMain, pair })).toBe(false);
  expect(handlers.has("telar:dev:pair-simulators")).toBe(false);
  expect(devMenuItem()).toBeNull();

  const notices = [];
  expect(registerDevPairing({ dev: true, appUrl, hostToken: "tlr_x", ipcMain, notify: (body) => notices.push(body), pair })).toBe(true);
  expect(await handlers.get("telar:dev:pair-simulators")()).toEqual({ paired: ["port 62051"], failed: [], message: "Paired port 62051." });
  expect(devMenuItem().label).toBe("Pair Booted Simulators");
});
