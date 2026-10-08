import { expect, test } from "bun:test";
import { BellIcon } from "lucide-react";
import { DEFAULT_CLEANUP_POLICY } from "@telar/engine-client";
import { PushNotificationsGroup } from "@/features/push";
import { CleanupSection } from "@/features/worktrees/components/cleanup-section";
import { buttonLabelled, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { ExperimentalRows } from "./experimental-rows";
import { SettingsShell } from "./settings-shell";

installTestDom();

const SECTION = [{ id: "notifications", label: "Notifications", icon: BellIcon }];

test("Restore defaults puts every row of the Notifications section back", async () => {
  const calls = stubFetch({
    "GET /api/mobile/relay": () => ({ configured: true, devices: [] }),
    "GET /api/mobile/notify": () => ({ notifyOn: "both" }),
    "PUT /api/mobile/notify": (body) => body,
    "GET /api/mobile/sounds": () => ({ sounds: "felt" }),
    "PUT /api/mobile/sounds": (body) => body,
  });
  const { host } = await mount(
    <SettingsShell title="Settings" sections={SECTION} active="notifications" onSelect={() => {}}>
      <PushNotificationsGroup />
    </SettingsShell>,
  );
  await flush(() => Boolean(host.textContent?.includes("Notification sounds")));
  await click(buttonLabelled("Restore defaults", host));
  const writes = calls.filter((call) => call.route.startsWith("PUT")).map((call) => `${call.route} ${JSON.stringify(call.body)}`);
  expect(writes.sort()).toEqual(['PUT /api/mobile/notify {"notifyOn":"mac"}', 'PUT /api/mobile/sounds {"sounds":"hilo"}']);
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
