import type { ConnectionState, HostConnection } from "../../platform/connection";
import type { LayoutHost } from "./group-by";

export function layoutHosts(rows: readonly { connection: HostConnection; state: ConnectionState }[]): LayoutHost[] {
  return rows.map(({ connection, state }) => ({
    online: state.kind === "online",
    sidebarLayout: () => connection.call(true, () => connection.client.sidebarLayout()),
    setSidebarLayout: (patch) => connection.call(false, () => connection.client.setSidebarLayout(patch)),
  }));
}
