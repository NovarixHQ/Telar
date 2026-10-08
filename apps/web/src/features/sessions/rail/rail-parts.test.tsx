import { describe, expect, test } from "bun:test";
import { click, flush, installTestDom, press } from "@/test/dom";
import { liveRow, mountRail, project, stubRail, type RailRequest } from "@/test/rail";

installTestDom();

describe("the Settled shelf", () => {
  test("opens its rows as one named group of their own, apart from the active list", async () => {
    const sessions = [liveRow("live"), ...Array.from({ length: 6 }, (_, index) => liveRow(`old${index}`, { settledOverride: "settled" }))];
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions, settledByProject: { p1: 6 } } }));
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
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions, settledByProject: { p1: 2 } } }));
    const host = await mountRail();
    await click([...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Settled")));
    const shelf = host.querySelector('[role="group"][aria-label="Settled"]')!;
    expect(shelf.textContent).toContain("telar/smoke-one");
    expect(shelf.textContent).toContain("telar/smoke-two");
  });

  const shelfButton = (host: HTMLElement) => [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Settled"));
  const shelfRows = (host: HTMLElement) => host.querySelector('[role="group"][aria-label="Settled"]')!.querySelectorAll("a").length;
  const settledEverywhere = [
    liveRow("done1", { settledOverride: "settled" }),
    liveRow("done2", { settledOverride: "settled" }),
    liveRow("draft", { settledOverride: "settled", draft: { envMode: "local" } }),
    liveRow("later", { settledOverride: "settled", snoozedUntil: Date.now() + 86_400_000 }),
    liveRow("far", { projectId: "p2", settledOverride: "settled" }),
  ];
  const twoProjects = (request: RailRequest, extra: Record<string, unknown> = {}) => ({
    body: {
      projects: [project("p1", "One"), project("p2", "Two")],
      sessions: request.search.includes("shelf") ? settledEverywhere : [liveRow("live")],
      settledByProject: { p1: 2, p2: 1 },
      ...extra,
    },
  });

  test("collapsed, it counts the rows it lists when opened: no drafts, no snoozed rows", async () => {
    stubRail((request) => twoProjects(request));
    const host = await mountRail();
    expect(shelfButton(host)!.textContent).toBe("Settled3");
    await click(shelfButton(host));
    expect(shelfButton(host)!.textContent).toBe("Settled3");
    expect(shelfRows(host)).toBe(3);
  });

  test("two addresses onto one engine count its shelf once", async () => {
    stubRail((request) => twoProjects(request, { daemonId: "engine-1" }), [{ id: "mini", name: "Mini" }]);
    const host = await mountRail();
    expect(shelfButton(host)!.textContent).toBe("Settled3");
  });

  test("a project filter narrows the collapsed count as it narrows the rows", async () => {
    stubRail((request) => twoProjects(request));
    const host = await mountRail();
    await press(document.querySelector<HTMLElement>('[aria-label="Filter by project"]')!);
    await flush(() => Boolean(document.querySelector('[role="checkbox"]')));
    await click([...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((node) => node.textContent?.includes("Two")));
    expect(shelfButton(host)!.textContent).toBe("Settled1");
    await click(shelfButton(host));
    expect(shelfRows(host)).toBe(1);
  });
});
