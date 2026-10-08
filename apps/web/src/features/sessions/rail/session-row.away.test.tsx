import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionRow } = await import("./session-row");
const { SidebarProvider } = await import("@/ui/sidebar");
import type { SidebarSession } from "../session-list";

const row = (over: Partial<SidebarSession>) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <SessionRow
        session={
          {
            id: "session_1",
            title: "Exoplanets",
            createdAt: 1,
            updatedAt: 2,
            driver: "claude",
            projectName: "exoplanets",
            activity: "idle",
            ...over,
          } as SidebarSession
        }
        active={false}
        showProject={false}
        renderedAt={10}
        onRowChanged={() => {}}
      />
    </SidebarProvider>,
  );

describe("a row whose project folder is away", () => {
  test("says so with a named icon and explains it on hover, leaving the width to the title", () => {
    const html = row({ projectAvailability: "missing" });
    expect(html).toContain('aria-label="Folder gone"');
    expect(html).toContain("The folder for exoplanets is not on this machine any more.");
    expect(html).not.toContain(">Folder gone<");
  });

  test("a project that is there shows no away mark", () => {
    expect(row({ projectAvailability: "available" })).not.toContain("Folder gone");
  });
});
