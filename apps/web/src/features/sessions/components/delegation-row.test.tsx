import { expect, test } from "bun:test";
import { BellIcon } from "lucide-react";
import { SettingsShell } from "@/features/settings/components/settings-shell";
import { flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { DelegationRow } from "./delegation-row";

installTestDom();

async function row(delegationMode: string) {
  const calls = stubFetch({
    "GET /v2/session-defaults": () => ({ sessionDefaults: { envMode: "local", delegationMode } }),
    "PATCH /v2/session-defaults": (body) => ({ sessionDefaults: { envMode: "local", delegationMode, ...(body as object) } }),
  });
  const { host } = await mount(
    <SettingsShell title="Settings" sections={[{ id: "general", label: "General", icon: BellIcon }]} active="general" onSelect={() => {}}>
      <DelegationRow />
    </SettingsShell>,
  );
  const trigger = () => host.querySelector('[aria-label="Delegation"]');
  await flush(() => Boolean(trigger()?.textContent?.includes(delegationMode === "aggressive" ? "Aggressive" : "Normal")));
  return { host, calls, trigger: () => trigger()! };
}

const patches = (calls: { route: string; body?: unknown }[]) => calls.filter((call) => call.route === "PATCH /v2/session-defaults").map((call) => call.body);

test("the host's mode is shown with what it means, and choosing Conservative saves it", async () => {
  const { host, calls, trigger } = await row("normal");
  expect(host.textContent).toContain("default to a mid-priced model");
  expect(host.querySelectorAll('button[aria-label="Revert to the default"]')).toHaveLength(0);

  await press(trigger());
  await press([...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes("Conservative"))!);
  expect(patches(calls)).toEqual([{ delegationMode: "conservative" }]);
  await flush(() => Boolean(host.textContent?.includes("at medium effort or less")));
  expect(trigger().textContent).toContain("Conservative");
});

test("an install kept on Aggressive says so, and reverting returns it to Normal", async () => {
  const { host, calls } = await row("aggressive");
  expect(host.textContent).toContain("run on your default model");
  await press(host.querySelector('button[aria-label="Revert to the default"]')!);
  expect(patches(calls)).toEqual([{ delegationMode: "normal" }]);
});
