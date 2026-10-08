"use client";

import { useEffect, useState } from "react";
import { CLEANUP_LOG_DAYS, CLEANUP_SETTLED_DAYS, DEFAULT_CLEANUP_POLICY, type CleanupPolicy, type CleanupReport, type CleanupState, type RetentionPolicy } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { fmtAgo, formatBytes, plural } from "@/ui/format";
import { Button } from "@/ui/button";
import { Dropdown, Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";
import { WorktreeSummarySection } from "./worktree-summary-section";
import { WorktreesRootRow } from "./worktrees-root-section";

const api = createEngineApi();

export const FIXED_RULES =
  "Never touched: a worktree with uncommitted changes, unpushed commits, a turn in flight or a running process, or one Telar did not create. The branch and session are always kept.";

type Days = "off" | `${number}`;

function daysOptions(days: readonly number[]): { value: Days; label: string }[] {
  return [{ value: "off", label: "Off" }, ...days.map((day) => ({ value: `${day}` as Days, label: plural(day, "day") }))];
}

export function lastCleanupLabel(last: CleanupReport | undefined, now = Date.now()): string {
  if (!last) return "Never cleaned up";
  const ago = `Last cleanup: ${fmtAgo(last.at, now)}`;
  return last.freedBytes > 0 ? `${ago} · freed ${formatBytes(last.freedBytes)}` : ago;
}

export function runLabel(report: CleanupReport): string {
  const parts = [
    `${report.released} ${report.released === 1 ? "worktree" : "worktrees"} released`,
    `${report.logs} ${report.logs === 1 ? "log" : "logs"} deleted`,
  ];
  if (report.skipped > 0) parts.push(`${report.skipped} skipped`);
  return parts.join(", ");
}

function reason(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function RetentionRow() {
  const [retention, setRetention] = useState<RetentionPolicy>();
  const [retentionError, setRetentionError] = useState<string>();

  useEffect(() => {
    const task = window.setTimeout(() => {
      api
        .retention()
        .then((answer) => setRetention(answer.retention))
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const retentionOff = async () => {
    setRetentionError(undefined);
    try {
      setRetention((await api.setRetention({ idleAfterDays: null })).retention);
    } catch (cause) {
      setRetentionError(reason(cause, "That could not be turned off."));
    }
  };

  if (!retention?.idleAfterDays) return null;
  return (
    <Row
      keywords={["retention", "journal", "export", "retire", "idle"]}
      label="Turn journal retention"
      hint={`Journals of sessions idle ${plural(retention.idleAfterDays, "day")} are moved to ${retention.exportTo ?? "an export folder"}.`}
      {...(retentionError ? { error: retentionError } : {})}
      control={
        <Button size="sm" variant="outline" onClick={() => void retentionOff()}>
          Turn off
        </Button>
      }
    />
  );
}

export function CleanupSection() {
  const [state, setState] = useState<CleanupState>();
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState<{ key: keyof CleanupPolicy | "run"; message: string }>();
  const [rootVersion, setRootVersion] = useState(0);

  useEffect(() => {
    const task = window.setTimeout(() => {
      api
        .cleanup()
        .then((answer) => setState(answer.cleanup))
        .catch((cause) => setError({ key: "run", message: reason(cause, "The engine did not answer.") }));
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const save = async (patch: Partial<CleanupPolicy>) => {
    const key = Object.keys(patch)[0] as keyof CleanupPolicy;
    setError(undefined);
    try {
      setState((await api.setCleanupPolicy(patch)).cleanup);
    } catch (cause) {
      setError({ key, message: reason(cause, "That could not be saved.") });
    }
  };

  useRestoreDefaults(() => save({ ...DEFAULT_CLEANUP_POLICY }));

  const run = async () => {
    setRunning(true);
    setError(undefined);
    try {
      setState((await api.runCleanup()).cleanup);
      setRan(true);
    } catch (cause) {
      setError({ key: "run", message: reason(cause, "The cleanup did not run.") });
    } finally {
      setRunning(false);
    }
  };

  const policy = state?.policy;
  const errorFor = (key: keyof CleanupPolicy) => (error?.key === key ? { error: error.message } : {});
  const busy = running || state?.running === true;

  return (
    <>
      <SettingsGroup title="Worktrees">
        <Row
          keywords={["cleanup", "clean up", "disk", "space", "free", "full", "reclaim", "checkout", "idle", "inactive", "settled", "archived", "old", "days"]}
          label="Remove worktrees"
          hint="Removes a settled or archived session's worktree after this many days; it comes back when you reopen the session."
          info={FIXED_RULES}
          {...errorFor("settledDays")}
          control={
            <Dropdown<Days>
              value={policy?.settledDays ? `${policy.settledDays}` : "off"}
              label="Remove worktrees"
              className="w-28"
              disabled={!policy}
              onChange={(next) => void save({ settledDays: next === "off" ? null : (Number(next) as CleanupPolicy["settledDays"]) })}
              options={daysOptions(CLEANUP_SETTLED_DAYS)}
            />
          }
        />
        <WorktreesRootRow onChanged={() => setRootVersion((version) => version + 1)} />
        <Row
          keywords={["clean up now", "cleanup", "sweep", "free space", "disk", "run"]}
          label="Clean up"
          hint={
            <span role="status">
              {state ? lastCleanupLabel(state.last) : "…"}
              {ran && state?.last ? ` · ${runLabel(state.last)}` : ""}
            </span>
          }
          {...(error?.key === "run" ? { error: error.message } : {})}
          control={
            <Button size="sm" variant="outline" disabled={!state || busy} onClick={() => void run()}>
              {busy ? "Cleaning up…" : "Clean up now"}
            </Button>
          }
        />
      </SettingsGroup>

      <WorktreeSummarySection version={rootVersion} />

      <SettingsGroup title="Logs">
        <Row
          keywords={["cleanup", "clean up", "disk", "space", "logs", "rotate", "days"]}
          label="Delete old logs"
          hint="Rotated logs only."
          {...errorFor("logsDays")}
          control={
            <Dropdown<Days>
              value={policy?.logsDays ? `${policy.logsDays}` : "off"}
              label="Delete old logs"
              className="w-28"
              disabled={!policy}
              onChange={(next) => void save({ logsDays: next === "off" ? null : (Number(next) as CleanupPolicy["logsDays"]) })}
              options={daysOptions(CLEANUP_LOG_DAYS)}
            />
          }
        />
        <RetentionRow />
      </SettingsGroup>

    </>
  );
}
