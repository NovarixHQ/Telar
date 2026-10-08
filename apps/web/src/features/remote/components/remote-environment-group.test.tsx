import { expect, test } from "bun:test";
import { useState } from "react";
import { installTestDom, mount, press } from "@/test/dom";
import type { RemoteStatus } from "../api";
import { RemoteEnvironmentRows } from "./remote-environment-group";

installTestDom();

const STATUS: RemoteStatus = { requireAuth: true, exposure: "local-only", tailscaleServe: false, devices: [], endpoints: [] };

function Harness() {
  const [restartNeeded, setRestartNeeded] = useState(false);
  return (
    <RemoteEnvironmentRows
      status={STATUS}
      restartNeeded={restartNeeded}
      onExposure={() => setRestartNeeded(true)}
      onTailscaleServe={() => setRestartNeeded(true)}
    />
  );
}

const rowOf = (host: HTMLElement, label: string) => host.querySelector(`[aria-label="${label}"]`)!.closest('[id^="settings-row-"]')!;

test("the restart notice sits in the row whose change needs it, not as a row of its own", async () => {
  const { host } = await mount(<Harness />);
  expect(host.textContent).not.toContain("Takes effect when Telar restarts.");
  await press(host.querySelector('[aria-label="HTTPS on your private network"]')!);
  expect(rowOf(host, "HTTPS on your private network").textContent).toContain("Takes effect when Telar restarts.");
  expect(rowOf(host, "Network access").textContent).not.toContain("Takes effect when Telar restarts.");
  expect(host.textContent).not.toContain("Restart to apply");
});
