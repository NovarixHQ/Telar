import path from "node:path";
import { ACP_DRIVER } from "@telar/engine-client";
import { HttpError } from "../../platform/http/http";
import { ok, type Route } from "../../platform/http/route";
import { quoteCliArgs } from "../../platform/process/cli-args";
import type { EngineStore } from "../../state";
import { AgentCatalogs } from "./agent-catalog";
import { installAgent, type InstallDeps } from "./agent-install";

export type AgentRouteDeps = InstallDeps;

type Installed = Record<string, { version: string; instanceId: string }>;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function agentRoutes(store: EngineStore, deps: AgentRouteDeps = {}): Route[] {
  const catalogs = new AgentCatalogs(store.kernel, deps.fetch);
  const installedFile = () => path.join(store.kernel.paths.agents, "installed.json");
  const installed = (): Installed => (store.kernel.readDocument(installedFile()) as Installed | undefined) ?? {};
  return [
    {
      method: "GET",
      path: "/v2/agent-catalog",
      auth: "engine",
      handle: async ({ query }) => ok(await catalogs.catalog(installed(), query.get("refresh") === "1")),
    },
    {
      method: "POST",
      path: /^\/v2\/agent-catalog\/([a-z0-9][a-z0-9._-]*)\/install$/,
      auth: "engine",
      body: "raw",
      async handle({ params }) {
        const agent = await catalogs.find(params[0]!);
        if (!agent) throw new HttpError(404, "not_found", `the registry lists no agent ${params[0]}`);
        let result;
        try {
          result = await installAgent(store.kernel.paths.agents, agent, deps);
        } catch (error) {
          throw new HttpError(502, "provider_unavailable", `${agent.name} could not be installed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const instanceId = `agent_${agent.id.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
        const { instance } = store.providers.save({
          id: instanceId,
          driver: ACP_DRIVER,
          displayName: agent.name,
          binaryPath: result.command,
          extraArgs: result.args.length > 0 ? quoteCliArgs(result.args) : null,
          env: Object.entries(result.env).flatMap(([name, value]) => (ENV_NAME.test(name) ? [{ name, value, sensitive: false }] : [])),
        });
        store.kernel.writeDocument(installedFile(), { ...installed(), [agent.id]: { version: agent.version, instanceId } });
        return ok({ providerInstance: instance });
      },
    },
  ];
}
