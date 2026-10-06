import type { SimulatorAction, SimulatorBootFailure, SimulatorDetail, SimulatorInput, SimulatorSettings, SimulatorSummary, SimulatorsState, WorkerClaim } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import { agentEnv } from "../../platform/process/agent-env";
import { processRunner, type ProcessRunner } from "../../platform/process/runner";
import { reserveLoopbackPort, SimulatorHub, type HubDeps } from "./hub";
import { runAction, type ActionDeps } from "./actions";
import { BootWatch } from "./boots";
import { readDetail } from "./detail";
import { takeScreenshot } from "./screenshot";
import { InputRelay, type OpenSocket } from "./input";
import { listPairedWatches, withWatches } from "./pairs";
import { hostPlatforms, hubErrors, type HostPlatforms } from "./platforms";
import { StreamTickets } from "./tickets";
import { AGENT_DEVICE, HUB, HUB_VERSION, hubHelpers, installedVersions, NpmToolchain, toolBinDir } from "./toolchain";

export type SimulatorsDeps = {
  root: string;
  enabled: () => boolean;
  agentAccess?: () => boolean;
  runner?: ProcessRunner;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (file: string) => boolean;
  list?: (dir: string) => string[];
  reservePort?: HubDeps["reservePort"];
  sleep?: HubDeps["sleep"];
  now?: () => number;
  openSocket?: OpenSocket;
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

const summary = ({ id, platform, name, version, booted, physical, pairedWith }: HubDevice): SimulatorSummary => ({ id, platform, name, version, booted, physical, ...(pairedWith ? { pairedWith } : {}) });

export class Simulators {
  private readonly runner: ProcessRunner;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private readonly toolchain: NpmToolchain;
  private readonly agentDevice: NpmToolchain;
  private readonly hub: SimulatorHub;
  private readying?: Promise<string>;
  private installing = false;
  private failure?: { message: string; at: number };
  private host?: Promise<HostPlatforms>;
  private developerDir?: string;
  private devices: HubDevice[] = [];
  private readonly input: InputRelay;
  private readonly boots: BootWatch;
  private restarting?: Promise<void>;
  private readonly actionDeps: ActionDeps;
  readonly tickets: StreamTickets;

  constructor(private readonly deps: SimulatorsDeps) {
    this.runner = deps.runner ?? processRunner;
    this.fetch = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    const env = () => ({ ...agentEnv(), ...(this.developerDir ? { DEVELOPER_DIR: this.developerDir } : {}) });
    this.toolchain = new NpmToolchain(HUB, { root: deps.root, runner: this.runner, env });
    this.agentDevice = new NpmToolchain(AGENT_DEVICE, { root: deps.root, runner: this.runner, env });
    this.input = new InputRelay(deps.openSocket);
    this.boots = new BootWatch((file, args, options) => this.runner.run(file, args, options));
    this.tickets = new StreamTickets(this.now);
    this.actionDeps = { run: (file, args, options) => this.runner.run(file, args, { ...options, env: env() }), helpers: () => hubHelpers(deps.root) };
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
    const hub = (origin?: string) => ({ requiredVersion: HUB_VERSION, installedVersions: installedVersions(this.deps.root, HUB), runningVersion: origin ? HUB_VERSION : null });
    if (!this.deps.enabled()) return { status: "disabled", hub: hub(), platforms: [], simulators: [], errors: [] };
    const host = await this.platforms();
    const platforms = host.availability;
    const origin = this.hub.origin();
    if (!origin) {
      this.ensureReady().catch(() => undefined);
      return { ...this.pending(), hub: hub(), platforms, simulators: [], errors: [] };
    }
    const ios = platforms.some((entry) => entry.platform === "ios" && entry.available);
    const [list, watches] = await Promise.all([
      this.call<HubDeviceList>(origin, "GET", "/api/devices", undefined, LIST_TIMEOUT_MS),
      ios ? listPairedWatches(this.actionDeps.run) : [],
    ]);
    this.devices = [...withWatches(list.simulators ?? [], watches), ...(list.emulators ?? [])];
    const { rebooted, attach } = await this.boots.check(this.devices);
    if (rebooted) {
      await this.restartHub();
      return { ...this.pending(), hub: hub(), platforms, simulators: [], errors: [] };
    }
    for (const udid of attach) void this.attach(origin, udid).catch(() => undefined);
    return { status: "ready", hub: hub(origin), platforms, simulators: this.devices.map(summary), errors: hubErrors(list.errors ?? [], host) };
  }

  async boot(id: string): Promise<SimulatorSummary> {
    const origin = this.requireReady();
    const device = await this.find(id);
    const result = await this.call<HubActionResult>(origin, "POST", "/api/devices/boot", { platform: device.platform, id: device.id, name: device.name }, BOOT_TIMEOUT_MS);
    if (!result.ok) throw new HttpError(502, "provider_unavailable", BOOT_FAILURES[bootFailure(result.error)]);
    if (device.platform === "ios") {
      this.boots.attachedBy(device.id);
      await this.attach(origin, device.id).catch(() => undefined);
    }
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
    if (device.platform === "ios") this.boots.forget(device.id);
    await this.state().catch(() => undefined);
    const after = this.devices.find((candidate) => candidate.id === device.id);
    if (after?.booted) throw new HttpError(502, "provider_unavailable", "The simulator did not shut down.");
    return summary(after ?? { ...device, booted: false });
  }

  origin(): string | undefined {
    return this.deps.enabled() ? this.hub.origin() : undefined;
  }

  async detail(id: string): Promise<SimulatorDetail> {
    this.requireReady();
    return readDetail(this.actionDeps, await this.find(id), this.now());
  }

  async action(id: string, action: SimulatorAction): Promise<SimulatorDetail> {
    this.requireReady();
    const device = await this.find(id);
    await runAction(this.actionDeps, device, action);
    return readDetail(this.actionDeps, device, this.now());
  }

  async screenshot(id: string): Promise<Uint8Array> {
    this.requireReady();
    return takeScreenshot(this.actionDeps, await this.find(id));
  }

  agentTools(): WorkerClaim["simulators"] {
    if (!this.deps.enabled() || !this.deps.agentAccess?.()) return undefined;
    const developerDir = this.developerDir ? { developerDir: this.developerDir } : {};
    if (!this.agentDevice.installed()) {
      this.agentDevice.install().catch(() => undefined);
      return developerDir;
    }
    return { binDir: toolBinDir(this.deps.root, AGENT_DEVICE), ...developerDir };
  }

  async sendInput(id: string, events: readonly SimulatorInput[]): Promise<void> {
    const origin = this.requireReady();
    const device = await this.find(id);
    if (device.platform !== "ios") throw new HttpError(400, "invalid_request", "Input reaches only iOS Simulators for now.");
    await this.input.send(origin, device.id, events).catch(() => {
      throw new HttpError(502, "provider_unavailable", "The simulator hub did not take the input.");
    });
  }

  async settingsChanged(settings: SimulatorSettings): Promise<void> {
    this.failure = undefined;
    this.host = undefined;
    if (settings.enabled) {
      this.ensureReady().catch(() => undefined);
      if (settings.agentAccess) this.agentDevice.install().catch(() => undefined);
      return;
    }
    this.devices = [];
    this.boots.reset();
    this.input.closeAll();
    await this.hub.stop();
  }

  stop(): Promise<void> {
    this.input.closeAll();
    return this.hub.stop();
  }

  private attach(origin: string, udid: string): Promise<unknown> {
    return this.call(origin, "POST", "/vendor/serve-sim/grid/api/start", { udid }, LIST_TIMEOUT_MS);
  }

  private restartHub(): Promise<void> {
    this.restarting ??= (async () => {
      this.boots.reset();
      this.input.closeAll();
      await this.hub.stop();
      this.ensureReady().catch(() => undefined);
    })().finally(() => (this.restarting = undefined));
    return this.restarting;
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
        await this.platforms();
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

  private platforms(): Promise<HostPlatforms> {
    const { platform = process.platform, home, exists, list } = this.deps;
    this.host ??= hostPlatforms({ platform, run: this.runner.run.bind(this.runner), env: agentEnv(), ...(home ? { home } : {}), ...(exists ? { exists } : {}), ...(list ? { list } : {}) }).then((host) => {
      this.developerDir = host.developerDir;
      return host;
    });
    return this.host;
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
