"use client";

import { DEFAULT_TEXT_GEN_POLICY, type TextGenEffort } from "@telar/engine-client";
import { ModelChoiceControl } from "@/features/composer";
import { useTextGenPolicy } from "../text-gen-policy";
import { Row, SettingsGroup, ToggleRow, useRestoreDefaults } from "@/features/settings";

const DEFAULT_WRITER = { driver: DEFAULT_TEXT_GEN_POLICY.driver, model: DEFAULT_TEXT_GEN_POLICY.model ?? null, effort: null };

export function TextGenSection() {
  const { policy, loading, error, save } = useTextGenPolicy();

  useRestoreDefaults(async () => {
    await save({ driver: DEFAULT_TEXT_GEN_POLICY.driver, titles: DEFAULT_TEXT_GEN_POLICY.titles, renameBranches: DEFAULT_TEXT_GEN_POLICY.renameBranches });
    await save({ model: DEFAULT_WRITER.model, effort: null });
  });

  const atDefault = policy.driver === DEFAULT_TEXT_GEN_POLICY.driver && policy.model === DEFAULT_TEXT_GEN_POLICY.model && policy.effort === undefined;

  return (
    <SettingsGroup title="Text generation" scope="mac">
      <Row
        keywords={["claude", "codex", "opencode", "driver", "title model", "textgen", "reasoning", "thinking", "effort"]}
        label="Written by"
        hint="The provider, model and effort that name sessions and branches."
        {...(error ? { error } : {})}
        {...(atDefault ? {} : { onRevert: () => void save(DEFAULT_WRITER) })}
        control={
          loading ? null : (
            <ModelChoiceControl
              driver={policy.driver}
              choice={{ ...(policy.model ? { model: policy.model } : {}), ...(policy.effort ? { effort: policy.effort } : {}) }}
              onChange={(driver, next) =>
                void save({ driver, model: next.model ?? null, effort: (next.effort as TextGenEffort | undefined) ?? null })
              }
            />
          )
        }
      />
      <ToggleRow
        keywords={["title", "rename", "automatic"]}
        label="Name sessions"
        checked={policy.titles}
        onCheckedChange={(next) => void save({ titles: next })}
        {...(policy.titles === DEFAULT_TEXT_GEN_POLICY.titles
          ? {}
          : { onRevert: () => void save({ titles: DEFAULT_TEXT_GEN_POLICY.titles }) })}
      />
      <ToggleRow
        keywords={["git", "branch name", "title", "rename branches"]}
        label="Name branches"
        hint="Renames branches the engine cut to match the session. Yours keep their names."
        checked={policy.renameBranches}
        onCheckedChange={(next) => void save({ renameBranches: next })}
        {...(policy.titles ? {} : { unavailable: { reason: "Needs Name sessions." } })}
        {...(policy.renameBranches === DEFAULT_TEXT_GEN_POLICY.renameBranches
          ? {}
          : { onRevert: () => void save({ renameBranches: DEFAULT_TEXT_GEN_POLICY.renameBranches }) })}
      />
    </SettingsGroup>
  );
}
