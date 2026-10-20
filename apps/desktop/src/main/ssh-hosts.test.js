const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSshHosts } = require("./ssh-hosts");

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-ssh-hosts-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function registry() {
  const events = [];
  const tunnel = (name) => ({ start: () => events.push(`${name} start`), stop: () => events.push(`${name} stop`), reconnectNow: () => events.push(`${name} reconnect`) });
  let port = 41000;
  const hosts = createSshHosts({
    dir,
    base: () => "https://dl.example.org/telar",
    findFreePort: async () => ++port,
    launch: async ({ target, localPort }) => ({ pairingUrl: `http://127.0.0.1:${localPort}/pair#token=12345678`, tunnel: tunnel(`${target}:${localPort}`) }),
    tunnelFor: ({ target, localPort }) => tunnel(`${target}:${localPort}`),
  });
  return { hosts, events };
}

describe("computers added over ssh", () => {
  test("a computer keeps the same local port, so its address survives a restart", async () => {
    const first = registry();
    const added = await first.hosts.add("me@box");
    expect(added).toEqual({ pairingUrl: "http://127.0.0.1:41001/pair#token=12345678", name: "box" });
    expect((await first.hosts.add("me@box")).pairingUrl).toContain(":41001/");

    const second = registry();
    second.hosts.restore();
    expect(second.events).toEqual(["me@box:41001 start"]);
  });

  test("the file holds no secret and is private", async () => {
    await registry().hosts.add("me@box");
    const file = path.join(dir, "ssh-hosts.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual([{ target: "me@box", localPort: 41001 }]);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  test("forgetting the computer closes its forward and only its", async () => {
    const { hosts, events } = registry();
    await hosts.add("me@box");
    await hosts.add("me@other");
    expect(hosts.release("http://127.0.0.1:41001")).toBe(true);
    expect(events).toContain("me@box:41001 stop");
    expect(events).not.toContain("me@other:41002 stop");
    expect(hosts.release("http://127.0.0.1:41001")).toBe(false);
    expect(hosts.release("https://mini.tail.ts.net:443")).toBe(false);
  });

  test("a network change reconnects every forward, and quitting closes them", async () => {
    const { hosts, events } = registry();
    await hosts.add("me@box");
    hosts.reconnectAll();
    hosts.stopAll();
    expect(events.slice(-2)).toEqual(["me@box:41001 reconnect", "me@box:41001 stop"]);
  });

  test("something that is not a target never reaches ssh", async () => {
    await expect(registry().hosts.add("--version")).rejects.toMatchObject({ code: "bad_target" });
  });
});
