import { expect, test } from "bun:test";
import { BellIcon } from "lucide-react";
import { SettingsShell } from "@/features/settings/components/settings-shell";
import { flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { WorkspaceSection } from "./workspace-section";

installTestDom();

async function general(whileWorking?: "steer" | "queue") {
  const calls = stubFetch({
    "GET /api/session-defaults": () => ({ sessionDefaults: { envMode: "local", ...(whileWorking ? { whileWorking } : {}) } }),
    "PATCH /api/session-defaults": (body) => ({ sessionDefaults: { envMode: "local", ...(body as object) } }),
  });
  const { host } = await mount(
    <SettingsShell title="Settings" sections={[{ id: "general", label: "General", icon: BellIcon }]} active="general" onSelect={() => {}}>
      <WorkspaceSection />
    </SettingsShell>,
  );
  const trigger = () => host.querySelector('[aria-label="While an agent is working"]')!;
  await flush(() => Boolean(trigger()));
  await flush(() => calls.some((call) => call.route === "GET /api/session-defaults"));
  await flush();
  return { host, calls, trigger };
}

test("steering is the default, and choosing Queue for after saves it on the host", async () => {
  const { host, calls, trigger } = await general();
  expect(trigger().textContent).toContain("Steer the turn");
  expect(host.textContent).toContain("joins the turn that is running");

  await press(trigger());
  const option = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes("Queue for after"))!;
  await press(option);
  expect(calls.filter((call) => call.route === "PATCH /api/session-defaults").map((call) => call.body)).toEqual([{ whileWorking: "queue" }]);
  await flush(() => Boolean(host.textContent?.includes("waits above the composer")));
  expect(trigger().textContent).toContain("Queue for after");
});

test("a queueing host shows it, and reverting steers again", async () => {
  const { host, calls, trigger } = await general("queue");
  await flush(() => Boolean(trigger().textContent?.includes("Queue for after")));
  expect(host.textContent).toContain("waits above the composer");
  const revert = [...host.querySelectorAll('button[aria-label="Revert to the default"]')];
  expect(revert).toHaveLength(1);
  await press(revert[0]!);
  expect(calls.filter((call) => call.route === "PATCH /api/session-defaults").map((call) => call.body)).toEqual([{ whileWorking: "steer" }]);
});
