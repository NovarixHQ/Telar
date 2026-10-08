import { describe, expect, test } from "bun:test";
import { connectionReport, hostSubtitle } from "./connection-report";

const now = Date.UTC(2026, 9, 8, 12);

describe("Connections", () => {
  test("the subtitle names the address in use, or the first known one", () => {
    expect(hostSubtitle({ state: { kind: "online", address: "http://192.168.1.4:62051", since: 0 }, addresses: [] })).toBe("Paired · 192.168.1.4");
    expect(hostSubtitle({ state: { kind: "connecting" }, addresses: ["http://127.0.0.1:62051"] })).toBe("Paired · 127.0.0.1");
    expect(hostSubtitle({ state: { kind: "stopped" }, addresses: [] })).toBe("Paired");
  });

  test("the exported log lists each computer's state and addresses", () => {
    const report = connectionReport([{ hostId: "h1", name: "Studio", state: { kind: "online", address: "http://10.0.0.2:1", since: 0 }, addresses: ["http://10.0.0.2:1"] }], new Date(now));
    expect(report).toContain("Studio (h1)");
    expect(report).toContain("state: online via http://10.0.0.2:1");
  });
});
