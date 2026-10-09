import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import type { JournalItem } from "@telar/client/journal";
import { flush, installTestDom, mount, press } from "@/test/dom";

const pushes: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushes.push(href), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

installTestDom();

const { ForkReply, TranscriptItem } = await import("@/features/transcript");
const { useForkReply } = await import("./use-fork-reply");

const reply: JournalItem = {
  id: "item_1",
  runId: "run_two",
  sessionId: "session_one",
  startedAt: 1,
  completedAt: 2,
  streamedText: "",
  openedBy: 0,
  status: "completed",
  detail: { type: "assistant_message", text: "Added it." },
};

function Forkable({ children, errors }: { children: ReactNode; errors: unknown[] }) {
  const fork = useForkReply("session_one", "local", (error) => void errors.push(error));
  return <ForkReply.Provider value={fork}>{children}</ForkReply.Provider>;
}

describe("Fork from here", () => {
  test("a reply offers it, and pressing it forks at that reply and opens the fork", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ session: { id: "session_fork", projectId: "project_one" } }, { status: 201 });
    }) as typeof fetch;
    pushes.length = 0;
    const errors: unknown[] = [];
    const { host } = await mount(
      <Forkable errors={errors}>
        <TranscriptItem item={reply} meta />
      </Forkable>,
    );

    await press(host.querySelector('button[aria-label="Fork from here"]')!);
    await flush(() => pushes.length > 0);

    expect(calls).toEqual([{ method: "POST", url: "/api/sessions/session_one/fork", body: { runId: "run_two" } }]);
    expect(pushes).toEqual(["/projects/project_one/sessions/session_fork"]);
    expect(errors).toEqual([]);
  });

  test("outside a session that can fork, a reply offers only Copy", async () => {
    const { host } = await mount(<TranscriptItem item={reply} meta />);
    expect(host.querySelector('button[aria-label="Copy"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Fork from here"]')).toBeNull();
  });
});
