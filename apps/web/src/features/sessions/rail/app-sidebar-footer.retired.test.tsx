import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { AppSidebarFooterRow } = await import("./app-sidebar-footer");

test("the rail footer says Telar is retired and will not be updated", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AppSidebarFooterRow onNavigate={() => {}} />));

  const notice = host.querySelector('[data-slot="retired-notice"]');
  expect(notice?.textContent).toContain("Telar is retired");
  expect(notice?.textContent).toContain("won't be updated");

  await act(async () => root.unmount());
  host.remove();
});
