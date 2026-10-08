"use client";

import { useState } from "react";
import { SmartphoneIcon } from "lucide-react";
import { Row, SettingsGroup, ToggleRow } from "@/features/settings";
import { useRemoteStatus } from "../hooks/use-remote-status";
import { RemoteDevicesGroup, RevokeOthersRow } from "./remote-devices-group";
import { RemoteEnvironmentRows } from "./remote-environment-group";
import { PairDeviceRow } from "./remote-pair-group";

export function RemoteSection() {
  const remote = useRemoteStatus();
  const { status, error } = remote;
  const [endpointUrl, setEndpointUrl] = useState<string | null>(null);

  if (!status) {
    return (
      <SettingsGroup title="This Mac">
        <Row label="Loading" hint="Reading the pairing store." {...(error ? { error } : {})} control={null} />
      </SettingsGroup>
    );
  }

  return (
    <>
      <SettingsGroup title="This Mac">
        <ToggleRow
          keywords={["auth", "security", "phone", "ipad"]}
          label="Require pairing"
          icon={SmartphoneIcon}
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

      <RemoteDevicesGroup
        status={status}
        busy={remote.busy}
        onRename={(id, name) => void remote.patchDevice(id, { name })}
        onRole={(id, role) => void remote.patchDevice(id, { role })}
        onRevoke={(id) => void remote.revoke(id)}
      >
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
        {status.devices.length > 1 && status.callerDeviceId && (
          <RevokeOthersRow count={status.devices.length - 1} onConfirm={() => void remote.revokeOthers()} />
        )}
      </RemoteDevicesGroup>
    </>
  );
}
