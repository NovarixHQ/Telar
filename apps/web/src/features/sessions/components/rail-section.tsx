"use client";

import { usePathname } from "next/navigation";
import { DEFAULT_SIDEBAR_LAYOUT, LOCAL_HOST_ID } from "@telar/engine-client";
import { Switch } from "@/ui/switch";
import { hostFromPathname } from "@/platform/engine/host-client";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";
import { useSidebarLayout } from "../rail/sidebar-layout";
import { useSessionDefaults } from "../session-defaults";
import { SettlingRows } from "./settling-rows";
import { SettledTerminalsRow } from "./settled-terminals-row";

function GroupByProjectRow() {
  const layout = useSidebarLayout();
  const grouped = layout.mode === "grouped";
  useRestoreDefaults(() => layout.setMode(DEFAULT_SIDEBAR_LAYOUT.mode));

  return (
    <Row
      keywords={["group by", "flat", "none", "list", "sidebar", "order", "newest"]}
      label="Group sessions by project"
      hint="Off, the rail is one list, newest first, with spawned sessions under the one that started them."
      {...(layout.mode === DEFAULT_SIDEBAR_LAYOUT.mode ? {} : { onRevert: () => void layout.setMode(DEFAULT_SIDEBAR_LAYOUT.mode) })}
      control={
        <Switch
          checked={grouped}
          disabled={layout.loading}
          onCheckedChange={(next: boolean) => void layout.setMode(next ? "grouped" : "flat")}
          aria-label="Group sessions by project"
        />
      }
    />
  );
}

export function ContinueAfterRestartRow() {
  const { defaults, loading, save, error } = useSessionDefaults();
  useRestoreDefaults(() => save({ resumeAfterRestart: false }));
  const restarts = defaults.resumeAfterRestart === true;

  return (
    <Row
      keywords={["resume", "restart", "update", "continue", "interrupted"]}
      label="Continue after Telar restarts"
      hint="When Telar restarts to update, the sessions it stopped pick up where they left off."
      info="Only a restart to install an update counts; a crash never resumes anything. Each stopped session gets one message saying Telar restarted, marked as automatic. Terminals and runs are not restarted, and a session you stopped or settled is left alone."
      {...(error ? { error } : {})}
      {...(restarts ? { onRevert: () => void save({ resumeAfterRestart: false }) } : {})}
      control={
        <Switch
          aria-label="Continue after Telar restarts"
          checked={restarts}
          onCheckedChange={(resumeAfterRestart) => void save({ resumeAfterRestart })}
          disabled={loading}
        />
      }
    />
  );
}

export function RailSection() {
  const pathname = usePathname();
  return (
    <SettingsGroup title="Rail" scope={hostFromPathname(pathname ?? "/") === LOCAL_HOST_ID ? "mac" : "host"}>
      <GroupByProjectRow />
      <SettlingRows />
      <SettledTerminalsRow />
    </SettingsGroup>
  );
}
