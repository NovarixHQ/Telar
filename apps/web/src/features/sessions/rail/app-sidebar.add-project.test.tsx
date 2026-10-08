import { expect, test } from "bun:test";
import { buttonLabelled, click, flush, installTestDom, press } from "@/test/dom";
import { typeInto } from "@/test/type-into";
import { liveRow, mountRail, project, pushes, stubRail } from "@/test/rail";
import { canvasHref } from "../session-list";

installTestDom();

test("adding a project from the rail opens the new project's canvas", async () => {
  stubRail(() => ({ body: { projects: [project("p1", "One")], sessions: [liveRow("a")] } }));
  const rail = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/fs") return Response.json({ path: "/Users/me/code/telar", name: "telar", parent: "/", home: "/Users/me", dirs: [] });
    if (path === "/api/projects" && init?.method === "POST") return Response.json({ project: { id: "p_new", name: "telar" } });
    return rail(input, init);
  }) as typeof fetch;

  const host = await mountRail();
  await click(host.querySelector<HTMLElement>('[aria-label="Add project"]')!);
  await flush(() => Boolean(document.querySelector('[role="combobox"]')));
  await typeInto(document.querySelector<HTMLInputElement>('[role="combobox"]')!, "/Users/me/code/telar");
  await press(document.querySelector<HTMLElement>('[role="option"]')!);
  await flush(() => Boolean(buttonLabelled("Add⌘↵")));
  await click(buttonLabelled("Add⌘↵")!);
  await flush(() => pushes.length > 0);

  expect(pushes).toEqual([canvasHref("p_new")]);
});
