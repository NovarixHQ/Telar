import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

GlobalRegistrator.register({ url: "http://mini.tailnet:3000/settings" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => await GlobalRegistrator.unregister());

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
}));

const { Dropdown } = await import("./settings-shell");
const { WorkspaceSection } = await import("@/features/projects/components/workspace-section");
const { RailSection } = await import("@/features/sessions/components/rail-section");

async function mountOffline(node: React.ReactNode) {
  const [realFetch, realSetTimeout] = [globalThis.fetch, window.setTimeout];
  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  window.setTimeout = ((fn: () => void) => void queueMicrotask(fn)) as unknown as typeof window.setTimeout;
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  for (let i = 0; i < 20; i++) await act(async () => await Promise.resolve());
  return {
    host,
    done: () => {
      act(() => root.unmount());
      globalThis.fetch = realFetch;
      window.setTimeout = realSetTimeout;
    },
  };
}

test("a dropdown's trigger reads the chosen label, never the value", () => {
  const html = renderToStaticMarkup(<Dropdown value="__auto" onChange={() => {}} options={[{ value: "__auto", label: "Automatic" }]} />);
  expect(html).toContain(">Automatic<");
  expect(html).not.toContain(">__auto<");
});

test("an enumeration setting is a dropdown, and a boolean is still a switch", async () => {
  const view = await mountOffline(
    <>
      <WorkspaceSection />
      <RailSection />
    </>,
  );
  expect(view.host.querySelector('[data-slot="select-trigger"]')).not.toBeNull();
  expect(view.host.querySelector("[aria-pressed]")).toBeNull();
  expect(view.host.querySelector('[role="switch"]')).not.toBeNull();
  view.done();
});
