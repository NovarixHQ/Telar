import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { desktopMetrics, readProcessMetrics, type ProcessMetricsSummary } from "@/platform/desktop/desktop-metrics";

const sample: ProcessMetricsSummary = {
  readAt: 5,
  windowMs: 2_000,
  totals: { cpuPercent: 96, memoryKb: 1_000, processes: 2 },
  types: [{ type: "Tab", label: "Renderer", count: 1, cpuPercent: 96, memoryKb: 1_000, pagelessCount: 1 }],
  busiest: [{ pid: 318, type: "Tab", label: "Renderer", cpuPercent: 96, memoryKb: 1_000, hostsPage: false }],
};

// The DOM registration is process-wide, so it is undone after this file.
beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

afterEach(() => {
  delete (window as unknown as { telarDesktop?: unknown }).telarDesktop;
});

test("inside the shell it asks the bridge", async () => {
  (window as unknown as { telarDesktop?: unknown }).telarDesktop = { metrics: { read: async () => sample } };
  expect(desktopMetrics()).toBeDefined();
  expect(await readProcessMetrics()).toEqual(sample);
});

test("with no bridge it says the cockpit is not inside the desktop app", async () => {
  await expect(readProcessMetrics()).rejects.toThrow("not running inside the Telar desktop app");
});
