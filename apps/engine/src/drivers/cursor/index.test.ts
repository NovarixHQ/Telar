import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TurnDriver } from "../contract";
import { createCursorDriver } from ".";

const FAKE = fileURLToPath(new URL("../../../test/fixtures/fake-acp-agent.mjs", import.meta.url));
const dirs: string[] = [];
const drivers: TurnDriver[] = [];

afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose?.();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fakeAgentBinary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-cursor-test-"));
  dirs.push(dir);
  const file = path.join(dir, "agent");
  fs.writeFileSync(file, `#!/bin/sh\n[ "$1" = acp ] || exit 9\nshift\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

test("a Cursor turn runs the resolved agent binary as `agent acp`", async () => {
  const binary = fakeAgentBinary();
  const asked: Array<string | undefined> = [];
  const driver = createCursorDriver({ resolveBin: (pinned) => (asked.push(pinned), binary) });
  drivers.push(driver);
  const result = driver.run({
    prompt: "hi",
    sessionId: "session_cursor",
    cwd: os.tmpdir(),
    signal: new AbortController().signal,
    env: { ACP_FAKE_SCRIPT: "plain" },
    onObservations: async () => {},
  });
  await expect(result).resolves.toMatchObject({ text: "hello", providerSessionId: "fake-acp-session" });
  expect(asked).toEqual([undefined]);
});
