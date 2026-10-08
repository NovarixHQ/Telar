import { expect, test } from "bun:test";
import { releaseSimulatorTab } from "./api";

test("closing a session's Simulator tab releases every simulator it had open, and a failed release is not thrown", async () => {
  const calls: Array<[string, string, boolean]> = [];
  const api = {
    showSessionSimulator: async (sessionId: string, id: string, shown: boolean) => {
      calls.push([sessionId, id, shown]);
      if (id === "B") throw new Error("engine gone");
      return {};
    },
  };
  releaseSimulatorTab(api, "s1", { open: "A,B", active: "B" });
  releaseSimulatorTab(api, "s1", undefined);
  await Promise.resolve();
  expect(calls).toEqual([["s1", "A", false], ["s1", "B", false]]);
});
