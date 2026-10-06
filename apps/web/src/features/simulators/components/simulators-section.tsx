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
  const [error, setError] = useState<{ key: keyof SimulatorSettings; message: string }>();

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
      const key = "enabled" in patch ? "enabled" : "agentAccess";
      setError({ key, message: cause instanceof Error ? cause.message : "The engine refused that change." });
    }
  }, []);

  useRestoreDefaults(() => save({ enabled: DEFAULT_SIMULATOR_SETTINGS.enabled }));

  return (
    <SettingsGroup title="Simulators">
      <Row
        label="Use simulators"
        hint="Lets Telar list, start and stop the simulators on this Mac."
        info="Turning this on downloads a helper the first time and runs it on this Mac only. Turning it off stops the helper; simulators that are running keep running."
        {...(error?.key === "enabled" ? { error: error.message } : {})}
        {...(settings.enabled === DEFAULT_SIMULATOR_SETTINGS.enabled ? {} : { onRevert: () => void save({ enabled: DEFAULT_SIMULATOR_SETTINGS.enabled }) })}
        control={
          <Switch checked={settings.enabled} disabled={loading} onCheckedChange={(next: boolean) => void save({ enabled: next })} aria-label="Use simulators" />
        }
      />
      <Row
        label="Let agents use simulators"
        hint="Agents can open a simulator, look at it and use its apps."
        info="Needs Use simulators. Turning this on downloads the command agents tap and type with. A simulator an agent opens shows in its conversation."
        {...(error?.key === "agentAccess" ? { error: error.message } : {})}
        {...(settings.agentAccess === DEFAULT_SIMULATOR_SETTINGS.agentAccess ? {} : { onRevert: () => void save({ agentAccess: DEFAULT_SIMULATOR_SETTINGS.agentAccess }) })}
        control={
          <Switch
            checked={settings.agentAccess}
            disabled={loading || !settings.enabled}
            onCheckedChange={(next: boolean) => void save({ agentAccess: next })}
            aria-label="Let agents use simulators"
          />
        }
      />
    </SettingsGroup>
  );
}
