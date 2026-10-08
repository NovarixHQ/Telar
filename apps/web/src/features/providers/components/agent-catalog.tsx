"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCwIcon } from "lucide-react";
import type { AgentCatalog as Catalog, AgentCatalogEntry } from "@telar/engine-client";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { Row, SettingsGroup } from "@/features/settings/components/settings-shell";

const api = createEngineApi();

const HOW: Record<NonNullable<AgentCatalogEntry["distribution"]>, string> = { binary: "Download", npm: "npm package", uv: "Python package" };

function packaging(agent: AgentCatalogEntry): string {
  if (!agent.distribution) return "Nothing to install on this Mac";
  return [`v${agent.version}`, HOW[agent.distribution], agent.verified ? "checksum verified" : undefined].filter(Boolean).join(" · ");
}

export function AgentCatalog({ onInstalled }: { onInstalled: (instanceId: string) => void }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setCatalog(await api.agentCatalog(refresh ? { refresh: true } : {}));
    } catch (cause) {
      setCatalog({ agents: [], message: cause instanceof EngineApiError ? cause.message : "The catalog could not be read." });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const install = async (agent: AgentCatalogEntry) => {
    setInstalling(agent.id);
    setErrors(({ [agent.id]: _, ...rest }) => rest);
    try {
      const { providerInstance } = await api.installAgent(agent.id);
      onInstalled(providerInstance.id);
      await load();
    } catch (cause) {
      setErrors((current) => ({ ...current, [agent.id]: cause instanceof EngineApiError ? cause.message : "The install failed." }));
    }
    setInstalling(undefined);
  };

  return (
    <SettingsGroup
      title="Agent catalog"
      description="Install an agent as a new login. Telar keeps the version you installed until you install again."
      action={
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load(true)} aria-label="Refresh the catalog">
          <RotateCwIcon className={loading ? "animate-spin" : ""} />
        </Button>
      }
    >
      {catalog?.message && <p className="py-2 text-xs text-destructive">{catalog.message}</p>}
      {!catalog && <Spinner />}
      {catalog?.agents.map((agent) => {
        const current = agent.installed?.version === agent.version;
        return (
          <Row
            key={agent.id}
            label={agent.name}
            hint={[agent.description, packaging(agent)].filter(Boolean).join(" — ")}
            {...(errors[agent.id] ? { error: errors[agent.id] } : {})}
            control={
              current ? (
                <Badge variant="outline">Installed</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={!agent.distribution || installing !== undefined} onClick={() => void install(agent)}>
                  {installing === agent.id ? <Spinner /> : agent.installed ? `Install v${agent.version}` : "Install"}
                </Button>
              )
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
