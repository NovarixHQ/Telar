"use client";

import type { DelegationMode } from "@telar/engine-client";
import { Dropdown, Row, useRestoreDefaults } from "@/features/settings";
import { useSessionDefaults } from "../session-defaults";

const DEFAULT_MODE: DelegationMode = "normal";

const MODES: { value: DelegationMode; label: string; hint: string }[] = [
  { value: "conservative", label: "Conservative", hint: "Sessions an agent starts run on a mid-priced model at medium effort or less." },
  { value: "normal", label: "Normal", hint: "Sessions an agent starts default to a mid-priced model, and may use a top model for design or debugging." },
  { value: "aggressive", label: "Aggressive", hint: "Sessions an agent starts run on your default model, or any model the agent picks." },
];

export function DelegationRow() {
  const { defaults, loading, save, error } = useSessionDefaults();
  useRestoreDefaults(() => save({ delegationMode: DEFAULT_MODE }));
  const mode = defaults.delegationMode ?? DEFAULT_MODE;

  return (
    <Row
      keywords={["delegation", "builders", "orchestrate", "cost", "quota", "limit", "cheaper", "tier", "effort"]}
      label="Delegation"
      hint={MODES.find((entry) => entry.value === mode)!.hint}
      info="Only sessions an agent starts are limited, never your own, and they stay on the provider they were given. Naming a model in your message lets the agent use it. A model whose cost is unknown is not limited."
      {...(error ? { error } : {})}
      {...(mode === DEFAULT_MODE ? {} : { onRevert: () => void save({ delegationMode: DEFAULT_MODE }) })}
      control={
        loading ? null : (
          <Dropdown<DelegationMode>
            value={mode}
            label="Delegation"
            onChange={(next) => void save({ delegationMode: next })}
            options={MODES.map(({ value, label }) => ({ value, label }))}
          />
        )
      }
    />
  );
}
