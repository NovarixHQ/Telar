"use client";

import { useRef, useState } from "react";
import type { ProviderDriverKind } from "@telar/engine-client";
import type { ModelChoice } from "@telar/client/providers";
import { AgentControl } from "./agent-control";
import { ReasoningControl } from "./reasoning-control";

export function ModelChoiceControl({
  driver,
  choice,
  instanceId,
  onChange,
}: {
  driver: ProviderDriverKind;
  choice: ModelChoice;
  instanceId?: string;
  onChange: (driver: ProviderDriverKind, next: ModelChoice) => void;
}) {
  const [picked, setPicked] = useState<ProviderDriverKind>();
  const pending = useRef<ProviderDriverKind | undefined>(undefined);
  const shown = picked ?? driver;
  const stored = shown === driver;
  const login = stored && instanceId ? { instanceId } : {};
  const shownChoice = stored ? choice : {};
  const change = (next: ModelChoice) => {
    const target = pending.current ?? shown;
    pending.current = undefined;
    onChange(target, next);
  };
  const switchDriver = (next: ProviderDriverKind) => {
    pending.current = next;
    setPicked(next === driver ? undefined : next);
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <AgentControl driver={shown} choice={shownChoice} {...login} onChange={change} onDriverChange={switchDriver} />
      <ReasoningControl driver={shown} choice={shownChoice} {...login} onChange={change} />
    </div>
  );
}
