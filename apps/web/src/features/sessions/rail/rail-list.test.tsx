import { expect, test } from "bun:test";
import { flush, installTestDom, mount } from "@/test/dom";
import { liveRow, loadRail, project } from "@/test/rail";

installTestDom();

function holdLiveRead() {
  let answer: (body: unknown) => void = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/hosts") return Response.json({ hosts: [] });
    if (path === "/api/sessions/live") return new Promise<Response>((resolve) => (answer = (body) => resolve(Response.json(body))));
    return Response.json({ error: { message: `no route ${path}` } }, { status: 404 });
  }) as typeof fetch;
  return (body: unknown) => answer(body);
}

async function mountRail() {
  window.localStorage.clear();
  const { AppSidebarBody } = await loadRail();
  const { SidebarProvider } = await import("@/ui/sidebar");
  const { host } = await mount(
    <SidebarProvider>
      <AppSidebarBody />
    </SidebarProvider>,
  );
  await flush();
  return host;
}

const results = (host: HTMLElement) => host.querySelector("#sidebar-session-results")!;

test("before the first read answers, the rail shows a skeleton, not an empty state", async () => {
  const answer = holdLiveRead();
  const host = await mountRail();
  expect(results(host).querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(results(host).textContent).not.toContain("No projects yet");
  expect(results(host).textContent).not.toContain("No sessions yet");
  answer({ projects: [], sessions: [] });
  await flush();
});

test("once the engine answers with no projects, the empty state replaces the skeleton", async () => {
  const answer = holdLiveRead();
  const host = await mountRail();
  answer({ projects: [], sessions: [] });
  await flush(() => results(host).textContent!.includes("No projects yet"));
  expect(results(host).textContent).toContain("No projects yet");
  expect(results(host).querySelector('[aria-busy="true"]')).toBeNull();
});

test("once the engine answers with sessions, they replace the skeleton", async () => {
  const answer = holdLiveRead();
  const host = await mountRail();
  answer({ projects: [project("p1", "One")], sessions: [liveRow("a")] });
  await flush(() => results(host).textContent!.includes("Title a"));
  expect(results(host).textContent).toContain("Title a");
  expect(results(host).querySelector('[aria-busy="true"]')).toBeNull();
});
