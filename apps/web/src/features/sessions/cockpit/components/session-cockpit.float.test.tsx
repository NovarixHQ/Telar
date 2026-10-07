import { expect, mock, test } from "bun:test";
import { act } from "react";
import type { Session, SimulatorSummary } from "@telar/engine-client";
import { flush, installTestDom, mount, stubBoxSize } from "@/test/dom";

installTestDom();
stubBoxSize(800, 600);
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/projects/project_1/sessions/session_float",
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionCockpit } = await import("./session-cockpit");
const { SidebarProvider } = await import("@/ui/sidebar");
const { floatKey, floatSimulator } = await import("@/features/simulators/float");

const iPhone: SimulatorSummary = { id: "A1B2", platform: "ios", name: "iPhone 16", version: "iOS 18.0", booted: true, physical: false };

const session = {
  id: "session_float",
  title: "Floating",
  projectId: "project_1",
  environmentId: "env_1",
  state: "active",
  createdAt: 1,
  updatedAt: 1,
  providerInstanceId: "instance_1",
  driver: "claude",
  workspace: { mode: "local", path: "/tmp/project_1" },
  envMode: "local",
  runtimeMode: "standard",
  interactionMode: "interactive",
  detached: false,
  activity: "idle",
} as unknown as Session;

function wire() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/bootstrap")) {
      return Response.json({
        session,
        turns: [{ runId: "run_1", sessionId: session.id, sequence: 1, input: "ask", state: "completed", acceptedAt: 1, updatedAt: 1, resultText: "the answer" }],
        items: [], tasks: [], requests: [], cursor: 1, events: [], subscriptions: [],
      });
    }
    if (url.includes("/delta")) return Response.json({ reset: false, events: [], cursor: 1 });
    if (url.includes("/events")) return Response.json({ events: [], cursor: 1, more: false });
    if (url.includes("/browser")) return Response.json({ browser: { tabs: [], canStart: false } });
    if (url.includes("/projects")) return Response.json({ projects: [{ id: "project_1", name: "exoplanets", root: "/tmp" }] });
    if (url.includes("/session-defaults")) return Response.json({ sessionDefaults: { envMode: "local" } });
    if (url.includes("/inbox")) return Response.json({ inbox: {} });
    if (url.includes("/models")) return Response.json({ catalogue: { models: [] } });
    return Response.json({});
  }) as typeof fetch;
}

test("a floated simulator lives over the transcript and composer, never over the masthead", async () => {
  wire();
  const { host } = await mount(
    <SidebarProvider>
      <SessionCockpit projectId="project_1" sessionId={session.id} projectName="exoplanets" />
    </SidebarProvider>,
  );
  await flush(() => host.textContent?.includes("the answer") ?? false);
  await act(async () => floatSimulator(floatKey("local", session.id), iPhone));
  const float = () => host.querySelector('[aria-label="iPhone 16, floating"]');
  await flush(() => Boolean(float()));

  const room = float()!.parentElement!.parentElement!;
  const masthead = host.querySelector("header")!;
  expect(masthead.textContent).toContain("Floating");
  expect(room.contains(masthead)).toBe(false);
  expect(room.textContent).toContain("the answer");
  expect(room.querySelector('[role="textbox"], textarea')).not.toBeNull();
});
