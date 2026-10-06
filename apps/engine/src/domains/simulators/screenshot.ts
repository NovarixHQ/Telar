import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SimulatorSummary } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import type { ActionDeps } from "./actions";

const DEVICE_FILE = "/data/local/tmp/telar-screenshot.png";

export async function takeScreenshot(deps: ActionDeps, device: SimulatorSummary): Promise<Uint8Array> {
  if (!device.booted) throw new HttpError(409, "conflict", "The simulator is not running. Open it first.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-screenshot-"));
  const file = path.join(dir, "screen.png");
  const step = async (command: string, args: string[]) => {
    const { code } = await deps.run(command, args, { timeoutMs: 30_000 });
    if (code !== 0) throw new HttpError(502, "provider_unavailable", `The screenshot failed (exit code ${code ?? "none"}).`);
  };
  try {
    if (device.platform === "ios") {
      await step("xcrun", ["simctl", "io", device.id, "screenshot", "--type=png", file]);
    } else {
      await step("adb", ["-s", device.id, "shell", "screencap", "-p", DEVICE_FILE]);
      await step("adb", ["-s", device.id, "pull", DEVICE_FILE, file]);
    }
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch {
      throw new HttpError(502, "provider_unavailable", "The screenshot left no image.");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
