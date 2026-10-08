import { describe, expect, test } from "bun:test";
import { installTestDom, mount } from "@/test/dom";
import { CommitBox } from "./commit-box";

installTestDom();

const box = (over: { files?: number; busy?: boolean; countIncomplete?: boolean } = {}) =>
  mount(<CommitBox sessionId="s1" suggestion="Fix it" files={over.files ?? 2} busy={over.busy ?? false} {...(over.countIncomplete ? { countIncomplete: true } : {})} workspacePath="/work" onCommitted={() => {}} />);

const commitButton = (host: HTMLElement) => [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Commit everything"))!;

describe("Commit everything says why it is unavailable", () => {
  test("a clean tree says there is nothing to commit", async () => {
    const { host } = await box({ files: 0 });
    expect(commitButton(host).disabled).toBe(true);
    expect(host.textContent).toContain("Nothing to commit");
  });

  test("a running turn says the agent may be mid-write", async () => {
    const { host } = await box({ busy: true });
    expect(commitButton(host).disabled).toBe(true);
    expect(host.textContent).toContain("mid-write");
  });

  test("changed files leave it available with no reason", async () => {
    const { host } = await box();
    expect(commitButton(host).disabled).toBe(false);
    expect(host.textContent).not.toContain("Nothing to commit");
  });

  test("an uncounted tree may still have changes, so it stays available", async () => {
    const { host } = await box({ files: 0, countIncomplete: true });
    expect(commitButton(host).disabled).toBe(false);
  });
});
