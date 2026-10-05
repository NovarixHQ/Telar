"use client";

import { DEFAULT_SIDEBAR_LAYOUT } from "@telar/engine-client";
import { Switch } from "@/ui/switch";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";
import { useSidebarLayout } from "../rail/sidebar-layout";

export function RailSection() {
  const layout = useSidebarLayout();
  const grouped = layout.mode === "grouped";
  useRestoreDefaults(() => layout.setMode(DEFAULT_SIDEBAR_LAYOUT.mode));

  return (
    <SettingsGroup title="Rail" scope="mac">
      <Row
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
    </SettingsGroup>
  );
}
