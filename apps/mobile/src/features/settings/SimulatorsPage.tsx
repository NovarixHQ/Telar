import { Button, ProgressView, VStack } from "@expo/ui/swift-ui";
import { buttonStyle, controlSize, frame, padding, tint } from "@expo/ui/swift-ui/modifiers";
import type { SimulatorsState, SimulatorSummary } from "@telar/engine-client";
import { Fragment, useEffect, useState } from "react";
import type { HostConnection } from "../../platform/connection";
import { Theme } from "../../ui";
import type { RemoteStatus } from "./devices";
import { failureText, useHostLoad } from "./host-call";
import { CardDivider, CardRow, Footnote, SectionLabel, SettingsCard, SettingsPage, StatusBanner } from "./kit";
import { pollDelay, simulatorBanner, simulatorIcon, simulatorSubtitle } from "./simulators";

const loadState = async (host: HostConnection) => (await host.call(true, () => host.client.simulators())).simulators;

export function SimulatorsPage({ hostId }: { hostId: string }) {
  const { value: state, error, setError, reload, host } = useHostLoad(hostId, loadState);
  const [canDrive, setCanDrive] = useState<boolean>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    host?.request<RemoteStatus>("GET", "/v2/remote").then((status) => setCanDrive(status.callerRole !== "observer"), () => setCanDrive(true));
  }, [host]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), pollDelay(state));
    return () => clearTimeout(timer);
  }, [state, error, reload]);

  const toggle = async (simulator: SimulatorSummary) => {
    if (!host) return;
    setBusy((current) => new Set(current).add(simulator.id));
    try {
      await host.call(false, () => (simulator.booted ? host.client.shutdownSimulator(simulator.id) : host.client.bootSimulator(simulator.id)));
      setError(undefined);
    } catch (failure) {
      setError(failureText(failure));
    }
    setBusy((current) => new Set([...current].filter((id) => id !== simulator.id)));
    await reload();
  };

  return (
    <SettingsPage title="Simulators" onRefresh={reload}>
      {state ? <Listing state={state} canDrive={canDrive} busy={busy} onToggle={(simulator) => void toggle(simulator)} /> : null}
      {error ? (
        <SettingsCard>
          <StatusBanner icon="exclamationmark.triangle" color={Theme.amber} title={error} />
        </SettingsCard>
      ) : state ? null : (
        <ProgressView modifiers={[frame({ maxWidth: Infinity }), padding({ top: 48 })]} />
      )}
    </SettingsPage>
  );
}

function Listing({ state, canDrive, busy, onToggle }: { state: SimulatorsState; canDrive: boolean | undefined; busy: ReadonlySet<string>; onToggle: (simulator: SimulatorSummary) => void }) {
  const banner = simulatorBanner(state);
  return (
    <>
      {banner ? (
        <SettingsCard>
          <StatusBanner icon={banner.icon} color={Theme[banner.tint]} title={banner.title} {...(banner.detail ? { detail: banner.detail } : {})} />
        </SettingsCard>
      ) : null}
      {state.simulators.length > 0 ? (
        <VStack spacing={0}>
          <SectionLabel text="On this computer" />
          <SettingsCard>
            {state.simulators.map((simulator, index) => (
              <Fragment key={simulator.id}>
                {index > 0 ? <CardDivider /> : null}
                <CardRow icon={simulatorIcon(simulator)} iconColor={simulator.booted ? Theme.emerald : Theme.textMuted} title={simulator.name} subtitle={simulatorSubtitle(simulator)}>
                  {busy.has(simulator.id) ? (
                    <ProgressView />
                  ) : canDrive ? (
                    <Button
                      label={simulator.booted ? "Shut down" : "Start"}
                      onPress={() => onToggle(simulator)}
                      modifiers={[buttonStyle("bordered"), controlSize("small"), tint(simulator.booted ? Theme.red : Theme.accent)]}
                    />
                  ) : null}
                </CardRow>
              </Fragment>
            ))}
          </SettingsCard>
          {canDrive === false ? <Footnote text="This phone is view-only: it can watch a running simulator but not start, stop or touch it." /> : null}
        </VStack>
      ) : null}
    </>
  );
}
