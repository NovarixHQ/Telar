import fs from "node:fs";
import path from "node:path";
import { statePaths } from "../../platform/fs/state-paths";

function sizeOf(target: string): { bytes: number; files: number } {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return { bytes: 0, files: 0 };
  }
  if (!stat.isDirectory()) return { bytes: stat.size, files: 1 };
  let bytes = 0;
  let files = 0;
  let names: string[];
  try {
    names = fs.readdirSync(target);
  } catch {
    return { bytes, files };
  }
  for (const name of names) {
    const inner = sizeOf(path.join(target, name));
    bytes += inner.bytes;
    files += inner.files;
  }
  return { bytes, files };
}

type SweptPath = { what: string; bytes: number; files: number };

export type DecommissionSweep = {
  removed: SweptPath[];
  why: string;
};

/** Deletes each target, then writes `marker` so later starts skip it; a target that will not go is retried next start. */
function sweepOnce(engineRoot: string, marker: string, why: string, targets: { what: string; path: string }[]): DecommissionSweep {
  if (fs.existsSync(marker)) return { removed: [], why };
  const removed: SweptPath[] = [];
  let failed = false;
  for (const target of targets) {
    if (!fs.existsSync(target.path)) continue;
    const { bytes, files } = sizeOf(target.path);
    try {
      fs.rmSync(target.path, { recursive: true, force: true });
      removed.push({ what: target.what, bytes, files });
    } catch {
      failed = true;
    }
  }
  if (!failed) {
    try {
      fs.mkdirSync(engineRoot, { recursive: true });
      fs.writeFileSync(marker, `${new Date().toISOString()}\n`, "utf8");
    } catch {
    }
  }
  return { removed, why };
}

export function sweepSpoolAndLooms(engineRoot: string): DecommissionSweep {
  const resolved = path.resolve(engineRoot);
  return sweepOnce(resolved, statePaths(resolved).decommissionMarker, "the Spool and the Looms are decommissioned (#501)", [
    { what: "the Spool's store", path: path.join(resolved, "spool") },
    { what: "the Looms", path: path.join(path.dirname(resolved), "looms") },
  ]);
}

export function sweepNotes(engineRoot: string): DecommissionSweep {
  const paths = statePaths(path.resolve(engineRoot));
  return sweepOnce(paths.root, paths.notesRemovedMarker, "project notes were removed from Telar", [
    { what: "the project notes", path: path.join(paths.root, "notes") },
    { what: "the notes socket's secret", path: path.join(paths.root, "notes-mcp-secret.json") },
  ]);
}

export function sweepReport(sweep: DecommissionSweep): string | undefined {
  if (sweep.removed.length === 0) return undefined;
  const parts = sweep.removed.map(({ what, bytes, files }) => {
    const size = bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`;
    return `${what} (${files.toLocaleString("en-US")} ${files === 1 ? "file" : "files"}, ${size})`;
  });
  return `Telar engine: removed ${parts.join(" and ")} — ${sweep.why}`;
}

export type AgentRetirement =
  | { moved: true; to: string }
  | { moved: false }
  | { moved: false; failed: string };

function stampOf(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}

export function retireAgentStore(engineRoot: string, now: () => number = Date.now): AgentRetirement {
  const paths = statePaths(path.resolve(engineRoot));
  try {
    if (fs.existsSync(paths.agentRetiredMarker)) return { moved: false };
    const source = path.join(paths.root, "agent");
    let result: AgentRetirement = { moved: false };
    if (fs.existsSync(source)) {
      fs.mkdirSync(paths.retired, { recursive: true });
      let target = path.join(paths.retired, `agent-${stampOf(now())}`);
      for (let n = 1; fs.existsSync(target); n += 1) target = path.join(paths.retired, `agent-${stampOf(now())}-${n}`);
      fs.renameSync(source, target);
      result = { moved: true, to: target };
    }
    try {
      fs.writeFileSync(paths.agentRetiredMarker, `${new Date(now()).toISOString()}\n`, "utf8");
    } catch {
    }
    return result;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return { moved: false, failed: code ?? (error instanceof Error ? error.message : String(error)) };
  }
}

export function retireAgentReport(retirement: AgentRetirement): string | undefined {
  if (retirement.moved) {
    return `Telar engine: moved the built-in Agent's data to ${retirement.to} — the Agent was removed (#908); nothing was deleted`;
  }
  if ("failed" in retirement) {
    return `Telar engine: could not move the built-in Agent's data out of agent/ (${retirement.failed}); it is untouched and will be retried on the next start`;
  }
  return undefined;
}
