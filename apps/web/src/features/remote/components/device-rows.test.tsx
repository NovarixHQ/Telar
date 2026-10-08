import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteDevice } from "@telar/engine-client";
import { DeviceRows } from "./device-rows";

const HOUR = 60 * 60 * 1000;

function rows(devices: RemoteDevice[]): string[] {
  const html = renderToStaticMarkup(
    <DeviceRows
      status={{ requireAuth: true, exposure: "local-only", tailscaleServe: false, devices, endpoints: [] }}
      busy={false}
      onRename={() => undefined}
      onRole={() => undefined}
      onRevoke={() => undefined}
    />,
  );
  return html
    .split('id="settings-device-')
    .slice(1)
    .map((row) => row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

test("a connected device says so, and a quiet one shows when it was last seen", () => {
  const now = Date.now();
  const [phone, laptop, fresh] = rows([
    { id: "dev_1", name: "Phone", createdAt: now - 48 * HOUR, lastSeenAt: now, connected: true, role: "full" },
    { id: "dev_2", name: "Laptop", createdAt: now - 48 * HOUR, lastSeenAt: now - 3 * HOUR, connected: false, role: "full" },
    { id: "dev_3", name: "Tablet", createdAt: now - 2 * HOUR, role: "observer" },
  ]);
  expect(phone).toContain("Connected");
  expect(laptop).toContain("3h ago");
  expect(laptop).not.toContain("Connected");
  expect(fresh).toContain("paired 2h ago");
  expect(fresh).not.toContain("Connected");
});

test("each device is a settings row, not a table", () => {
  const html = renderToStaticMarkup(
    <DeviceRows
      status={{ requireAuth: true, exposure: "local-only", tailscaleServe: false, devices: [{ id: "dev_1", name: "Phone", createdAt: 1, role: "full" }], endpoints: [] }}
      busy={false}
      onRename={() => undefined}
      onRole={() => undefined}
      onRevoke={() => undefined}
    />,
  );
  expect(html).not.toContain("<table");
  expect(html).toContain('id="settings-device-dev_1"');
  expect(html).toContain('aria-label="Revoke Phone"');
});

test("only the app running the server is this device", () => {
  const html = renderToStaticMarkup(
    <DeviceRows
      status={{
        requireAuth: true,
        exposure: "local-only",
        tailscaleServe: false,
        devices: [{ id: "dev_1", name: "Chrome on mini", createdAt: 1, role: "full", identity: { kind: "browser", client: "Chrome", machine: "mini" } }],
        endpoints: [],
        callerDeviceId: "dev_1",
        host: { name: "Telar on mini", isCaller: true },
      }}
      busy={false}
      onRename={() => undefined}
      onRole={() => undefined}
      onRevoke={() => undefined}
    />,
  );
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("Telar on mini This device");
  expect(text.match(/This device/g)).toHaveLength(1);
  expect(text).toContain("Chrome on mini browser ·");
});

test("the iOS app reads as its own name and as an iPhone or an iPad", () => {
  const ios = { createdAt: 1, role: "full" as const, platform: "ios" as const };
  const [phone, pad] = rows([
    { ...ios, id: "dev_1", name: "Telar iPhone", identity: { kind: "phone", machine: "iPhone", os: "iOS" } },
    { ...ios, id: "dev_2", name: "Studio", identity: { kind: "tablet", machine: "iPad", os: "iPadOS" } },
  ]);
  expect(phone).toContain("> Telar iPhone iPhone ·");
  expect(pad).toContain("> Studio iPad ·");
});

test("with pairing off, the list says the credentials wait for it", () => {
  const html = renderToStaticMarkup(
    <DeviceRows
      status={{ requireAuth: false, exposure: "local-only", tailscaleServe: false, devices: [], endpoints: [] }}
      busy={false}
      onRename={() => undefined}
      onRole={() => undefined}
      onRevoke={() => undefined}
    />,
  );
  expect(html).toContain("Pairing is off");
  expect(html).toContain("None yet");
});
