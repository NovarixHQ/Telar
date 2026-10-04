import { expect, test } from "bun:test";
import { act, useState } from "react";
import { click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import "@/test/rail";
import { applyRowChange } from "../session-mutations";
import type { SidebarSession } from "../session-list";
import { flattenSessions } from "./flat-rail";

installTestDom();

const { FlatSessionList } = await import("./flat-session-list");
const { SidebarProvider } = await import("@/ui/sidebar");

const row = (id: string, extra: Partial<SidebarSession> = {}): SidebarSession =>
  ({ id, title: `title-${id}`, projectId: "p1", projectName: "Telar", activity: "idle", archived: false, driver: "claude", createdAt: 1, updatedAt: 1, ...extra }) as SidebarSession;

const ROWS = [row("parent"), row("other"), row("child", { startedFrom: { sessionId: "parent" } })];

function Rail() {
  const [rows, setRows] = useState(ROWS);
  return (
    <SidebarProvider>
      <FlatSessionList
        entries={flattenSessions({ pinned: [], sessions: rows })}
        expanded={new Set(["parent", "other"])}
        onToggle={() => {}}
        renderedAt={0}
        bandFor={() => "active"}
        onRowChanged={(change) => setRows((current) => applyRowChange(current, change))}
        jumpSlot={() => undefined}
      />
    </SidebarProvider>
  );
}

const answered = (to?: string) => ({
  session: { id: "child", title: "title-child", projectId: "p1", createdAt: 1, updatedAt: 2, state: "active", driver: "claude", workspace: { mode: "local" }, activity: "idle", ...(to ? { startedFrom: { sessionId: to } } : {}) },
});

const nestedUnder = (host: HTMLElement, title: string) =>
  [...(host.querySelector(`[role="group"][aria-label="Started from ${title}"]`)?.querySelectorAll("a") ?? [])].map((link) => link.textContent);

async function openMenuOn(host: HTMLElement, title: string) {
  const link = [...host.querySelectorAll("a")].find((node) => node.textContent?.includes(title))!;
  await act(async () => {
    link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 2 }));
  });
  await flush();
}

const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((node) => node.textContent === label);

test("detaching a sub-session moves its row to the top level", async () => {
  const calls = stubFetch({ "POST /api/sessions/child/handoff": () => answered() });
  const { host } = await mount(<Rail />);
  expect(nestedUnder(host, "title-parent").join()).toContain("title-child");

  await openMenuOn(host, "title-child");
  await click(menuItem("Detach from title-parent"));

  expect(calls.find((call) => call.route === "POST /api/sessions/child/handoff")?.body).toEqual({});
  expect(nestedUnder(host, "title-parent")).toEqual([]);
  expect([...host.querySelectorAll("a")].some((link) => link.textContent?.includes("title-child"))).toBe(true);
});

test("Move to… lists the other sessions and moves the row under the one picked", async () => {
  const calls = stubFetch({ "POST /api/sessions/child/handoff": () => answered("other") });
  const { host } = await mount(<Rail />);

  await openMenuOn(host, "title-child");
  await click(menuItem("Move to…"));
  const choices = [...document.querySelectorAll('[aria-label="Sessions"] button')];
  expect(choices.map((choice) => choice.textContent)).toEqual(["title-otherTelar"]);
  await click(choices[0]);

  expect(calls.find((call) => call.route === "POST /api/sessions/child/handoff")?.body).toEqual({ to: "other" });
  expect(nestedUnder(host, "title-parent")).toEqual([]);
  expect(nestedUnder(host, "title-other").join()).toContain("title-child");
});
