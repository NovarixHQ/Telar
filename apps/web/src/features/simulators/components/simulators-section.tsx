"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SIMULATOR_SETTINGS, type SimulatorSettings } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { Spinner } from "@/ui/spinner";
import { ToggleRow, useRestoreDefaults } from "@/features/settings";

const api = createEngineApi();

type Pending = "hub" | "agents";

export function SimulatorsRows() {
  const [settings, setSettings] = useState<SimulatorSettings>(DEFAULT_SIMULATOR_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState<{ at: Pending; message: string }>();

  useEffect(() => {
    void api
      .simulatorSettings()
      .then((answer) => setSettings(answer.simulatorSettings))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (at: Pending, patch: Partial<SimulatorSettings>) => {
    setPending(at);
    try {
      setSettings((await api.setSimulatorSettings(patch)).simulatorSettings);
      setError(undefined);
    } catch (cause) {
      setError({ at, message: cause instanceof Error ? cause.message : "The engine refused that change." });
    } finally {
      setPending(undefined);
    }
  }, []);

  const busy = !loaded || pending !== undefined;
  const setHub = (enabled: boolean) => !busy && save("hub", enabled ? { enabled } : { enabled, agentAccess: false });
  const setAgents = (agentAccess: boolean) => !busy && save("agents", { agentAccess });
  useRestoreDefaults(() => save("hub", DEFAULT_SIMULATOR_SETTINGS));

  const status = (at: Pending) => (pending === at ? { status: <Spinner className="size-4" /> } : {});
  const failure = (at: Pending) => (error?.at === at ? { error: error.message } : {});

  return (
    <>
      <ToggleRow
        keywords={["simulator", "emulator", "iphone", "ios", "android", "device", "xcode", "hub", "install", "enable"]}
        label="Device hub"
        hint="Enable this Mac to open its simulators and emulators."
        info="Turning it on downloads a helper the first time and runs it on this Mac only. Turning it off stops the helper, and simulators that are running keep running."
        checked={settings.enabled}
        onCheckedChange={(next) => void setHub(next)}
        {...status("hub")}
        {...failure("hub")}
        {...(settings.enabled !== DEFAULT_SIMULATOR_SETTINGS.enabled ? { onRevert: () => void setHub(DEFAULT_SIMULATOR_SETTINGS.enabled) } : {})}
      />
      <ToggleRow
        keywords={["simulator", "emulator", "device", "agent", "agent-device", "tap", "automation", "access", "control"]}
        label="Agent device access"
        hint="Allow new agent sessions to start and control this Mac's simulators and emulators, with the tools they need set up automatically."
        info="Turning it on downloads the command agents tap and type with the first time."
        checked={settings.enabled && settings.agentAccess}
        onCheckedChange={(next) => void setAgents(next)}
        {...(settings.enabled ? {} : { unavailable: { reason: "Turn on the device hub first." } })}
        {...status("agents")}
        {...failure("agents")}
        {...(settings.agentAccess !== DEFAULT_SIMULATOR_SETTINGS.agentAccess ? { onRevert: () => void setAgents(DEFAULT_SIMULATOR_SETTINGS.agentAccess) } : {})}
      />
    </>
  );
}
