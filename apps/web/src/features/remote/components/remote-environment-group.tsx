"use client";

import { useState } from "react";
import { GlobeIcon, LockIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { desktopApp } from "@/platform/desktop/desktop-app";
import { Row } from "@/features/settings";
import { Switch } from "@/ui/switch";
import { describeServeError } from "../tailscale-serve";
import type { RemoteStatus } from "../api";

function HttpsHint({ status }: { status: RemoteStatus }) {
  const secure = status.endpoints.find((endpoint) => endpoint.kind === "magicdns");
  if (secure) {
    return (
      <>
        Served at <span className="font-mono text-foreground">{secure.url}/</span>, with a real certificate.
      </>
    );
  }
  if (status.tailscaleServe) return "Publishes at the next launch.";
  return "A real certificate at a private-network name, so phone browsers get a secure context.";
}

const HTTPS_INFO =
  "Needs your private network's app running, with HTTPS certificates turned on for the network. Issuing a certificate publishes this machine's name to a public certificate log, permanently, so rename the machine first if it carries yours. Dictation also works over an ssh -L tunnel, which needs neither.";

function ExposureHint({ status }: { status: RemoteStatus }) {
  if (status.exposure !== "network-accessible") return "Listening on 127.0.0.1 only — this machine is the only one that can reach it.";
  const reachableAt = status.endpoints.filter((endpoint) => endpoint.kind !== "loopback");
  if (reachableAt.length === 0) return "Listening on every interface. Pairing is what guards it.";
  return (
    <>
      Reachable at <span className="font-mono text-foreground">{reachableAt[0]!.url}/</span>
      {reachableAt.length > 1 && <span className="ml-1 text-muted-foreground/70">+{reachableAt.length - 1}</span>}
    </>
  );
}

export function RemoteEnvironmentRows({
  status,
  restartNeeded,
  onExposure,
  onTailscaleServe,
}: {
  status: RemoteStatus;
  restartNeeded: boolean;
  onExposure: (next: "local-only" | "network-accessible") => void;
  onTailscaleServe: (next: boolean) => void;
}) {
  const [changed, setChanged] = useState<"network" | "https">("network");
  const relaunch = desktopApp();
  const restart = restartNeeded && (
    <div className="mt-1.5 flex items-center gap-2 text-xs text-warning">
      <span>Takes effect when Telar restarts.</span>
      {relaunch && (
        <Button variant="outline" size="sm" onClick={() => void relaunch.relaunch()}>
          Restart Telar
        </Button>
      )}
    </div>
  );
  return (
    <>
      <Row
        label="Network access"
        icon={GlobeIcon}
        hint={<ExposureHint status={status} />}
        control={
          <Switch
            aria-label="Network access"
            checked={status.exposure === "network-accessible"}
            onCheckedChange={(next) => {
              setChanged("network");
              onExposure(next ? "network-accessible" : "local-only");
            }}
          />
        }
      >
        {changed === "network" && restart}
      </Row>
      <Row
        label="HTTPS on your private network"
        icon={LockIcon}
        hint={<HttpsHint status={status} />}
        info={HTTPS_INFO}
        {...(status.tailscaleServeError ? { error: describeServeError(status.tailscaleServeError) } : {})}
        control={
          <Switch
            aria-label="HTTPS on your private network"
            checked={status.tailscaleServe === true}
            onCheckedChange={(next) => {
              setChanged("https");
              onTailscaleServe(next);
            }}
          />
        }
      >
        {changed === "https" && restart}
      </Row>
    </>
  );
}
