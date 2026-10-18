import { describe, expect, test } from "bun:test";
import { fakePty, fakeHost } from "../../../test/pty-fakes";
import type { ShellFrame } from "@telar/engine-client";
import { ShellHub } from "./shells";

function scene() {
  const world = fakeHost();
  const hub = new ShellHub(world.host);
  const frames: ShellFrame[] = [];
  return { ...world, hub, frames, send: (frame: ShellFrame) => void frames.push(frame) };
}

describe("a person's shell", () => {
  test("is listed with its session, and runs the engine opened are not", async () => {
    const { hub, host } = scene();
    const mine = await hub.open({ sessionId: "s1", cwd: undefined });
    await hub.open({ sessionId: "s2" });
    await host.open({ sessionId: "s1", origin: "run" }, { data() {}, ending() {} });

    expect(hub.list().map((terminal) => terminal.id)).toHaveLength(2);
    expect(hub.list("s1").map((terminal) => terminal.id)).toEqual([mine.id]);
  });

  test("starts without the engine's own store and tokens in its environment", async () => {
    const seen: Array<Record<string, string>> = [];
    const { host } = fakeHost({ spawn: (_file, _args, options) => (seen.push(options.env), fakePty()) });
    const previous = { home: process.env.TELAR_HOME, token: process.env.TELAR_HOST_TOKEN };
    process.env.TELAR_HOME = "/live/store";
    process.env.TELAR_HOST_TOKEN = "secret";
    try {
      await new ShellHub(host).open({});
    } finally {
      for (const [key, value] of [["TELAR_HOME", previous.home], ["TELAR_HOST_TOKEN", previous.token]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(seen[0]).not.toHaveProperty("TELAR_HOME");
    expect(seen[0]).not.toHaveProperty("TELAR_HOST_TOKEN");
    expect(seen[0]).toHaveProperty("TERM_PROGRAM", "Telar");
  });

  test("follows from the start: replays what it printed before anyone listened, then goes live", async () => {
    const { hub, ptys, frames, send } = scene();
    const { id } = await hub.open({});
    ptys[0]!.emitData("one\r\n");
    ptys[0]!.emitData("two\r\n");
    hub.follow(id, 0, send);
    ptys[0]!.emitData("three\r\n");

    expect(frames).toEqual([
      { type: "data", data: "one\r\ntwo\r\n", cursor: 2 },
      { type: "data", data: "three\r\n", cursor: 3 },
    ]);
  });

  test("a follower that names its cursor gets only what it missed", async () => {
    const { hub, ptys, frames, send } = scene();
    const { id } = await hub.open({});
    ptys[0]!.emitData("one\r\n");
    ptys[0]!.emitData("two\r\n");
    hub.follow(id, 1, send);
    expect(frames).toEqual([{ type: "data", data: "two\r\n", cursor: 2 }]);
  });

  test("older output falls off a bounded replay without breaking cursors", async () => {
    const { hub, ptys, frames, send } = scene();
    const { id } = await hub.open({});
    const big = "x".repeat(400_000);
    ptys[0]!.emitData(big);
    ptys[0]!.emitData(big);
    hub.follow(id, 0, send);
    expect(frames).toEqual([{ type: "data", data: big, cursor: 2 }]);
  });

  test("an exit is delivered to followers, and to one that arrives after it", async () => {
    const { hub, ptys, frames, send } = scene();
    const { id } = await hub.open({});
    hub.follow(id, 0, send);
    ptys[0]!.emitData("bye\r\n");
    ptys[0]!.emitExit({ exitCode: 2 });
    expect(frames.at(-1)).toMatchObject({ type: "exit", ending: { fate: "exited", exitCode: 2 } });

    const late: ShellFrame[] = [];
    hub.follow(id, 0, (frame) => void late.push(frame));
    expect(late.map((frame) => frame.type)).toEqual(["data", "exit"]);
  });

  test("input, resize and close reach only a running shell", async () => {
    const { hub, ptys } = scene();
    const { id } = await hub.open({});
    expect(hub.write(id, "ls\r")).toBe(true);
    expect(hub.resize(id, 100, 30)).toBe(true);
    expect(ptys[0]!.writes).toEqual(["ls\r"]);
    expect(await hub.close(id)).toBe(true);

    expect(hub.write(id, "x")).toBe(false);
    expect(hub.resize(id, 1, 1)).toBe(false);
    expect(await hub.close("term_nope")).toBe(false);
  });

  test("a shell that never started is the open's answer, not a followable terminal", async () => {
    const { hub } = scene();
    const bad = fakeHost({ stat: async () => Promise.reject(new Error("ENOENT")) });
    const opened = await new ShellHub(bad.host).open({ cwd: "/gone" });
    expect(opened.ending?.fate).toBe("failed");
    expect(hub.follow(opened.id, 0, () => {})).toBeUndefined();
  });
});
