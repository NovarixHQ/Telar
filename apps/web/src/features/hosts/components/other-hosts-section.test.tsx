import { expect, test } from "bun:test";
import { click, flush, installTestDom, mount } from "@/test/dom";
import { OtherHostsSection } from "./other-hosts-section";

installTestDom();

test("a computer that can't be forgotten says so in its own row", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") return Response.json({ error: { code: "conflict", message: "That computer is still syncing." } }, { status: 409 });
    return Response.json({ hosts: [{ id: "mini", name: "Mac mini", baseUrl: "http://mini:3000" }] });
  }) as typeof fetch;
  const { host } = await mount(<OtherHostsSection />);
  await flush(() => Boolean(host.textContent?.includes("Mac mini")));
  await click(host.querySelector('[aria-label="Forget Mac mini"]')!);
  const row = host.querySelector('[aria-label="Forget Mac mini"]')!.closest('[tabindex="-1"]')!;
  expect(row.querySelector('[role="alert"]')?.textContent).toContain("That computer is still syncing.");
});
