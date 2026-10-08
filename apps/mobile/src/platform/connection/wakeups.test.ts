import { expect, test } from "bun:test";
import { foregroundWakeup } from "./wakeups";

test("a long spell in the background reconnects, a short one only probes", () => {
  expect(foregroundWakeup(9_999)).toBe("probe");
  expect(foregroundWakeup(10_000)).toBe("reconnect");
});
