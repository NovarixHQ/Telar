import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";
import { hashToken, type PairedDevice, type RemoteFile } from "./store";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const device = (id: string, name: string, extra: Partial<PairedDevice> = {}): PairedDevice => ({
  id,
  name,
  tokenHash: hashToken(`tlr_${id}`),
  createdAt: 1_000,
  role: "full",
  ...extra,
});

async function engineWith(file: RemoteFile) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-remote-cleanup-"));
  roots.push(home);
  fs.mkdirSync(path.join(home, "remote"));
  fs.writeFileSync(path.join(home, "remote", "remote.json"), JSON.stringify(file));
  const daemon = await startEngine({ models: stubModels, engineRoot: path.join(home, "engine") });
  daemons.push(daemon);
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${daemon.discovery.port}${route}`, {
      method,
      headers: { authorization: `Bearer ${daemon.discovery.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return (await response.json()) as Record<string, any>;
  };
  const admits = async (id: string) =>
    (await call("POST", "/v2/auth/decide", { pathname: "/api/projects", method: "GET", authorization: `Bearer tlr_${id}` })).allow as boolean;
  const ids = async () => ((await call("GET", "/v2/remote")).devices as { id: string }[]).map((each) => each.id);
  return { admits, ids, home };
}

test("on boot, duplicate pairings collapse to the latest and the host app's self-pairing is revoked", async () => {
  const { admits, ids } = await engineWith({
    version: 1,
    requireAuth: true,
    devices: [
      device("iphone_old", "iPhone 17 Pro", { platform: "ios", lastSeenAt: 2_000 }),
      device("iphone_new", "iPhone 17 Pro", { platform: "ios", lastSeenAt: 5_000 }),
      device("ipad", "iPad Pro 13-inch", { platform: "ios" }),
      device("ipad_again", "iPad Pro 13-inch", { platform: "ios", createdAt: 3_000 }),
      device("host_app", "Electron · MINI-FBARBERA", { identity: { kind: "desktop", client: "Electron", machine: "MINI-FBARBERA" } }),
      device("tailnet_safari", "Safari · macOS", { identity: { kind: "browser", address: "100.64.0.2" } }),
      device("lan_safari", "Safari · macOS", { identity: { kind: "browser", address: "192.168.1.9" } }),
      device("chrome_a", "Chrome on MINI", { clientId: "a" }),
      device("chrome_b", "Chrome on MINI", { clientId: "b" }),
    ],
  });

  expect(await ids()).toEqual(["iphone_new", "ipad_again", "tailnet_safari", "lan_safari", "chrome_a", "chrome_b"]);
  expect(await admits("iphone_old")).toBe(false);
  expect(await admits("host_app")).toBe(false);
  expect(await admits("iphone_new")).toBe(true);
});

test("the cleanup runs once, so a device paired after it is left alone", async () => {
  const { home } = await engineWith({ version: 1, requireAuth: true, devices: [device("one", "Phone", { platform: "ios" })] });
  const file = path.join(home, "remote", "remote.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8")) as RemoteFile;
  stored.devices.push(device("two", "Phone", { platform: "ios" }));
  fs.writeFileSync(file, JSON.stringify(stored));
  for (const daemon of daemons.splice(0)) await daemon.close();

  const daemon = await startEngine({ models: stubModels, engineRoot: path.join(home, "engine") });
  daemons.push(daemon);
  const after = JSON.parse(fs.readFileSync(file, "utf8")) as RemoteFile;
  expect(after.devices.map((each) => each.id)).toEqual(["one", "two"]);
});
