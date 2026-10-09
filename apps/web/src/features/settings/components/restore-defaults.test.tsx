import { expect, test } from "bun:test";
import { BellIcon } from "lucide-react";
import { DEFAULT_CLEANUP_POLICY } from "@telar/engine-client";
import { DesktopNotificationsGroup } from "@/features/push";
import { CleanupSection } from "@/features/worktrees/components/cleanup-section";
import { buttonLabelled, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { ExperimentalRows } from "./experimental-rows";
import { SettingsShell } from "./settings-shell";

installTestDom();

test("Restore defaults turns desktop notifications back on", async () => {
  const set: boolean[] = [];
  (window as { telarDesktop?: unknown }).telarDesktop = {
    notifications: { get: async () => ({ enabled: false }), set: async (enabled: boolean) => (set.push(enabled), { enabled }) },
  };
  try {
    const { host } = await mount(
      <SettingsShell title="Settings" sections={[{ id: "general", label: "General", icon: BellIcon }]} active="general" onSelect={() => {}}>
        <DesktopNotificationsGroup />
      </SettingsShell>,
    );
    await flush(() => host.querySelector('[role="switch"][aria-label="Desktop notifications"]')?.getAttribute("aria-checked") === "false");
    await click(buttonLabelled("Restore defaults", host));
    expect(set).toEqual([true]);
  } finally {
    delete (window as { telarDesktop?: unknown }).telarDesktop;
  }
});

test("Restore defaults turns every trial off", async () => {
  window.localStorage.setItem("telar:experiment:tabs", "on");
  const { host } = await mount(
    <SettingsShell title="Settings" sections={[{ id: "general", label: "General", icon: BellIcon }]} active="general" onSelect={() => {}}>
      <ExperimentalRows experiments={[{ id: "tabs", label: "Tabs", hint: "Tabs.", decideBy: "2099-01-01" }]} />
    </SettingsShell>,
  );
  await click(buttonLabelled("Restore defaults", host));
  expect(window.localStorage.getItem("telar:experiment:tabs")).toBeNull();
});

test("Restore defaults writes the cleanup rules back in one write", async () => {
  const policy = { settledDays: null, logsDays: 30 };
  const calls = stubFetch({
    "GET /api/cleanup": () => ({ cleanup: { policy, running: false } }),
    "PUT /api/cleanup": (body) => ({ cleanup: { policy: body, running: false } }),
  });
  const { host } = await mount(
    <SettingsShell title="Settings" sections={[{ id: "storage", label: "Storage", icon: BellIcon }]} active="storage" onSelect={() => {}}>
      <CleanupSection />
    </SettingsShell>,
  );
  await flush(() => calls.some((call) => call.route === "GET /api/cleanup"));
  await click(buttonLabelled("Restore defaults", host));
  expect(calls.filter((call) => call.route === "PUT /api/cleanup").map((call) => call.body)).toEqual([DEFAULT_CLEANUP_POLICY]);
});
