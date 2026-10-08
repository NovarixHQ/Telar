import { describe, expect, test } from "bun:test";
import { click, installTestDom } from "@/test/dom";
import { liveRow, mountRail, project, stubRail } from "@/test/rail";

installTestDom();

describe("the Settled shelf", () => {
  test("opens its rows as one named group of their own, apart from the active list", async () => {
    const sessions = [liveRow("live"), ...Array.from({ length: 6 }, (_, index) => liveRow(`old${index}`, { settledOverride: "settled" }))];
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions, settledCount: 6 } }));
    const host = await mountRail();
    expect(host.querySelector('[role="group"][aria-label="Settled"]')).toBeNull();
    await click([...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Settled")));
    const shelf = host.querySelector('[role="group"][aria-label="Settled"]');
    expect(shelf?.textContent).toContain("Title old0");
    expect(shelf?.textContent).not.toContain("Title live");
  });

  test("its rows show the branch that tells look-alike sessions apart", async () => {
    const sessions = [
      liveRow("live"),
      liveRow("a", { title: "Run feature smoke", settledOverride: "settled", workspace: { mode: "worktree", branch: "telar/smoke-one" } }),
      liveRow("b", { title: "Run feature smoke", settledOverride: "settled", workspace: { mode: "worktree", branch: "telar/smoke-two" } }),
    ];
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions, settledCount: 2 } }));
    const host = await mountRail();
    await click([...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Settled")));
    const shelf = host.querySelector('[role="group"][aria-label="Settled"]')!;
    expect(shelf.textContent).toContain("telar/smoke-one");
    expect(shelf.textContent).toContain("telar/smoke-two");
  });
});
