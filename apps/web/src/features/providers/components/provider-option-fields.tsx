"use client";

import { useState } from "react";
import type { ProviderInstance, UsageLimitWindow } from "@telar/engine-client";
import { createEngineApi, EngineApiError } from "@/platform/engine";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { BlurInput } from "./provider-instance-fields";
import type { InstancePatch } from "./provider-instance-card";

const api = createEngineApi();

export function ExtraArgsField({ instance, onPatch }: { instance: ProviderInstance; onPatch: (patch: InstancePatch) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground">Extra CLI arguments</span>
      <BlurInput
        key={instance.extraArgs ?? ""}
        value={instance.extraArgs ?? ""}
        onCommit={(next) => onPatch({ extraArgs: next.trim() || null })}
        placeholder="--flag value"
        className="mt-1.5 h-8 font-mono text-xs"
        spellCheck={false}
        autoComplete="off"
      />
      <span className="mt-1 block text-2xs text-muted-foreground">Added to every launch of this login, quoted as in a shell.</span>
    </label>
  );
}

const limitsSummary = (windows: readonly UsageLimitWindow[]): string =>
  windows.length === 0 ? "No limits reported" : windows.map((window) => `${window.label}: ${Math.round(window.usedPercent)}%`).join(" · ");

export function UsageLimitsField({ instance }: { instance: ProviderInstance }) {
  const [state, setState] = useState<{ reading: boolean; summary?: string; error?: string }>({ reading: false });
  const read = async () => {
    setState({ reading: true });
    try {
      setState({ reading: false, summary: limitsSummary((await api.providerLimits(instance.id)).windows) });
    } catch (cause) {
      setState({ reading: false, error: cause instanceof EngineApiError ? cause.message : "The limits could not be read." });
    }
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="block text-xs font-medium text-foreground">Usage limits</span>
        <span className={state.error ? "block text-2xs text-destructive" : "block text-2xs text-muted-foreground"}>
          {state.error ?? state.summary ?? "How much of this plan's windows is used."}
        </span>
      </div>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={state.reading} onClick={() => void read()}>
        {state.reading ? <Spinner /> : state.summary ? "Refresh" : "Show"}
      </Button>
    </div>
  );
}
