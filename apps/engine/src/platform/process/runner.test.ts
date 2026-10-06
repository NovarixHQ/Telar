import { expect, test } from "bun:test";
import { processRunner } from "./runner";

test("run answers the exit code and both streams", async () => {
  const result = await processRunner.run("sh", ["-c", "echo out; echo err >&2; exit 3"]);
  expect(result).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
});

test("run writes its input to the child's stdin", async () => {
  expect((await processRunner.run("cat", [], { input: "payload" })).stdout).toBe("payload");
});

test("run answers a missing binary instead of throwing", async () => {
  const result = await processRunner.run("/nonexistent/telar-test-binary", []);
  expect(result.code).toBeNull();
  expect(result.stderr).toContain("ENOENT");
});

test("start answers the pid and resolves exited once stopped", async () => {
  const child = processRunner.start("sleep", ["60"]);
  expect(child.pid).toBeGreaterThan(0);
  child.stop();
  expect(await child.exited).toBeNull();
});

test("start hands the child's stderr to onStderr", async () => {
  const text = await new Promise<string>((resolve) => processRunner.start("sh", ["-c", "echo '[hid] input failed' >&2"], { onStderr: resolve }));
  expect(text).toBe("[hid] input failed\n");
});

test("start resolves exited with null for a missing binary", async () => {
  expect(await processRunner.start("/nonexistent/telar-test-binary", []).exited).toBeNull();
});
