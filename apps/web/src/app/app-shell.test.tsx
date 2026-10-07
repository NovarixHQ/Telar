import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost/projects/p1/sessions/s1?panel=diff" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

let pathname = "/projects/p1/sessions/s1";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/features/sessions/rail/app-sidebar", () => ({ AppSidebar: () => null }));

const { AppShell } = await import("./app-shell");
const { markNavigation } = await import("@/platform/perf-marks");

test("the shell remembers the last page outside Settings, for Settings › Back", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppShell>page</AppShell>));
  expect(window.sessionStorage.getItem("telar:settings-return")).toBe("/projects/p1/sessions/s1?panel=diff");

  pathname = "/settings";
  window.history.replaceState(null, "", "/settings?section=general");
  await act(async () => root.render(<AppShell>settings</AppShell>));
  expect(window.sessionStorage.getItem("telar:settings-return")).toBe("/projects/p1/sessions/s1?panel=diff");

  markNavigation("idle", pathname);
  await act(async () => root.unmount());
  host.remove();
});
