import { expect, test } from "bun:test";
import { act } from "react";
import { flush, installTestDom, mount } from "@/test/dom";
import { liveRow, loadRail, project, stubRail } from "@/test/rail";

installTestDom();


test("⌘K opens the palette on a page with no rail, with the conversations in it", async () => {
  stubRail(() => ({ body: { projects: [project("p1", "Alpha")], sessions: [liveRow("s1", { title: "Fix the rail" })] } }));
  const { RaillessCommands } = await loadRail();
  const { SidebarProvider } = await import("@/ui/sidebar");
  await mount(
    <SidebarProvider>
      <RaillessCommands />
    </SidebarProvider>,
  );
  await flush();
  expect(document.querySelector('[role="combobox"]')).toBeNull();

  const isMac = /Mac/.test(navigator.platform);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: isMac, ctrlKey: !isMac, bubbles: true, cancelable: true }));
  });
  await flush(() => document.querySelector('[role="combobox"]') !== null);

  expect(document.querySelector('[role="combobox"]')?.getAttribute("aria-label")).toBe("Search commands, settings, projects and sessions");
  const conversations = document.querySelector('[role="group"][aria-label="Recent sessions"]');
  expect(conversations?.textContent).toContain("Fix the rail");
});
