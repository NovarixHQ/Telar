import { expect, test } from "bun:test";
import { cockpitPath } from "./cockpit-path";

test("an engine call goes through the catch-all, query and all", () => {
  expect(cockpitPath("/v2/sessions/s1/diff?base=head")).toBe("/api/engine/v2/sessions/s1/diff?base=head");
  expect(cockpitPath("/v2/hosts")).toBe("/api/engine/v2/hosts");
});

test("a call whose route adds something stays on that route, by method where the route is method-specific", () => {
  expect(cockpitPath("/v2/appearance", "PUT")).toBe("/api/appearance");
  expect(cockpitPath("/v2/projects/p1/sessions", "POST")).toBe("/api/projects/p1/sessions");
  expect(cockpitPath("/v2/sessions/s1/stop", "POST")).toBe("/api/sessions/s1/stop");
  expect(cockpitPath("/v2/hosts", "POST")).toBe("/api/hosts");
  expect(cockpitPath("/v2/hosts", "GET")).toBe("/api/engine/v2/hosts");
  expect(cockpitPath("/v2/remote/devices", "DELETE")).toBe("/api/remote/devices");
  expect(cockpitPath("/v2/remote/devices/d1", "DELETE")).toBe("/api/engine/v2/remote/devices/d1");
});

test("a path that is not an engine path is left alone", () => {
  expect(cockpitPath("/api/pair")).toBe("/api/pair");
  expect(cockpitPath("https://example.com/v2/x")).toBe("https://example.com/v2/x");
});
