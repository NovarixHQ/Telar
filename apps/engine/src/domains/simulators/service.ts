import type { SimulatorBootFailure, SimulatorPlatformAvailability, SimulatorSettings, SimulatorSummary, SimulatorsState } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import { agentEnv } from "../../platform/process/agent-env";
import { processRunner, type ProcessRunner } from "../../platform/process/runner";
import { reserveLoopbackPort, SimulatorHub, type HubDeps } from "./hub";
import { HUB_VERSION, HubToolchain, installedHubVersions } from "./toolchain";

export type SimulatorsDeps = {
  root: string;
  enabled: () => boolean;
  runner?: ProcessRunner;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  reservePort?: HubDeps["reservePort"];
  sleep?: HubDeps["sleep"];
  now?: () => number;
};

type HubDevice = SimulatorSummary;
type HubDeviceList = { simulators?: HubDevice[]; emulators?: HubDevice[]; errors?: Array<{ message?: string }> };
type HubActionResult = { ok?: boolean; id?: string; serial?: string; error?: string };

const LIST_TIMEOUT_MS = 15_000;
const BOOT_TIMEOUT_MS = 3 * 60_000;
const RETRY_AFTER_MS = 30_000;

const BOOT_FAILURES: Record<SimulatorBootFailure, string> = {
  disk_space: "The simulator could not start because the disk is full.",
  timeout: "The simulator took too long to start.",
  launch_failed: "The simulator could not start. Check that it opens in the simulator app.",
};

export function bootFailure(error: string | undefined): SimulatorBootFailure {
  if (/insufficient.*(?:disk|space)|not enough.*(?:disk|space)|no space left/i.test(error ?? "")) return "disk_space";
  if (/timed? out|timeout/i.test(error ?? "")) return "timeout";
  return "launch_failed";
}

const summary = ({ id, platform, name, version, booted, physical }: HubDevice): SimulatorSummary => ({ id, platform, name, version, booted, physical });

export class Simulators {
  private readonly runner: ProcessRunner;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly toolchain: HubToolchain;
  private readonly hub: SimulatorHub;
  private readying?: Promise<string>;
  private installing = false;
  private failure?: { message: string; at: number };
  private platforms?: Promise<SimulatorPlatformAvailability[]>;
  private devices: HubDevice[] = [];

  constructor(private readonly deps: SimulatorsDeps) {
    this.runner = deps.runner ?? processRunner;
    this.fetch = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    const env = () => agentEnv();
    this.toolchain = new HubToolchain({ root: deps.root, runner: this.runner, env });
    this.hub = new SimulatorHub({
      root: deps.root,
      runner: this.runner,
      fetch: this.fetch,
      env,
      reservePort: deps.reservePort ?? reserveLoopbackPort,
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: this.now,
    });
  }

  async state(): Promise<SimulatorsState> {
    const hub = (origin?: string) => ({ requiredVersion: HUB_VERSION, installedVersions: installedHubVersions(this.deps.root), runningVersion: origin ? HUB_VERSION : null });
    if (!this.deps.enabled()) return { status: "disabled", hub: hub(), platforms: [], simulators: [], errors: [] };
    const platforms = await this.availability();
    const origin = this.hub.origin();
    if (!origin) {
      this.ensureReady().catch(() => undefined);
      return { ...this.pending(), hub: hub(), platforms, simulators: [], errors: [] };
    }
    const list = await this.call<HubDeviceList>(origin, "GET", "/api/devices", undefined, LIST_TIMEOUT_MS);
    this.devices = [...(list.simulators ?? []), ...(list.emulators ?? [])];
    const errors = (list.errors ?? []).flatMap((error) => (error.message ? [error.message] : []));
    return { status: "ready", hub: hub(origin), platforms, simulators: this.devices.map(summary), errors };
  }

  async boot(id: string): Promise<SimulatorSummary> {
    const origin = this.requireReady();
    const device = await this.find(id);
    const result = await this.call<HubActionResult>(origin, "POST", "/api/devices/boot", { platform: device.platform, id: device.id, name: device.name }, BOOT_TIMEOUT_MS);
    if (!result.ok) throw new HttpError(502, "provider_unavailable", BOOT_FAILURES[bootFailure(result.error)]);
    if (device.platform === "ios") await this.call(origin, "POST", "/vendor/serve-sim/grid/api/start", { udid: device.id }, LIST_TIMEOUT_MS).catch(() => undefined);
    await this.state();
    const bootedId = result.serial ?? result.id ?? device.id;
    return summary(this.devices.find((candidate) => candidate.id === bootedId) ?? { ...device, id: bootedId, booted: true });
  }

