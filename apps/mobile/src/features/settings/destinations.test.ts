import { describe, expect, test } from "bun:test";
import { destinationValue, parseDestination } from "./destinations";

describe("destinations", () => {
  test("round-trip through the stack path, and junk is dropped", () => {
    expect(parseDestination(destinationValue({ page: "devices", hostId: "h:1" }))).toEqual({ page: "devices", hostId: "h:1" });
    expect(parseDestination("general")).toEqual({ page: "general" });
    expect(parseDestination("nowhere")).toBeUndefined();
    expect(parseDestination("devices:")).toBeUndefined();
  });
});
