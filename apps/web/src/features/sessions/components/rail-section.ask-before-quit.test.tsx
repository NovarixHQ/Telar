import { expect, test } from "bun:test";
import { BellIcon } from "lucide-react";
import { SettingsShell } from "@/features/settings/components/settings-shell";
import { flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import { AskBeforeQuitRow } from "./rail-section";

installTestDom();

async function row(askBeforeQuit?: boolean) {
  const calls = stubFetch({
    "GET /v2/session-defaults": () => ({ sessionDefaults: { envMode: "local", ...(askBeforeQuit === undefined ? {} : { askBeforeQuit }) } }),
    "PATCH /v2/session-defaults": (body) => ({ sessionDefaults: { envMode: "local", ...(body as object) } }),
  });
  const { host } = await mount(
    <SettingsShell title="Settings" sections={[{ id: "general", label: "General", icon: BellIcon }]} active="general" onSelect={() => {}}>
      <AskBeforeQuitRow />
    </SettingsShell>,
  );
  const toggle = () => host.querySelector<HTMLElement>('[aria-label="Ask before quitting while sessions work"]')!;
  await flush(() => calls.some((call) => call.route === "GET /v2/session-defaults"));
  await flush();
  const patches = () => calls.filter((call) => call.route === "PATCH /v2/session-defaults").map((call) => call.body);
  return { host, toggle, patches };
}

test("asking is the default, and turning it off saves that on the host", async () => {
  const { toggle, patches } = await row();
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await press(toggle());
  expect(patches()).toEqual([{ askBeforeQuit: false }]);
  await flush(() => toggle().getAttribute("aria-checked") === "false");
});

test("after Don't ask again, the row shows off and reverting asks again", async () => {
  const { host, toggle, patches } = await row(false);
  await flush(() => toggle().getAttribute("aria-checked") === "false");
  await press(host.querySelector<HTMLElement>('button[aria-label="Revert to the default"]')!);
  expect(patches()).toEqual([{ askBeforeQuit: true }]);
  await flush(() => toggle().getAttribute("aria-checked") === "true");
});
