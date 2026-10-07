"use client";

import { DEFAULT_TEXT_GEN_POLICY } from "@telar/engine-client";
import { SettingsGroup, ToggleRow, useRestoreDefaults } from "@/features/settings";
import { useTextGenPolicy } from "../text-gen-policy";

export function RenameBranchesSection() {
  const { policy, error, save } = useTextGenPolicy();
  useRestoreDefaults(() => save({ renameBranches: DEFAULT_TEXT_GEN_POLICY.renameBranches }));

  return (
    <SettingsGroup title="Branches">
      <ToggleRow
        label="Rename branches to match"
        hint="Only branches the engine cut. Yours keep their names."
        checked={policy.renameBranches}
        onCheckedChange={(next) => void save({ renameBranches: next })}
        {...(error ? { error } : {})}
        {...(policy.titles ? {} : { unavailable: { reason: "Needs Name sessions, in General." } })}
        {...(policy.renameBranches === DEFAULT_TEXT_GEN_POLICY.renameBranches
          ? {}
          : { onRevert: () => void save({ renameBranches: DEFAULT_TEXT_GEN_POLICY.renameBranches }) })}
      />
    </SettingsGroup>
  );
}
