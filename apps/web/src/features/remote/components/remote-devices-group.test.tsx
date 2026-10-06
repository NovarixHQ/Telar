import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteDevice } from "@telar/engine-client";
import { RemoteDevicesGroup } from "./remote-devices-group";

const HOUR = 60 * 60 * 1000;

function rows(devices: RemoteDevice[]): string[] {
  const html = renderToStaticMarkup(
    <RemoteDevicesGroup
      status={{ requireAuth: true, exposure: "local-only", tailscaleServe: false, devices, endpoints: [] }}
      busy={false}
      onRename={() => undefined}
      onRole={() => undefined}
      onRevoke={() => undefined}
    />,
  );
  const body = html.split("<tbody>")[1]!.split("</tbody>")[0]!;
  return body.split("</tr>").filter(Boolean).map((row) => row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
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
