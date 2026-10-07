import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineClient, type SimulatorSummary } from "@telar/engine-client";
import { startEngine } from "../src/daemon";
import type { OpenSocket } from "../src/domains/simulators/input";
import { stubModels } from "./stub-models";
import type { ProcessHandle, ProcessOptions, ProcessResult, ProcessRunner } from "../src/platform/process/runner";
import type { ActionDeps } from "../src/domains/simulators/actions";
import type { TurnDriver } from "../src/drivers";

type Call = { file: string; args: readonly string[]; options?: ProcessOptions };

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function fakeRunner(overrides: { npm?: ProcessResult; ps?: string | (() => string); xcrun?: number; simctlList?: (args: readonly string[]) => string } = {}) {
  const runs: Call[] = [];
  const starts: Array<Call & { handle: ProcessHandle; exit(code?: number): void }> = [];
  const waiting: Array<{ count: number; resolve: () => void }> = [];
  const runner: ProcessRunner = {
    async run(file, args, options) {
      runs.push({ file, args, ...(options ? { options } : {}) });
      if (file === "npm") {
        if (overrides.npm) return overrides.npm;
        const prefix = args[args.indexOf("--prefix") + 1]!;
        const name = args.at(-1)!.split("@")[0]!;
        const entry = path.join(prefix, "node_modules", name, name === "agent-device" ? "bin/agent-device.mjs" : "dist/server/cli.mjs");
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, "");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (file === "ps") return { code: 0, stdout: (typeof overrides.ps === "function" ? overrides.ps() : overrides.ps) ?? "", stderr: "" };
      if (file === "xcrun") {
        if (args[1] === "io" && args[3] === "screenshot") fs.writeFileSync(args.at(-1)!, PNG);
        const stdout = args[1] === "list" ? (overrides.simctlList?.(args) ?? "") : "";
        return { code: overrides.xcrun ?? 0, stdout, stderr: "" };
      }
      if (file === "plutil") return { code: 0, stdout: fs.readFileSync(args.at(-1)!, "utf8"), stderr: "" };
      if (file === "sips") return fakeSips(args);
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

function fakeSips(args: readonly string[]): ProcessResult {
  if (args[0] === "-g") {
    const [width, height] = fs.readFileSync(args.at(-1)!, "utf8").split("x");
    return { code: 0, stdout: `${args.at(-1)}\n  pixelWidth: ${width}\n  pixelHeight: ${height}\n`, stderr: "" };
  }
  fs.writeFileSync(args.at(-1)!, PNG);
  return { code: 0, stdout: "", stderr: "" };
}

export const DEVICE_TYPE_ID = "com.apple.CoreSimulator.SimDeviceType.Pulso-Phone";

export function fakeDeviceType(root: string, options: { chrome?: boolean } = {}) {
  const bundle = path.join(root, "DeviceTypes", "Pulso Phone.simdevicetype");
  const chromeDir = path.join(root, "Chrome");
  const write = (file: string, content: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  };
  const resources = path.join(bundle, "Contents", "Resources");
  write(path.join(resources, "profile.plist"), { chromeIdentifier: "com.apple.dt.devicekit.chrome.pulso", modelIdentifier: "Pulso1,1" });
  write(path.join(resources, "capabilities.plist"), {
    capabilities: {
      DeviceCornerRadius: 50,
      displays: [
        { displayType: "tvOut", screenID: 2, width: 720, height: 480, scale: 1 },
        { displayType: "integrated", screenID: 1, width: 1200, height: 2400, scale: 3, cornerRadiusUL: 60, chromeIdentifier: "com.apple.dt.devicekit.chrome.pulso" },
      ],
    },
  });
  if (options.chrome !== false) {
    const art = path.join(chromeDir, "pulso.devicechrome", "Contents", "Resources");
    const pieces = { topLeft: "TL", top: "Top", topRight: "TR", left: "Left", right: "Right", bottomLeft: "BL", bottom: "Base", bottomRight: "BR" };
    write(path.join(art, "chrome.json"), {
      identifier: "com.apple.dt.devicekit.chrome.pulso",
      images: { ...pieces, sizing: { leftWidth: 20, rightWidth: 20, topHeight: 20, bottomHeight: 20 } },
      inputs: [
        { name: "power", image: "Power", anchor: "right", align: "leading", onTop: false, offsets: { normal: { x: -8, y: 200 }, rollover: { x: -3, y: 200 } } },
        { name: "action", image: "Action", anchor: "left", align: "leading", offsets: { normal: { x: 8, y: 150 }, rollover: { x: 3, y: 150 } } },
      ],
    });
    for (const name of ["TL", "TR", "BL", "BR"]) write(path.join(art, `${name}.pdf`), "100x100");
    write(path.join(art, "Top.pdf"), "1x100");
    write(path.join(art, "Base.pdf"), "1x100");
    write(path.join(art, "Left.pdf"), "100x1");
    write(path.join(art, "Right.pdf"), "100x1");
    write(path.join(art, "Power.pdf"), "16x100");
    write(path.join(art, "Action.pdf"), "16x30");
  }
  const simctl = (udid: string) => JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [{ udid, deviceTypeIdentifier: DEVICE_TYPE_ID, name: "Pulso Phone" }] }, devicetypes: [{ identifier: DEVICE_TYPE_ID, bundlePath: bundle }] });
  return { bundle, chromeDir, simctl };
}

