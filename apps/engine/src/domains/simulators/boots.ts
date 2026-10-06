import type { SimulatorSummary } from "@telar/engine-client";
import type { ProcessRunner } from "../../platform/process/runner";

const LAUNCHD_SIM = /^\s*(\d+)\s+launchd_sim\s.*\/Devices\/([0-9A-F-]{36})\//i;

async function launchdSimPids(run: ProcessRunner["run"]): Promise<Map<string, number>> {
  const { stdout } = await run("ps", ["-axo", "pid=,args="], { timeoutMs: 5_000 });
  const markers = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const match = LAUNCHD_SIM.exec(line);
    if (match) markers.set(match[2]!.toUpperCase(), Number(match[1]));
  }
  return markers;
}

export class BootWatch {
  private readonly boots = new Map<string, number>();
  private readonly attached = new Set<string>();

  constructor(private readonly run: ProcessRunner["run"]) {}

  async check(devices: readonly SimulatorSummary[]): Promise<{ rebooted: boolean; attach: string[] }> {
    const booted = devices.filter((device) => device.platform === "ios" && device.booted && !device.physical);
    if (booted.length === 0) return { rebooted: false, attach: [] };
    const markers = await launchdSimPids(this.run).catch(() => new Map<string, number>());
    let rebooted = false;
    for (const { id } of booted) {
      const marker = markers.get(id.toUpperCase());
      if (marker === undefined) continue;
      const seen = this.boots.get(id);
      if (seen !== undefined && seen !== marker) rebooted = true;
      this.boots.set(id, marker);
    }
    if (rebooted) return { rebooted, attach: [] };
    const attach = booted.map(({ id }) => id).filter((id) => !this.attached.has(id));
    for (const id of attach) this.attached.add(id);
    return { rebooted, attach };
  }

  attachedBy(id: string): void {
    this.attached.add(id);
  }

  forget(id: string): void {
    this.boots.delete(id);
    this.attached.delete(id);
  }

  reset(): void {
    this.boots.clear();
    this.attached.clear();
  }
}
