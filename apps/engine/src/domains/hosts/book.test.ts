import { describe, expect, test } from "bun:test";
import { defaultHostName, recordDaemonId, removeHost, renameHost, upsertHost, type Host } from "./book";

let counter = 0;
const mint = () => `host_${++counter}`;

describe("defaultHostName", () => {
  test("the host, and the port only when it is not the default", () => {
    expect(defaultHostName("http://mini.tail:3000")).toBe("mini.tail:3000");
    expect(defaultHostName("https://mini.tail:443")).toBe("mini.tail");
  });
});

describe("upsertHost", () => {
  test("adds with a minted id and the address as its name", () => {
    const { hosts, result } = upsertHost([], { baseUrl: "http://mini:3000/", deviceToken: "tlr_a" }, 10, mint);
    expect(result.kind).toBe("added");
    expect(hosts[0]).toMatchObject({ baseUrl: "http://mini:3000", name: "mini:3000", deviceToken: "tlr_a", addedAt: 10 });
  });

  test("a re-pair of a known address keeps the id and takes the new token", () => {
    const first = upsertHost([], { baseUrl: "http://mini:3000", deviceToken: "tlr_a", name: "Mini" }, 10, mint);
    const again = upsertHost(first.hosts, { baseUrl: "HTTP://MINI:3000/", deviceToken: "tlr_b" }, 20, mint);
    expect(again.result.kind).toBe("replaced");
    expect(again.hosts).toHaveLength(1);
    expect(again.hosts[0]).toMatchObject({ id: first.hosts[0]!.id, name: "Mini", deviceToken: "tlr_b", addedAt: 10 });
  });
});

describe("recordDaemonId", () => {
  const two = (): Host[] => [
    { id: "old", name: "Mini", baseUrl: "http://mini:3000", deviceToken: "tlr_a", addedAt: 10, daemonId: "d1" },
    { id: "new", name: "Mini via tailnet", baseUrl: "http://mini.tail:3000", deviceToken: "tlr_b", addedAt: 20 },
  ];

  test("learns the id on a lone record", () => {
    const { hosts, merged } = recordDaemonId(two().slice(1), "new", "d9");
    expect(merged).toBe(false);
    expect(hosts[0]).toMatchObject({ id: "new", daemonId: "d9" });
  });

  test("merges a twin into the older record and keeps the newer address", () => {
    const { hosts, merged } = recordDaemonId(two(), "new", "d1");
    expect(merged).toBe(true);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ id: "old", baseUrl: "http://mini.tail:3000", deviceToken: "tlr_b", daemonId: "d1" });
  });
});

describe("rename and remove", () => {
  const one: Host[] = [{ id: "h", name: "Mini", baseUrl: "http://mini:3000", deviceToken: "tlr_a", addedAt: 1 }];
  test("an empty rename falls back to the address rather than a blank row", () => {
    expect(renameHost(one, "h", "  ")[0]!.name).toBe("mini:3000");
    expect(renameHost(one, "h", " Studio ")[0]!.name).toBe("Studio");
  });
  test("remove", () => {
    expect(removeHost(one, "h")).toEqual([]);
    expect(removeHost(one, "x")).toEqual(one);
  });
});
