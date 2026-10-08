import type { SidebarLayout, SidebarMode } from "@telar/engine-client";
import type { SettingsStore } from "./store";

export type LayoutHost = {
  online: boolean;
  sidebarLayout(): Promise<{ layout: SidebarLayout }>;
  setSidebarLayout(patch: { mode: SidebarMode }): Promise<{ layout: SidebarLayout }>;
};

/** Adopts the first reachable computer's choice, which may have been changed from another device. */
export async function adoptGroupBy(store: SettingsStore, hosts: readonly LayoutHost[]): Promise<void> {
  const first = hosts.find((host) => host.online);
  if (!first) return;
  try {
    store.set("groupBy", (await first.sidebarLayout()).layout.mode);
  } catch {
    // The cached value stays until a computer answers.
  }
}

/** Shows the choice at once and writes it to every reachable computer; false when one of them refused it. */
export async function saveGroupBy(store: SettingsStore, hosts: readonly LayoutHost[], mode: SidebarMode): Promise<boolean> {
  store.set("groupBy", mode);
  const written = await Promise.all(
    hosts.map(async (host) => {
      if (!host.online) return true;
      try {
        await host.setSidebarLayout({ mode });
        return true;
      } catch {
        return false;
      }
    }),
  );
  return written.every(Boolean);
}
