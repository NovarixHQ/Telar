"use client";

import { useState, type ReactNode } from "react";
import { Row, SettingsGroup, ToggleRow } from "@/features/settings";
import { useRemoteStatus } from "../hooks/use-remote-status";
import { DeviceRows, RevokeOthersRow } from "./device-rows";
import { RemoteEnvironmentRows } from "./remote-environment-group";
import { PairDeviceRow } from "./remote-pair-group";

/** Children are rows drawn in the Paired group, after Pair a device. */
export function RemoteSection({ children }: { children?: ReactNode }) {
  const remote = useRemoteStatus();
  const { status, error } = remote;
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null);

  if (!status) {
    return (
      <>
        <SettingsGroup title="This Mac">
          <Row label="Loading" hint="Reading the pairing store." {...(error ? { error } : {})} control={null} />
        </SettingsGroup>
        {children ? <SettingsGroup title="Paired">{children}</SettingsGroup> : null}
      </>
    );
  }

  return (
    <>
      <SettingsGroup title="This Mac">
        <ToggleRow
          keywords={["auth", "security", "phone", "ipad"]}
          label="Require pairing"
          hint={
            status.requireAuth
              ? "Unpaired devices are refused. The app running the server is always in."
              : "Anything that can reach this address has full control; only your network stands in the way."
          }
          {...(error ? { error } : {})}
          checked={status.requireAuth}
          onCheckedChange={(next) => void remote.toggle(next)}
        />
        {status.requireAuth && (
          <RemoteEnvironmentRows
            status={status}
            restartNeeded={remote.restartNeeded}
            onExposure={(next) => void remote.setExposure(next)}
            onTailscaleServe={(next) => void remote.setTailscaleServe(next)}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="Paired">
        {status.requireAuth && (
          <PairDeviceRow
            minted={remote.minted}
            endpoints={status.endpoints}
            busy={remote.busy}
            onMint={() => void remote.mint()}
            endpointUrl={endpointUrl}
            onSelectEndpoint={setEndpointUrl}
          />
        )}
        {children}
        <DeviceRows
          status={status}
          busy={remote.busy}
          onRename={(id, name) => void remote.patchDevice(id, { name })}
          onRole={(id, role) => void remote.patchDevice(id, { role })}
          onRevoke={(id) => void remote.revoke(id)}
        />
        {status.devices.length > 1 && status.callerDeviceId && (
          <RevokeOthersRow count={status.devices.length - 1} onConfirm={() => void remote.revokeOthers()} />
        )}
      </SettingsGroup>
    </>
  );
}
