"use client";

import { useMemo, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import type { SimulatorSummary } from "@telar/engine-client";
import { Button } from "@/ui/button";
import { cn } from "@/ui/utils";
import { createSimulatorsApi, type SimulatorsApi } from "../api";
import { dockSimulator, floatKey, floatSimulator, useSimulatorFloat } from "../float";
import { useSimulators } from "../hooks/use-simulators";
import { openSimulators } from "../tabs";
import { SimulatorIcon, SimulatorList } from "./simulator-list";
import { SimulatorSettings } from "./simulator-settings";
import { SimulatorView } from "./simulator-view";

type SurfaceProps = {
  hostId?: string;
  sessionId?: string;
  visible: boolean;
  params?: Readonly<Record<string, string>>;
  onParams?: (params: Record<string, string>) => void;
  api?: SimulatorsApi;
};

const LIST = "";

function FloatingElsewhere({ name, onDock }: { name: string; onDock: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-xs text-muted-foreground">
      <p>{name} is floating over the chat.</p>
      <Button size="xs" variant="outline" onClick={onDock}>
        Open in right panel
      </Button>
    </div>
  );
}

export function SimulatorSurface({ hostId, sessionId, visible, params, onParams, api: injected }: SurfaceProps) {
  const api = useMemo(() => injected ?? createSimulatorsApi(hostId), [injected, hostId]);
  const { state, error, refresh } = useSimulators(api, visible);
  const [local, setLocal] = useState<Readonly<Record<string, string>>>(() => params ?? {});
  const shown = onParams ? (params ?? {}) : local;
  const open = openSimulators(shown);
  const active = shown.active ?? LIST;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [failure, setFailure] = useState<string>();

  const remember = (nextOpen: string[], nextActive: string) => {
    const next = { open: nextOpen.join(","), active: nextActive };
    if (onParams) onParams(next);
    else setLocal(next);
  };
  const show = (id: string) => remember(open.includes(id) ? open : [...open, id], id);
  const close = (id: string) => remember(open.filter((entry) => entry !== id), active === id ? LIST : active);
  const simulators = state?.simulators ?? [];
  const named = (id: string) => simulators.find((simulator) => simulator.id === id);
  const current = active === LIST ? undefined : named(active);
  const float = sessionId ? floatKey(hostId, sessionId) : undefined;
  const floating = useSimulatorFloat(float).simulator;

  const attempt = async (work: () => Promise<void>) => {
    try {
      await work();
      setFailure(undefined);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "The simulator did not answer.");
    }
  };
  const start = (simulator: SimulatorSummary) =>
    attempt(async () => {
      const { simulator: booted } = await api.bootSimulator(simulator.id);
      await refresh();
      show(booted.id);
    });
  const shutdown = (simulator: SimulatorSummary) =>
    attempt(async () => {
      await api.shutdownSimulator(simulator.id);
      await refresh();
      if (open.includes(simulator.id)) close(simulator.id);
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Simulators" className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1">
        {open.map((id) => (
          <span key={id} className={cn("flex items-center gap-1 rounded-md pr-1 text-xs hover:bg-muted", active === id && "bg-muted")}>
            <button type="button" role="tab" aria-selected={active === id} onClick={() => remember(open, id)} className="flex min-w-0 items-center gap-1.5 py-1 pl-2">
              <SimulatorIcon simulator={named(id)} className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-32 truncate">{named(id)?.name ?? "Simulator"}</span>
            </button>
            <button type="button" aria-label={`Close ${named(id)?.name ?? "simulator"}`} onClick={() => close(id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <button type="button" role="tab" aria-selected={active === LIST} aria-label="All simulators" onClick={() => remember(open, LIST)} className={cn("flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-muted", active === LIST && "bg-muted text-foreground")}>
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      {failure && <p role="alert" className="border-b border-border px-3 py-1.5 text-2xs text-destructive">{failure}</p>}
      <div className="flex min-h-0 flex-1">
        {current?.booted && state?.status === "ready" ? (
          <>
            {float && floating?.id === current.id ? (
              <FloatingElsewhere name={current.name} onDock={() => dockSimulator(float)} />
            ) : (
              <div className="min-w-0 flex-1">
                <SimulatorView
                  key={current.id}
                  simulator={current}
                  api={api}
                  {...(hostId ? { hostId } : {})}
                  visible={visible}
                  docked={{
                    settingsOpen,
                    onToggleSettings: () => setSettingsOpen((value) => !value),
                    onPowerOff: () => shutdown(current),
                    ...(float ? { onFloat: () => floatSimulator(float, current) } : {}),
                  }}
                />
              </div>
            )}
            {settingsOpen && <SimulatorSettings key={current.id} simulator={current} api={api} visible={visible} onClose={() => setSettingsOpen(false)} />}
          </>
        ) : (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <SimulatorList
              state={state}
              error={error}
              onTurnOn={() => attempt(async () => {
                await api.setSimulatorSettings({ enabled: true });
                await refresh();
              })}
              onRetry={() => void refresh()}
              onOpen={(simulator) => show(simulator.id)}
              onStart={start}
              onShutdown={shutdown}
            />
          </div>
        )}
      </div>
    </div>
  );
}
