import { describe, expect, test } from "bun:test";
import { stillWorking } from "./background-presence";

const shell = (id: string, state: "running" | "completed" | "waiting" = "running") => ({ id, kind: "background" as const, state });
const agent = (id: string) => ({ id, kind: "agent" as const, backgrounded: true, state: "running" as const });

describe("stillWorking", () => {
  test("counts what the banner counts", () => {
    expect(stillWorking([shell("a"), agent("b"), shell("c", "completed"), { ...shell("d"), ambient: true }]).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
