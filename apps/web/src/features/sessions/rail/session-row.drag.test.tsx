import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { installTestDom, mount } from "@/test/dom";
import { sessionReference } from "@telar/client/composer";
import type { SidebarSession } from "../session-list";

installTestDom();

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionRow } = await import("./session-row");
const { SidebarProvider } = await import("@/ui/sidebar");

const session: SidebarSession = {
  id: "session_abc",
  title: "Study T3 Code handoff",
  projectId: "p1",
  activity: "idle",
  createdAt: 1,
  updatedAt: 1,
  archived: false,
  driver: "claude",
};

function fakeTransfer() {
  const data = new Map<string, string>();
  return { data, effectAllowed: "none", setData: (type: string, value: string) => void data.set(type, value), types: [] as string[] };
}

async function dragRow(drag?: React.ComponentProps<typeof SessionRow>["drag"]) {
  await mount(
    <SidebarProvider>
      <SessionRow session={session} active={false} showProject={false} variant="slim" band="active" renderedAt={0} onRowChanged={() => {}} {...(drag ? { drag } : {})} />
    </SidebarProvider>,
  );
  const handle = document.querySelector('[draggable="true"]')!;
  const transfer = fakeTransfer();
  const event = new Event("dragstart", { bubbles: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  await act(async () => void handle.dispatchEvent(event));
  return transfer;
}

describe("dragging a rail row toward a message", () => {
  test("carries the same session reference the composer's @ inserts", async () => {
    const transfer = await dragRow();
    expect([...transfer.data.values()]).toContain(JSON.stringify(sessionReference(session)));
    expect(transfer.data.get("text/plain")).toBe(sessionReference(session).text);
    expect(transfer.effectAllowed).toBe("copy");
  });

  test("in a band that reorders, the same drag can still move the row", async () => {
    const moved: string[] = [];
    const noop = () => {};
    const transfer = await dragRow({ dragging: false, insert: null, onDragStart: () => void moved.push("start"), onDragEnd: noop, onDragOver: noop, onDragLeave: noop, onDrop: noop });
    expect(moved).toEqual(["start"]);
    expect(transfer.data.get("text/plain")).toBe(sessionReference(session).text);
    expect(transfer.effectAllowed).toBe("copyMove");
  });
});
