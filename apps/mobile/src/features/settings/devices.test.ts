import { describe, expect, test } from "bun:test";
import type { RemoteDevice } from "@telar/engine-client";
import { ago, deviceSubtitle, devicesView, platformSymbol, type RemoteStatus } from "./devices";

const now = Date.UTC(2026, 9, 8, 12);
const device = (id: string, extra: Partial<RemoteDevice> = {}): RemoteDevice => ({ id, name: id, createdAt: now - 3 * 86_400_000, role: "full", ...extra });
const status = (extra: Partial<RemoteStatus>): RemoteStatus => ({ requireAuth: true, exposure: "local-only", tailscaleServe: false, devices: [], ...extra });

describe("Devices", () => {
  test("this phone is listed apart from the others, which it may revoke", () => {
    const view = devicesView(status({ devices: [device("phone"), device("laptop")], callerDeviceId: "phone", callerRole: "full" }));
    expect(view.mine.map((d) => d.id)).toEqual(["phone"]);
    expect(view.others.map((d) => d.id)).toEqual(["laptop"]);
    expect(view.othersLabel).toBe("Other devices");
    expect(view.canRevokeOthers).toBe(true);
  });

  test("a view-only phone can't manage or revoke", () => {
    const view = devicesView(status({ devices: [device("phone"), device("laptop")], callerDeviceId: "phone", callerRole: "observer" }));
    expect(view.canManage).toBe(false);
    expect(view.canRevokeOthers).toBe(false);
  });

  test("an unknown caller sees every device under Devices and no revoke-all", () => {
    const view = devicesView(status({ devices: [device("laptop")] }));
    expect(view.othersLabel).toBe("Devices");
    expect(view.canRevokeOthers).toBe(false);
    expect(devicesView(status({})).emptyTitle).toBe("No devices are paired.");
    expect(devicesView(status({ devices: [device("phone")], callerDeviceId: "phone" })).emptyTitle).toBe("No other devices are paired.");
  });

  test("the subtitle says connected, last seen, or when it paired", () => {
    expect(deviceSubtitle(device("a", { connected: true }), now)).toBe("Connected");
    expect(deviceSubtitle(device("a", { lastSeenAt: now - 2 * 3_600_000 }), now)).toBe("Last seen 2 hours ago");
    expect(deviceSubtitle(device("a"), now)).toBe("Paired 3 days ago");
    expect(ago(now - 86_400_000, now)).toBe("yesterday");
    expect(ago(now - 10_000, now)).toBe("now");
  });

  test("the glyph follows the platform", () => {
    expect(platformSymbol("ios")).toBe("iphone");
    expect(platformSymbol("browser")).toBe("desktopcomputer");
    expect(platformSymbol(undefined)).toBe("questionmark.circle");
  });
});
