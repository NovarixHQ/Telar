import { describe, expect, test } from "bun:test";
import { flush, installTestDom, mount } from "@/test/dom";
import { useWorkspaceCardData } from "./use-workspace-card";

installTestDom();

function Probe({ shared }: { shared: boolean }) {
  const { diff } = useWorkspaceCardData("local", "session_1", true, shared, false);
  return <span>{diff ? `+${diff.linesAdded}` : "none"}</span>;
}

async function requestedUrl(shared: boolean): Promise<string> {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const diff = { repository: true, workspacePath: "/fixtures/p", files: [], commits: [], linesAdded: 3, linesRemoved: 0, truncated: false };
    return new Response(JSON.stringify({ diff }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const { host } = await mount(<Probe shared={shared} />);
  await flush(() => host.textContent === "+3");
  expect(host.textContent).toBe("+3");
  return urls[0] ?? "";
}

describe("the Workspace card's diff read", () => {
  test("a local session reads its checkout against HEAD, not the commit it started on", async () => {
    expect(await requestedUrl(true)).toContain("base=");
  });

  test("a worktree session reads against its recorded base", async () => {
    expect(await requestedUrl(false)).not.toContain("base=");
  });
});
