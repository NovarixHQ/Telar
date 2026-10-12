import { expect, test } from "bun:test";
import { installTestDom } from "@/test/dom";
import { liveRow, mountRail, project, stubRail } from "@/test/rail";

installTestDom();

const FLAT = { projectOrder: [], sessionOrder: {}, pinnedOrder: [], mode: "flat" };
const HOUR = 3_600_000;

async function railViewing(viewed: Record<string, unknown>) {
  const sessions = [liveRow("newer", { idleHours: 1 }), liveRow("viewed", { idleHours: 2, ...viewed }), liveRow("older", { idleHours: 3 })];
  stubRail(() => ({ body: { projects: [project("p1", "One")], sessions, layout: FLAT } }));
  const host = await mountRail({ viewing: "/projects/p1/sessions/viewed" });
  const listed = [...host.querySelector("#sidebar-session-results")!.querySelectorAll("a")]
    .map((link) => link.textContent ?? "")
    .filter((text) => text.includes("Title "));
  return { host, listed };
}

const shelfCount = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith(label))?.textContent;

test("snoozing the viewed session moves it to Snoozed rather than to the top", async () => {
  const now = Date.now();
  const { host, listed } = await railViewing({ updatedAt: now, snoozedUntil: now + HOUR, snoozedAt: now });
  expect(listed.some((text) => text.includes("Title viewed"))).toBe(false);
  expect(listed.findIndex((text) => text.includes("Title newer"))).toBeLessThan(listed.findIndex((text) => text.includes("Title older")));
  expect(shelfCount(host, "Snoozed")).toContain("1");
});

test("settling the viewed session moves it to Settled the same way", async () => {
  const now = Date.now();
  const { host, listed } = await railViewing({ updatedAt: now, settledOverride: "settled", settledAt: now });
  expect(listed.some((text) => text.includes("Title viewed"))).toBe(false);
  expect(shelfCount(host, "Settled")).toContain("1");
});
