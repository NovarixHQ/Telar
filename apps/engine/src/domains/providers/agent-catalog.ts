import { z } from "zod";
import type { AgentCatalog, AgentCatalogEntry } from "@telar/engine-client";
import type { Kernel } from "../../platform/kernel";

const AGENT_REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const CACHE_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

const Https = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
});
const Arg = z.string().max(4096);
const Package = { args: z.array(Arg).max(64).optional(), env: z.record(z.string().max(256), Arg).optional() };
const BinaryTarget = z.object({ archive: Https, cmd: Arg, sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(), ...Package });

const RegistryAgent = z.object({
  id: z.string().max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(128).regex(/^(?!\.{1,2}$)[A-Za-z0-9._+-]+$/),
  description: z.string().max(1024).default(""),
  website: Https.optional(),
  distribution: z.object({
    binary: z.record(z.string(), BinaryTarget).optional(),
    npx: z.object({ package: z.string().min(1).max(256), ...Package }).optional(),
    uvx: z.object({ package: z.string().min(1).max(256), ...Package }).optional(),
  }),
});
export type RegistryAgent = z.infer<typeof RegistryAgent>;
export type BinaryTarget = z.infer<typeof BinaryTarget>;

type Cache = { fetchedAt: number; agents: RegistryAgent[] };

export function platformTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform === "win32" ? "windows" : undefined;
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : undefined;
  return os && cpu ? `${os}-${cpu}` : undefined;
}

function parseRegistry(value: unknown): RegistryAgent[] {
  const agents = (value as { agents?: unknown })?.agents;
  return (Array.isArray(agents) ? agents : []).flatMap((agent) => {
    const parsed = RegistryAgent.safeParse(agent);
    return parsed.success ? [parsed.data] : [];
  });
}

function distributionOf(agent: RegistryAgent, target = platformTarget()): AgentCatalogEntry["distribution"] {
  if (target && agent.distribution.binary?.[target]) return "binary";
  if (agent.distribution.npx) return "npm";
  if (agent.distribution.uvx) return "uv";
  return undefined;
}

export class AgentCatalogs {
  constructor(
    private readonly kernel: Kernel,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private get file(): string {
    return this.kernel.paths.agentCatalog;
  }

  async agents(force = false): Promise<{ agents: RegistryAgent[]; fetchedAt?: number; message?: string }> {
    const cached = this.kernel.readDocument(this.file) as Cache | undefined;
    if (!force && cached && this.kernel.now() - cached.fetchedAt < CACHE_MS) return { agents: parseRegistry(cached), fetchedAt: cached.fetchedAt };
    try {
      const response = await this.doFetch(AGENT_REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`the registry answered ${response.status}`);
      const agents = parseRegistry(await response.json());
      const fresh: Cache = { fetchedAt: this.kernel.now(), agents };
      this.kernel.writeDocument(this.file, fresh);
      return { agents, fetchedAt: fresh.fetchedAt };
    } catch (error) {
      const message = `The agent registry could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return cached ? { agents: parseRegistry(cached), fetchedAt: cached.fetchedAt, message } : { agents: [], message };
    }
  }

  async find(id: string): Promise<RegistryAgent | undefined> {
    return (await this.agents()).agents.find((agent) => agent.id === id);
  }

  async catalog(installed: Record<string, { version: string; instanceId: string }>, force = false): Promise<AgentCatalog> {
    const { agents, fetchedAt, message } = await this.agents(force);
    const target = platformTarget();
    return {
      agents: agents.map((agent) => {
        const distribution = distributionOf(agent, target);
        return {
          id: agent.id,
          name: agent.name,
          version: agent.version,
          description: agent.description,
          ...(agent.website ? { website: agent.website } : {}),
          ...(distribution ? { distribution } : {}),
          verified: distribution === "binary" && Boolean(agent.distribution.binary?.[target!]?.sha256),
          ...(installed[agent.id] ? { installed: installed[agent.id] } : {}),
        };
      }),
      ...(fetchedAt ? { fetchedAt } : {}),
      ...(message ? { message } : {}),
    };
  }
}
