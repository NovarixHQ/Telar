import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HostMarksShown } from "@/features/hosts";
import { installTestDom } from "@/test/dom";
import type { SidebarSession } from "../session-list";
import { RowBody } from "./session-row-body";

installTestDom();

const session = (over: Partial<SidebarSession> = {}): SidebarSession =>
  ({ id: "s1", title: "Exoplanets", createdAt: 1, updatedAt: 2, archived: false, driver: "claude", projectName: "exoplanets", ...over }) as SidebarSession;

function card(row: SidebarSession, shown: boolean, trailing: ReactNode = <span>2m</span>): HTMLElement {
  const html = renderToStaticMarkup(
    <HostMarksShown value={shown}>
      <RowBody session={row} showProject marks={null} trailing={trailing} />
    </HostMarksShown>,
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

const firstLine = (host: HTMLElement) => host.firstElementChild!.firstElementChild!;
const mark = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="img"][aria-label^="On "]');

describe("the host mark on a rail row", () => {
  test("is absent when only one host is connected", () => {
    expect(mark(card(session({ hostId: "host_mini", hostName: "mini" }), false))).toBeNull();
    expect(card(session({ hostId: "host_mini", hostName: "mini" }), false).textContent).not.toContain("mini");
  });

  test("names the host in its label and shows its initial, not the name", () => {
    const host = card(session({ hostId: "host_mini", hostName: "mini.lan" }), true);
    expect(mark(host)!.getAttribute("aria-label")).toBe("On mini.lan");
    expect(mark(host)!.getAttribute("title")).toBe("On mini.lan");
    expect(mark(host)!.textContent).toBe("M");
    expect(host.textContent).not.toContain("mini.lan");
  });

  test("marks this computer's sessions too, so every row has one", () => {
    expect(mark(card(session(), true))!.getAttribute("aria-label")).toBe("On this computer");
  });

  test("leads the first line whatever the status beside it", () => {
    const working = card(session({ hostId: "host_mini", hostName: "mini" }), true, <span>Working 3m 12s</span>);
    const idle = card(session({ hostId: "host_mini", hostName: "mini" }), true, <span>1h</span>);
    expect(firstLine(working).firstElementChild).toBe(mark(working));
    expect(firstLine(idle).firstElementChild).toBe(mark(idle));
  });

  test("each host keeps its own colour, and two hosts differ", () => {
    const colour = (hostId: string) => mark(card(session({ hostId, hostName: "mini" }), true))!.style.backgroundColor;
    expect(colour("host_mini")).toBe(colour("host_mini"));
    expect(colour("host_mini")).not.toBe(colour("host_studio"));
  });
});

describe("a rail row", () => {
  test("names the branch beneath the title, so look-alike sessions differ", () => {
    const host = card(session({ worktreeBranch: "telar/smoke-two" }), false);
    expect(host.textContent).toContain("Exoplanets");
    expect(host.textContent).toContain("telar/smoke-two");
  });

  test("names the project when it is not already shown above", () => {
    const html = renderToStaticMarkup(<RowBody session={session()} showProject={false} marks={null} trailing={null} />);
    expect(html).toContain("exoplanets");
  });
});
