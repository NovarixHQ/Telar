import fs from "node:fs";
import path from "node:path";
import type { SimulatorSummary } from "@telar/engine-client";
import type { ProcessHandle, ProcessOptions, ProcessResult, ProcessRunner } from "../src/platform/process/runner";

type Call = { file: string; args: readonly string[]; options?: ProcessOptions };

export function fakeRunner(overrides: { npm?: ProcessResult; ps?: string; xcrun?: number } = {}) {
  const runs: Call[] = [];
  const starts: Array<Call & { handle: ProcessHandle; exit(code?: number): void }> = [];
  const waiting: Array<{ count: number; resolve: () => void }> = [];
  const runner: ProcessRunner = {
    async run(file, args, options) {
      runs.push({ file, args, ...(options ? { options } : {}) });
      if (file === "npm") {
        if (overrides.npm) return overrides.npm;
        const prefix = args[args.indexOf("--prefix") + 1]!;
        const entry = path.join(prefix, "node_modules", "expo-device-hub", "dist", "server", "cli.mjs");
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, "");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (file === "ps") return { code: 0, stdout: overrides.ps ?? "", stderr: "" };
      if (file === "xcrun") return { code: overrides.xcrun ?? 0, stdout: "", stderr: "" };
      return { code: 127, stdout: "", stderr: "" };
    },
    start(file, args, options) {
      let exit!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (exit = resolve));
      const handle: ProcessHandle = { pid: undefined, exited, stop: () => exit(null) };
      starts.push({ file, args, ...(options ? { options } : {}), handle, exit: (code = 1) => exit(code) });
      for (const waiter of waiting.filter((w) => starts.length >= w.count)) waiter.resolve();
      return handle;
    },
  };
  const started = (count: number) =>
    starts.length >= count ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ count, resolve }));
  return { runner, runs, starts, started };
}

type HubRequest = { method: string; path: string; body?: Record<string, unknown> };

export function fakeHub(devices: SimulatorSummary[], options: { bootError?: string; ready?: boolean } = {}) {
  const requests: HubRequest[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({ method: init?.method ?? "GET", path: url.pathname, ...(body ? { body } : {}) });
    const find = (id: unknown) => devices.find((device) => device.id === id);
    switch (url.pathname) {
      case "/readyz":
        return new Response("", { status: options.ready === false ? 503 : 200 });
      case "/api/devices":
        return json({ simulators: devices.filter((d) => d.platform === "ios"), emulators: devices.filter((d) => d.platform === "android") });
      case "/api/devices/boot": {
        if (options.bootError) return json({ ok: false, error: options.bootError }, 500);
        const device = find(body?.id)!;
        device.booted = true;
        if (device.platform === "android") device.id = "emulator-5554";
        return json({ ok: true, ...(device.platform === "android" ? { serial: device.id } : { id: device.id }) });
      }
      case "/vendor/serve-sim/grid/api/start":
        return json({ ok: true });
      case "/vendor/serve-sim/grid/api/shutdown":
      case "/api/devices/shutdown": {
        const device = find(body?.udid ?? body?.id)!;
        if (!device.booted) return json({ ok: false, error: "already shut down" }, 500);
        device.booted = false;
        return json({ ok: true });
      }
      default:
        return json({ error: "not found" }, 404);
    }
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export const iPhone = (): SimulatorSummary => ({ id: "A1B2-UDID", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted: false, physical: false });
export const pixel = (): SimulatorSummary => ({ id: "Pixel_8", platform: "android", name: "Pixel 8", version: "Android 15", booted: false, physical: false });