type HubRequest = { method: string; path: string; search: string; headers: Record<string, string>; body?: Record<string, unknown>; text?: string };

export function fakeHub(devices: SimulatorSummary[], options: { bootError?: string; ready?: boolean; video?: () => ReadableStream<Uint8Array> } = {}) {
  const requests: HubRequest[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const text = init?.body instanceof ReadableStream ? await new Response(init.body).text() : undefined;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    requests.push({ method: init?.method ?? "GET", path: url.pathname, search: url.search, headers, ...(body ? { body } : {}), ...(text !== undefined ? { text } : {}) });
    const find = (id: unknown) => devices.find((device) => device.id === id);
    switch (url.pathname) {
      case "/readyz":
        return new Response("", { status: options.ready === false ? 503 : 200 });
      case "/api/devices":
        return json({ simulators: devices.filter((d) => d.platform === "ios"), emulators: devices.filter((d) => d.platform === "android") });
      case "/api/devices/boot": {
        if (options.bootError) return json({ ok: false, error: options.bootError }, 500);
        const device = find(body?.id);
        if (!device) return json({ ok: true, id: body?.id });
        device.booted = true;
        if (device.platform === "android") device.id = "emulator-5554";
        return json({ ok: true, ...(device.platform === "android" ? { serial: device.id } : { id: device.id }) });
      }
      case "/vendor/serve-sim/grid/api/start":
        return json({ ok: true });
      case "/vendor/serve-sim/grid/api/shutdown":
      case "/api/devices/shutdown": {
        const device = find(body?.udid ?? body?.id);
        if (!device) return json({ ok: true });
        if (!device.booted) return json({ ok: false, error: "already shut down" }, 500);
        device.booted = false;
        return json({ ok: true });
      }
      default:
        if (url.pathname.endsWith("/stream.avcc") && options.video) return new Response(options.video(), { headers: { "content-type": "application/octet-stream" } });
        if (url.pathname.endsWith("/stream.mjpeg")) {
          return new Response(new Blob(["--frame\r\n", "jpeg"]).stream(), { headers: { "content-type": "multipart/x-mixed-replace; boundary=frame", "content-encoding": "identity", "cache-control": "max-age=60" } });
        }
        return json({ hub: url.pathname });
    }
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function hubVideo(first: Uint8Array) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const video = () => new ReadableStream<Uint8Array>({ start: (c) => {
    controller = c;
    c.enqueue(first);
  } });
  return { video, write: (bytes: Uint8Array) => controller.enqueue(bytes), end: () => controller.close() };
}

export const iPhone = (): SimulatorSummary => ({ id: "A1B2-UDID", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted: false, physical: false });
export const WATCH_ID = "DA92D4A4-E32E-412B-9946-BC7F8AD44DD1";

export const simctlWithPair = (phoneId = "A1B2-UDID", watchState = "Booted") =>
  JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
        { lastUsedAt: "2026-10-06T20:05:12Z", dataPath: "/tmp/phone/data", udid: phoneId, isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro", state: "Booted", name: "iPhone 16" },
      ],
      "com.apple.CoreSimulator.SimRuntime.watchOS-27-0": [
        { lastUsedAt: "2026-10-06T20:05:12Z", dataPath: "/tmp/watch/data", udid: WATCH_ID, isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-12-46mm", state: watchState, name: "Pulso Watch" },
        { dataPath: "/tmp/lonely/data", udid: "0000-LONELY", isAvailable: true, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-SE-40mm", state: "Shutdown", name: "Apple Watch SE" },
      ],
    },
    pairs: { "C55015BD-A9B3-4CDF-A7FB-81A5949BD581": { watch: { name: "Pulso Watch", udid: WATCH_ID, state: watchState }, phone: { name: "iPhone 16", udid: phoneId, state: "Booted" }, state: "(active, connected)" } },
  });

