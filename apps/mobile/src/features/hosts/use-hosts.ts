import { useSyncExternalStore } from "react";
import type { ConnectionState, HostConnection, HostRegistry } from "../../platform/connection";

export type HostRow = { connection: HostConnection; state: ConnectionState };

function hostsStore(registry: HostRegistry) {
  let rows: HostRow[] = [];
  const read = () => {
    const next = registry.list().map((connection) => ({ connection, state: connection.state }));
    const same = next.length === rows.length && next.every((row, index) => row.connection === rows[index]?.connection && row.state === rows[index]?.state);
    if (!same) rows = next;
    return rows;
  };
  const subscribe = (notify: () => void) => {
    let unsubscribeEach = registry.list().map((connection) => connection.subscribe(notify));
    const unsubscribeRegistry = registry.subscribe(() => {
      for (const stop of unsubscribeEach) stop();
      unsubscribeEach = registry.list().map((connection) => connection.subscribe(notify));
      notify();
    });
    return () => {
      unsubscribeRegistry();
      for (const stop of unsubscribeEach) stop();
    };
  };
  return { read, subscribe };
}

const stores = new WeakMap<HostRegistry, ReturnType<typeof hostsStore>>();

export function useHosts(registry: HostRegistry): HostRow[] {
  let store = stores.get(registry);
  if (!store) stores.set(registry, (store = hostsStore(registry)));
  return useSyncExternalStore(store.subscribe, store.read);
}
