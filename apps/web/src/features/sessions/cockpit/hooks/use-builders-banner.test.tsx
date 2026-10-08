import { describe, expect, test } from "bun:test";
import type { Session, SessionChild } from "@telar/engine-client";
import { ComposerBanners } from "@/features/composer/components/composer-banners";
import { buttonLabelled, click, flush, installTestDom, mount } from "@/test/dom";
import { useBuildersBanner } from "./use-builders-banner";

installTestDom();

const SESSION = { id: "parent" } as Session;
const child = (sessionId: string, state: SessionChild["state"], parentRunId = "run_a"): SessionChild => ({ sessionId, parentSessionId: "parent", parentRunId, state, startedAt: 1 });

function Banner({ agents }: { agents: SessionChild[] }) {
  const builders = useBuildersBanner("local", agents);
  return <ComposerBanners fresh={false} session={SESSION} {...(builders ? { builders } : {})} />;
}

describe("the builders notice above the composer", () => {
  test("counts the batch still out, and earlier finished batches not at all", async () => {
    const { host } = await mount(<Banner agents={[child("a", "working"), child("b", "working"), child("c", "done"), child("old", "done", "run_old")]} />);
    expect(host.textContent).toContain("2 builders working · 1 done");
  });

  test("is gone once nothing is out", async () => {
    const { host } = await mount(<Banner agents={[child("a", "done"), child("b", "failed")]} />);
    expect(buttonLabelled("Stop all", host)).toBeUndefined();
  });

  test("Stop all stops every builder still out, and holds while it does", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const stops: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      stops.push(`${init?.method} ${new URL(String(input), "http://localhost").pathname}`);
      await held;
      return Response.json({ stopped: [] });
    }) as typeof fetch;
    const { host } = await mount(<Banner agents={[child("a", "working"), child("b", "waiting"), child("c", "done")]} />);
    await click(buttonLabelled("Stop all", host));
    expect(stops.sort()).toEqual(["POST /api/sessions/a/stop", "POST /api/sessions/b/stop"]);
    expect(buttonLabelled("Stopping…", host)?.disabled).toBe(true);
    release();
    await flush(() => Boolean(buttonLabelled("Stop all", host)));
    expect(buttonLabelled("Stop all", host)?.disabled).toBe(false);
  });
});
