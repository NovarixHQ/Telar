"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { Row, Segmented, SettingsGroup, useRestoreDefaults } from "@/features/settings";

const api = createEngineApi();

type Who = "off" | "you" | "agents";

const PATCH: Record<Who, SimulatorSettings> = {
  off: { enabled: false, agentAccess: false },
  you: { enabled: true, agentAccess: false },
  agents: { enabled: true, agentAccess: true },
};

function whoOf(settings: SimulatorSettings): Who {
  if (!settings.enabled) return "off";
  return settings.agentAccess ? "agents" : "you";
}

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

  const save = useCallback(async (who: Who) => {
    try {
      setSettings((await api.setSimulatorSettings(PATCH[who])).simulatorSettings);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The engine refused that change.");
    }
  }, []);

  const fallback = whoOf(DEFAULT_SIMULATOR_SETTINGS);
  const who = whoOf(settings);
  useRestoreDefaults(() => save(fallback));

  return (
    <SettingsGroup title="Simulators">
      <Row
        label="Simulators"
        hint="Who may list, start and use the simulators on this Mac."
        info="Turning them on downloads a helper the first time and runs it on this Mac only; letting agents in also downloads the command they tap and type with. Turning them off stops the helper, and simulators that are running keep running."
        {...(error ? { error } : {})}
        {...(who === fallback ? {} : { onRevert: () => void save(fallback) })}
        control={
          <div inert={loading ? true : undefined}>
            <Segmented<Who>
              value={who}
              onChange={(next) => void save(next)}
              options={[
                { value: "off", label: "Off" },
                { value: "you", label: "You" },
                { value: "agents", label: "You and agents" },
              ]}
            />
          </div>
        }
      />
    </SettingsGroup>
  );
}
