import { describe, expect, test } from "bun:test";
import { connectionReport } from "./connection-report";

const now = Date.UTC(2026, 9, 8, 12);

describe("Connections", () => {
  test("the exported log lists each computer's state and addresses", () => {
    const report = connectionReport([{ hostId: "h1", name: "Studio", state: { kind: "online", address: "http://10.0.0.2:1", since: 0 }, addresses: ["http://10.0.0.2:1"] }], new Date(now));
    expect(report).toContain("Studio (h1)");
    expect(report).toContain("state: online via http://10.0.0.2:1");
  });
});
