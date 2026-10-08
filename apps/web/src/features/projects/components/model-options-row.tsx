"use client";

import type { ProviderDriverKind, ProviderModel } from "@telar/engine-client";
import { choiceOf, type ModelChoice } from "@telar/client/providers";
import { modelOptionsOf, ReasoningControl } from "@/features/composer";
import { Row } from "@/features/settings";

export function ProjectModelOptionsRow({
  driver,
  choice,
  instanceId,
  models,
  onChange,
  status,
  error,
  unavailable,
}: {
  driver: ProviderDriverKind;
  choice: ModelChoice;
  instanceId?: string;
  models?: readonly ProviderModel[];
  onChange: (next: ModelChoice) => void;
  status?: React.ReactNode;
  error?: string;
  unavailable?: string;
}) {
  const offered = modelOptionsOf(models ?? [], choice, driver);
  if (offered.efforts.length === 0 && !offered.fastMode && offered.serviceTiers.length === 0) return null;
  const { model, ...options } = choiceOf(choice);
  const set = Object.keys(options).length > 0;
  return (
    <Row
      keywords={["effort", "reasoning", "fast mode", "per project"]}
      label="Model options"
      hint="New sessions in this project start with this model and these options."
      info="Only the options the chosen model offers are shown. Picking a model that lacks one drops it, and the composer still overrides them for the session in front of you."
      {...(status ? { status } : {})}
      {...(error ? { error } : {})}
      {...(set ? { onRevert: () => onChange(model ? { model } : {}) } : {})}
      control={<ReasoningControl driver={driver} choice={choice} {...(instanceId ? { instanceId } : {})} onChange={onChange} />}
      {...(unavailable ? { unavailable: { reason: unavailable } } : {})}
    />
  );
}
