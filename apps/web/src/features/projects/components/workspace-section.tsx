"use client";

import type { ReactNode } from "react";
import { LayersIcon } from "lucide-react";
import {
  DEFAULT_DETACHED_RUNTIME_MODE,
  DEFAULT_SESSION_DEFAULTS,
  defaultInstanceIdForDriver,
  type EnvMode,
  type RuntimeMode,
  type WhileWorking,
} from "@telar/engine-client";
import { useSessionDefaults } from "@/features/sessions";
import { projectDraftModel, RUNTIME_MODE_HELP, RUNTIME_MODE_LABELS, RUNTIME_MODES, sessionModelSelection } from "@telar/client/providers";
import { ModelChoiceControl } from "@/features/composer";
import { Dropdown, Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";

export function WorkspaceSection({ children }: { children?: ReactNode }) {
  const { defaults, loading, save, error } = useSessionDefaults();
  useRestoreDefaults(() => save({ envMode: DEFAULT_SESSION_DEFAULTS.envMode, whileWorking: "steer", runtimeMode: null, defaultModel: null }));
  const whileWorking = defaults.whileWorking ?? "steer";
  const access = defaults.runtimeMode ?? DEFAULT_DETACHED_RUNTIME_MODE;
  const model = projectDraftModel(defaults.defaultModel);

  return (
    <SettingsGroup title="New sessions" scope="mac">
      <Row
        keywords={["provider", "default model", "effort", "reasoning", "fast mode", "claude", "codex", "opencode"]}
        label="Model"
        status={
          <span title="A project can override this" aria-label="A project can override this" className="flex text-muted-foreground/70">
            <LayersIcon className="size-3" />
          </span>
        }
        hint="The provider, model and options a new session starts with."
        info="A project's own default model wins over this one, and the composer still changes the session in front of you."
        {...(error ? { error } : {})}
        {...(defaults.defaultModel ? { onRevert: () => void save({ defaultModel: null }) } : {})}
        control={
          loading ? null : (
            <ModelChoiceControl
              driver={model?.driver ?? "claude"}
              choice={model?.choice ?? {}}
              onChange={(driver, next) => void save({ defaultModel: sessionModelSelection(defaultInstanceIdForDriver(driver), next) ?? null })}
            />
          )
        }
      />
      <Row
        keywords={["permissions", "supervised", "auto", "full access", "approval", "runtime mode", "prompts"]}
        label="Access level"
        hint={`${RUNTIME_MODE_HELP[access]}. A session can still change its own.`}
        {...(defaults.runtimeMode === undefined ? {} : { onRevert: () => void save({ runtimeMode: null }) })}
        control={
          loading ? null : (
            <Dropdown<RuntimeMode>
              value={access}
              label="Access level"
              onChange={(next) => void save({ runtimeMode: next })}
              options={RUNTIME_MODES.map((mode) => ({ value: mode, label: RUNTIME_MODE_LABELS[mode] }))}
            />
          )
        }
      />
      <Row
        keywords={["worktree", "branch", "git", "isolation"]}
        label="Workspace"
        hint={
          defaults.envMode === "worktree"
            ? "Each session gets its own checkout and branch, so two can edit the repo at once. A project without git falls back to the project checkout."
            : "Sessions share the project's checkout. Two at once will collide."
        }
        {...(defaults.envMode === DEFAULT_SESSION_DEFAULTS.envMode
          ? {}
          : { onRevert: () => void save({ envMode: DEFAULT_SESSION_DEFAULTS.envMode }) })}
        control={
          loading ? null : (
            <Dropdown<EnvMode>
              value={defaults.envMode}
              label="Workspace"
              onChange={(next) => void save({ envMode: next })}
              options={[
                { value: "local", label: "Project checkout" },
                { value: "worktree", label: "Own worktree" },
              ]}
            />
          )
        }
      />
      <Row
        keywords={["queue", "steer", "follow-up", "busy", "running", "interrupt", "send"]}
        label="While an agent is working"
        hint={
          whileWorking === "queue"
            ? "A message you send waits above the composer and goes when the turn ends."
            : "A message you send joins the turn that is running."
        }
        info="Waiting messages can be edited, reordered, removed or sent into the running turn at once."
        {...(whileWorking === "steer" ? {} : { onRevert: () => void save({ whileWorking: "steer" }) })}
        control={
          loading ? null : (
            <Dropdown<WhileWorking>
              value={whileWorking}
              label="While an agent is working"
              onChange={(next) => void save({ whileWorking: next })}
              options={[
                { value: "steer", label: "Steer the turn" },
                { value: "queue", label: "Queue for after" },
              ]}
            />
          )
        }
      />
      {children}
    </SettingsGroup>
  );
}
