import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startEngine, type EngineDaemon } from "../../daemon";
import { stubModels } from "../../../test/stub-models";
import { readHostId } from "./identity";

const roots: string[] = [];
const daemons: EngineDaemon[] = [];

afterEach(async () => {
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-identity-"));
  roots.push(dir);
  return dir;
}

test("the host id is minted once and read back unchanged", () => {
  const dir = path.join(tempDir(), "remote");
  const first = readHostId(dir);
  expect(first).toMatch(/^host_[0-9a-f-]{36}$/);
  expect(readHostId(dir)).toBe(first);
});

test("a damaged host id file is replaced with a fresh id", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "host-id"), "not an id");
  const minted = readHostId(dir);
  expect(minted).toMatch(/^host_/);
  expect(fs.readFileSync(path.join(dir, "host-id"), "utf8")).toBe(minted);
});

test("the engine answers the same host id across restarts while its daemon id changes", async () => {
  const root = path.join(tempDir(), "engine");
  const identify = async () => {
    const daemon = await startEngine({ models: stubModels, engineRoot: root });
    daemons.push(daemon);
    const { port, token, daemonId } = daemon.discovery;
    const response = await fetch(`http://127.0.0.1:${port}/v2/identity`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await response.json()) as { hostId: string; name?: string; appVersion: string };
    await daemons.pop()!.close();
    return { ...body, daemonId };
  };
  const first = await identify();
  const second = await identify();
  expect(second.hostId).toBe(first.hostId);
  expect(second.daemonId).not.toBe(first.daemonId);
  expect(first.appVersion).toMatch(/^\d+\.\d+\.\d+/);
});
