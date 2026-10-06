"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { Switch } from "@/ui/switch";
import { Row, SettingsGroup, useRestoreDefaults } from "@/features/settings";

const api = createEngineApi();

export function SimulatorsSection() {
  const [settings, setSettings] = useState<SimulatorSettings>(DEFAULT_SIMULATOR_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void api
      .simulatorSettings()
      .then((answer) => setSettings(answer.simulatorSettings))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (patch: Partial<SimulatorSettings>) => {
    try {
      setSettings((await api.setSimulatorSettings(patch)).simulatorSettings);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The engine refused that change.");
    }
  }, []);

  useRestoreDefaults(() => save({ enabled: DEFAULT_SIMULATOR_SETTINGS.enabled }));

  return (
    <SettingsGroup title="Simulators">
      <Row
        label="Use simulators"
        hint="Lets Telar list, start and stop the simulators on this Mac."
        info="Turning this on downloads a helper the first time and runs it on this Mac only. Turning it off stops the helper; simulators that are running keep running."
        {...(error ? { error } : {})}
        {...(settings.enabled === DEFAULT_SIMULATOR_SETTINGS.enabled ? {} : { onRevert: () => void save({ enabled: DEFAULT_SIMULATOR_SETTINGS.enabled }) })}
        control={
          <Switch checked={settings.enabled} disabled={loading} onCheckedChange={(next: boolean) => void save({ enabled: next })} aria-label="Use simulators" />
        }
      />
    </SettingsGroup>
  );
}