  /** iOS goes through serve-sim's route, which closes its capture first; it fails on a simulator already off, so the list decides. */
  async shutdown(id: string): Promise<SimulatorSummary> {
    const origin = this.requireReady();
    const device = await this.find(id);
    const [route, body] =
      device.platform === "ios" ? ["/vendor/serve-sim/grid/api/shutdown", { udid: device.id }] : ["/api/devices/shutdown", { platform: device.platform, id: device.id }];
    await this.call(origin, "POST", route, body, LIST_TIMEOUT_MS).catch(() => undefined);
    await this.state().catch(() => undefined);
    const after = this.devices.find((candidate) => candidate.id === device.id);
    if (after?.booted) throw new HttpError(502, "provider_unavailable", "The simulator did not shut down.");
    return summary(after ?? { ...device, booted: false });
  }

  async settingsChanged(settings: SimulatorSettings): Promise<void> {
    this.failure = undefined;
    if (settings.enabled) {
      this.ensureReady().catch(() => undefined);
      return;
    }
    this.devices = [];
    await this.hub.stop();
  }

  stop(): Promise<void> {
    return this.hub.stop();
  }

  private pending(): Pick<SimulatorsState, "status" | "detail"> {
    if (this.installing) return { status: "installing", detail: `Installing the simulator hub ${HUB_VERSION}…` };
    if (this.readying || this.hub.status().state === "starting") return { status: "starting" };
    if (this.failure) return { status: "failed", detail: this.failure.message };
    return { status: "idle" };
  }

  private ensureReady(): Promise<string> {
    if (this.failure && this.now() - this.failure.at < RETRY_AFTER_MS) return Promise.reject(new Error(this.failure.message));
    this.readying ??= (async () => {
      try {
        this.installing = !this.toolchain.installed();
        const entry = await this.toolchain.install().finally(() => (this.installing = false));
        if (!this.deps.enabled()) throw new Error("Simulators are off.");
        const origin = await this.hub.start(entry);
        this.failure = undefined;
        return origin;
      } catch (error) {
        this.failure = { message: error instanceof Error ? error.message : String(error), at: this.now() };
        throw error;
      }
    })().finally(() => (this.readying = undefined));
    return this.readying;
  }

  private requireReady(): string {
    if (!this.deps.enabled()) throw new HttpError(409, "conflict", "Simulators are off. Turn them on in Settings first.");
    const origin = this.hub.origin();
    if (!origin) {
      this.ensureReady().catch(() => undefined);
      throw new HttpError(409, "conflict", "The simulator hub is still starting.");
    }
    return origin;
  }

  private async find(id: string): Promise<HubDevice> {
    const known = () => this.devices.find((candidate) => candidate.id === id);
    if (!known()) await this.state();
    const device = known();
    if (!device) throw new HttpError(404, "not_found", "No simulator has that id.");
    return device;
  }

  private availability(): Promise<SimulatorPlatformAvailability[]> {
    this.platforms ??= (async (): Promise<SimulatorPlatformAvailability[]> => {
      if ((this.deps.platform ?? process.platform) !== "darwin") return [{ platform: "ios", available: false, reason: "iOS Simulators need macOS." }];
      const { code } = await this.runner.run("xcrun", ["--find", "simctl"], { timeoutMs: 10_000 });
      return [code === 0 ? { platform: "ios", available: true } : { platform: "ios", available: false, reason: "The Xcode command line tools were not found." }];
    })();
    return this.platforms;
  }

  private async call<T>(origin: string, method: "GET" | "POST", route: string, body: unknown, timeoutMs: number): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(`${origin}${route}`, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new HttpError(502, "provider_unavailable", "The simulator hub did not answer.");
    }
    const answer = (await response.json().catch(() => undefined)) as T | undefined;
    if (answer === undefined || (!response.ok && method === "GET")) throw new HttpError(502, "provider_unavailable", `The simulator hub answered ${response.status}.`);
    return answer;
  }
}
