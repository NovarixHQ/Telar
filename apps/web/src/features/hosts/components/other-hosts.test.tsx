import { expect, test } from "bun:test";
import { click, flush, installTestDom, mount, type } from "@/test/dom";
import { ComputerRows } from "./other-hosts";

installTestDom();

test("a computer that can't be forgotten says so in its own row", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") return Response.json({ error: { code: "conflict", message: "That computer is still syncing." } }, { status: 409 });
    return Response.json({ hosts: [{ id: "mini", name: "Mac mini", baseUrl: "http://mini:3000" }] });
  }) as typeof fetch;
  const { host } = await mount(<ComputerRows />);
  await flush(() => Boolean(host.textContent?.includes("Mac mini")));
  await click(host.querySelector('[aria-label="Forget Mac mini"]')!);
  const row = host.querySelector('[aria-label="Forget Mac mini"]')!.closest('[tabindex="-1"]')!;
  expect(row.querySelector('[role="alert"]')?.textContent).toContain("That computer is still syncing.");
});

test("a user@host is set up over ssh by the desktop, then paired through the forward it opened", async () => {
  const requests: { url: string; body?: unknown }[] = [];
  const asked: string[] = [];
  (window as unknown as { telarDesktop: unknown }).telarDesktop = {
    host: {
      runsLocalEngine: true,
      get: async () => ({ local: true, remote: null }),
      connect: async () => undefined,
      setLocal: async () => undefined,
      forget: async () => undefined,
      sshPair: async (target: string) => (asked.push(target), { pairingUrl: "http://127.0.0.1:41001/pair#token=12345678", name: "box" }),
      sshRelease: async () => true,
    },
  };
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return Response.json(init?.method === "POST" ? { host: { id: "box", name: "box", baseUrl: "http://127.0.0.1:41001" } } : { hosts: [] });
    }) as typeof fetch;
    const { host } = await mount(<ComputerRows />);
    await flush(() => Boolean(host.querySelector('input[aria-label^="Pairing link or user@host"]')));
    await type(host.querySelector<HTMLInputElement>('input[aria-label^="Pairing link or user@host"]')!, "me@box");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Pair")!);
    await flush(() => requests.some((request) => request.body));
    expect(asked).toEqual(["me@box"]);
    expect(requests.find((request) => request.body)?.body).toEqual({ pairingUrl: "http://127.0.0.1:41001/pair#token=12345678", name: "box" });
  } finally {
    delete (window as unknown as { telarDesktop?: unknown }).telarDesktop;
  }
});
