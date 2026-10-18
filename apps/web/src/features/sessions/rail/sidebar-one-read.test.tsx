import { describe, expect, test } from "bun:test";
import { DEFAULT_INBOX_POLICY } from "@telar/engine-client";
import { click, installTestDom } from "@/test/dom";
import { liveReads, liveRow, mountRail, nextPass, project, stubRail, type LiveAnswer, type RailRequest } from "@/test/rail";

installTestDom();

const page = (extra: Record<string, unknown> = {}) => ({ projects: [project("p1", "One")], sessions: [liveRow("a")], ...extra });
const mini = { id: "mini", name: "Mini" };
const shelfButton = (host: HTMLElement) => [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Settled"));

describe("a rail's pass is one read per host", () => {
  test("each pass asks for the host book and one live list per Mac, nothing beside them", async () => {
    const requests = stubRail(() => ({ body: page() }), [mini]);
    await mountRail();
    const before = requests.length;
    await nextPass();
    expect(requests.slice(before).map((request) => request.path).sort()).toEqual(["/api/engine/v2/hosts", "/api/engine/v2/hosts/mini/api/sessions/live", "/api/engine/v2/sessions/live"]);
  });

  test("the settling window rides the list and bands that Mac's rows", async () => {
    const old = [liveRow("old", { idleHours: 2 })];
    stubRail(() => ({ body: page({ sessions: old, inbox: { ...DEFAULT_INBOX_POLICY, autoSettleAfterHours: 1 } }) }));
    const host = await mountRail();
    expect(host.querySelector("#sidebar-session-results")!.textContent).not.toContain("Title old");
    expect(shelfButton(host)?.textContent).toContain("1");
  });

  test("without a window on the list the default one applies, and the row stays in the list", async () => {
    stubRail(() => ({ body: page({ sessions: [liveRow("old", { idleHours: 2 })] }) }));
    const host = await mountRail();
    expect(host.querySelector("#sidebar-session-results")!.textContent).toContain("Title old");
  });

  test("two addresses onto one engine draw its rows once, going by the daemon id on the list", async () => {
    stubRail(() => ({ body: page({ daemonId: "engine-1" }) }), [mini]);
    const same = await mountRail();
    expect(same.textContent!.split("Title a").length - 1).toBe(1);
  });

  test("with no daemon id, nothing is folded", async () => {
    stubRail(() => ({ body: page() }), [mini]);
    const host = await mountRail();
    expect(host.textContent!.split("Title a").length - 1).toBe(2);
  });
});

describe("and that one read is conditional", () => {
  test("the rail asks with the tag it was given, and keeps its rows on a 304", async () => {
    const requests = stubRail((request) => (request.ifNoneMatch === "tag-1" ? { status: 304, etag: "tag-1" } : { etag: "tag-1", body: page() }));
    const host = await mountRail();
    expect(liveReads(requests)[0]!.ifNoneMatch).toBeUndefined();
    await nextPass();
    const reads = liveReads(requests);
    expect(reads).toHaveLength(2);
    expect(reads[1]!.ifNoneMatch).toBe("tag-1");
    expect(host.textContent).toContain("Title a");
  });

  test("a Mac that mints no tag is asked with its revision cursor, and unchanged keeps the rows", async () => {
    const requests = stubRail((request) =>
      request.search === "?since=7" ? { body: { unchanged: true, revision: 7 } } : { body: page({ revision: 7 }) },
    );
    const host = await mountRail();
    await nextPass();
    expect(liveReads(requests).map((request) => request.search)).toEqual(["", "?since=7"]);
    expect(host.textContent).toContain("Title a");
  });

  test("with neither a tag nor a revision, every pass is a full read", async () => {
    const requests = stubRail(() => ({ body: page() }));
    await mountRail();
    await nextPass();
    expect(liveReads(requests).map(({ search, ifNoneMatch }) => ({ search, ifNoneMatch }))).toEqual([
      { search: "", ifNoneMatch: undefined },
      { search: "", ifNoneMatch: undefined },
    ]);
  });

  test("each Mac's tag goes back to that Mac only", async () => {
    const answer = (request: RailRequest): LiveAnswer => ({ etag: request.path.includes("/hosts/mini/") ? "mini-tag" : "local-tag", body: page() });
    const requests = stubRail(answer, [mini]);
    await mountRail();
    await nextPass();
    const second = liveReads(requests).slice(2);
    expect(second.find((request) => request.path === "/api/engine/v2/sessions/live")!.ifNoneMatch).toBe("local-tag");
    expect(second.find((request) => request.path === "/api/engine/v2/hosts/mini/api/sessions/live")!.ifNoneMatch).toBe("mini-tag");
  });

  test("opening the Settled shelf reads the shelf beside the list", async () => {
    const requests = stubRail((request) => (request.search === "?all=1&shelf=1"
      ? { body: page({ sessions: [liveRow("done", { settledOverride: "settled" })] }) }
      : { body: page({ revision: 7, settledByProject: { p1: 1 } }) }));
    const host = await mountRail();
    await click(shelfButton(host));
    expect(liveReads(requests).at(-1)!.search).toBe("?all=1&shelf=1");
    expect(host.textContent).toContain("Title done");
    expect(host.textContent).toContain("Title a");
  });

  test("an open shelf is not read again while the list is unchanged", async () => {
    const requests = stubRail((request) => (request.search.includes("shelf")
      ? { etag: "shelf-1", body: page({ sessions: [liveRow("done", { settledOverride: "settled" })] }) }
      : request.ifNoneMatch === "lean-1" ? { status: 304, etag: "lean-1" } : { etag: "lean-1", body: page({ settledByProject: { p1: 1 } }) }));
    const host = await mountRail();
    await click(shelfButton(host));
    const before = liveReads(requests).length;
    await nextPass();
    expect(liveReads(requests).slice(before).map((request) => request.search)).toEqual([""]);
    expect(host.textContent).toContain("Title done");
  });
});
