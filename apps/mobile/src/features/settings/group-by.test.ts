import { describe, expect, test } from "bun:test";
import type { SidebarLayout, SidebarMode } from "@telar/engine-client";
import { adoptGroupBy, saveGroupBy, type LayoutHost } from "./group-by";
import { SettingsStore, type Backend } from "./store";

function memory(initial: Record<string, unknown> = {}): Backend & { values: Record<string, unknown> } {
  const values = { ...initial };
  return { values, get: (key) => values[key], set: (next) => Object.assign(values, next) };
}

const layout = (mode: SidebarMode): { layout: SidebarLayout } => ({ layout: { projectOrder: [], sessionOrder: {}, pinnedOrder: [], mode } });

function host(mode: SidebarMode, options: { online?: boolean; refuses?: boolean } = {}): LayoutHost & { written: SidebarMode[] } {
  const written: SidebarMode[] = [];
  return {
    written,
    online: options.online ?? true,
    sidebarLayout: async () => layout(mode),
    setSidebarLayout: async (patch) => {
      if (options.refuses) throw new Error("offline");
      written.push(patch.mode);
      return layout(patch.mode);
    },
  };
}

describe("Group by", () => {
  test("opening settings adopts the first reachable computer's choice", async () => {
    const store = new SettingsStore(memory());
    await adoptGroupBy(store, [host("flat", { online: false }), host("grouped")]);
    expect(store.current.groupBy).toBe("grouped");
  });

  test("with no computer reachable the cached choice stays", async () => {
    const store = new SettingsStore(memory({ "telar.sidebarMode": "grouped" }));
    await adoptGroupBy(store, [host("flat", { online: false })]);
    expect(store.current.groupBy).toBe("grouped");
  });

  test("saving writes every reachable computer and skips the rest", async () => {
    const store = new SettingsStore(memory());
    const [reachable, away] = [host("flat"), host("flat", { online: false })];
    expect(await saveGroupBy(store, [reachable, away], "grouped")).toBe(true);
    expect(reachable.written).toEqual(["grouped"]);
    expect(away.written).toEqual([]);
    expect(store.current.groupBy).toBe("grouped");
  });

  test("a computer refusing the write is reported, and the choice still shows", async () => {
    const store = new SettingsStore(memory());
    expect(await saveGroupBy(store, [host("flat"), host("flat", { refuses: true })], "grouped")).toBe(false);
    expect(store.current.groupBy).toBe("grouped");
  });
});
