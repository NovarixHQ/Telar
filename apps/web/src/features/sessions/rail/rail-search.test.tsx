import { describe, expect, test } from "bun:test";
import { flush, installTestDom } from "@/test/dom";
import { liveRow, mountRail, project, stubRail } from "@/test/rail";
import { typeInto } from "@/test/type-into";

installTestDom();

describe("searching the rail", () => {
  test("look-alike sessions show the branch and age that tell them apart", async () => {
    const sessions = [
      liveRow("a", { title: "Run feature smoke", workspace: { mode: "worktree", branch: "telar/smoke-one" }, idleHours: 2 }),
      liveRow("b", { title: "Run feature smoke", workspace: { mode: "worktree", branch: "telar/smoke-two" }, idleHours: 30 }),
    ];
    stubRail(() => ({ body: { projects: [project("p1", "One")], sessions } }));
    const host = await mountRail();
    await typeInto(host.querySelector<HTMLInputElement>('input[aria-label="Search sessions"]')!, "smoke");
    await flush();
    const options = [...host.querySelectorAll('[role="option"]')].map((option) => option.textContent);
    expect(options).toHaveLength(2);
    expect(options[0]).toContain("telar/smoke-one");
    expect(options[0]).toContain("2h");
    expect(options[1]).toContain("telar/smoke-two");
    expect(options[1]).toContain("1d");
  });
});
