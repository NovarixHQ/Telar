import { afterEach, expect, test } from "bun:test";
import { click, flush, installTestDom, mount } from "@/test/dom";
import { DesktopNotificationsGroup } from "./desktop-notifications-group";

installTestDom();

const desktop = window as { telarDesktop?: unknown };
afterEach(() => {
  delete desktop.telarDesktop;
});

const toggle = (host: ParentNode) => host.querySelector('[role="switch"][aria-label="Desktop notifications"]');

test("in the desktop app the switch shows the shell's choice and turning it off saves off", async () => {
  const set: boolean[] = [];
  desktop.telarDesktop = { notifications: { get: async () => ({ enabled: true }), set: async (enabled: boolean) => (set.push(enabled), { enabled }) } };
  const { host } = await mount(<DesktopNotificationsGroup />);
  const ready = () => {
    const node = toggle(host);
    return node?.getAttribute("aria-checked") === "true" && !node.hasAttribute("data-disabled") && node.getAttribute("aria-disabled") !== "true";
  };
  await flush(ready);
  expect(ready()).toBe(true);
  await click(toggle(host) ?? undefined);
  await flush(() => set.length > 0);
  expect(set).toEqual([false]);
  expect(toggle(host)?.getAttribute("aria-checked")).toBe("false");
});

test("a browser tab says the setting belongs to the desktop app", async () => {
  const { host } = await mount(<DesktopNotificationsGroup />);
  await flush(() => Boolean(host.textContent?.includes("Desktop app only")));
  expect(host.textContent).toContain("Desktop app only");
  expect(toggle(host)).toBeNull();
});