export const pixel = (): SimulatorSummary => ({ id: "Pixel_8", platform: "android", name: "Pixel 8", version: "Android 15", booted: false, physical: false });

type Run = { file: string; args: readonly string[]; input?: string };

export function fakeActionDeps(answers: Record<string, Partial<ProcessResult>> = {}, helpers = { axSettings: "/hub/ax", serveSimCli: "/hub/serve-sim.js" }) {
  const runs: Run[] = [];
  const value: ActionDeps = {
    async run(file: string, args: readonly string[], options?: ProcessOptions) {
      runs.push({ file, args, ...(options?.input !== undefined ? { input: options.input } : {}) });
      const answer = answers[[file, ...args].join(" ")] ?? {};
      return { code: 0, stdout: "", stderr: "", ...answer };
    },
    helpers: () => helpers,
  };
  return { deps: value, runs, commands: () => runs.map((run) => [run.file, ...run.args].join(" ")) };
}

export async function simulatorEngine(options: { devices?: SimulatorSummary[]; ready?: boolean; openSocket?: OpenSocket; engineRoot?: string; driver?: TurnDriver; video?: () => ReadableStream<Uint8Array>; simctlList?: (args: readonly string[]) => string; chromeDir?: string } = {}) {
  const engineRoot = options.engineRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "telar-simulators-http-"));
  const fake = fakeRunner(options.simctlList ? { simctlList: options.simctlList } : {});
  const hub = fakeHub(options.devices ?? [iPhone()], options.video ? { video: options.video } : {});
  const daemon = await startEngine({
    models: stubModels,
    engineRoot,
    ...(options.driver ? { embeddedWorker: { createDriver: () => options.driver!, pollMs: 20 } } : {}),
    simulators: { runner: fake.runner, fetch: hub.fetch, platform: "darwin", reservePort: async () => 4321, sleep: async () => undefined, ...(options.openSocket ? { openSocket: options.openSocket } : {}), ...(options.chromeDir ? { chromeDir: options.chromeDir } : {}) },
  });
  const client = new EngineClient(daemon.discovery);
  const close = async () => {
    await daemon.close();
    fs.rmSync(engineRoot, { recursive: true, force: true });
  };
  if (options.ready) {
    await client.setSimulatorSettings({ enabled: true });
    let state = (await client.simulators()).simulators;
    for (let reads = 0; state.status !== "ready" && reads < 50; reads += 1) state = (await client.simulators()).simulators;
  }
  const request = (pathname: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${daemon.discovery.port}${pathname}`, { ...init, headers: { authorization: `Bearer ${daemon.discovery.token}`, ...init.headers } });
  return { daemon, client, engineRoot, hub, close, request, ...fake };
}
