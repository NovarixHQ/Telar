import { expect, test } from "bun:test";
import { click, flush, installTestDom, mount, press, stubFetch } from "@/test/dom";
import "@/test/rail";
import type { SessionRowChange } from "../session-mutations";
import type { SidebarSession } from "../session-list";

installTestDom();

const { SessionInboxMenu } = await import("./session-inbox-menu");

const row = (extra: Partial<SidebarSession> = {}): SidebarSession =>
  ({ id: "s1", title: "Fix the rail", projectId: "p1", activity: "idle", archived: false, driver: "claude", createdAt: 1, updatedAt: 1, ...extra }) as SidebarSession;

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const button = (label: string) => [...document.querySelectorAll<HTMLElement>("button, [role^='menuitem']")].find((node) => node.textContent === label);

async function chooseDelete(session: SidebarSession) {
  const calls = stubFetch({ "DELETE /api/sessions/s1": () => ({ deleted: true }) });
  const changes: SessionRowChange[] = [];
  const { host } = await mount(<SessionInboxMenu session={session} now={0} onRowChanged={(change) => changes.push(change)} />);
  await press(host.querySelector('[aria-label="Session actions"]')!);
  await click(button("Delete session"));
  await flush(() => Boolean(dialog()));
  return { calls, changes };
}

test("Delete session asks once, in a dialog that names the worktree it removes", async () => {
  const { calls } = await chooseDelete(row({ worktreeBranch: "telar/fix-rail" }));
  expect(dialog()?.textContent).toContain("Delete “Fix the rail”?");
  expect(dialog()?.textContent).toContain("worktree on telar/fix-rail");
  expect(dialog()?.textContent).toContain("cannot be undone");
  expect(calls).toEqual([]);
});

test("a local session's dialog mentions no worktree", async () => {
  await chooseDelete(row());
  expect(dialog()?.textContent).toContain("This removes its transcript. It cannot be undone.");
  expect(dialog()?.textContent).not.toContain("worktree");
});

test("Cancel closes the dialog and deletes nothing", async () => {
  const { calls, changes } = await chooseDelete(row());
  await click(button("Cancel"));
  await flush(() => !dialog());
  expect(dialog()).toBeNull();
  expect(calls).toEqual([]);
  expect(changes).toEqual([]);
});

test("Delete removes the session once and drops its row", async () => {
  const { calls, changes } = await chooseDelete(row());
  await click(button("Delete"));
  await flush(() => calls.length > 0 && !dialog());
  expect(calls.map((call) => call.route)).toEqual(["DELETE /api/sessions/s1"]);
  expect(changes.some((change) => "removed" in change)).toBe(true);
});
