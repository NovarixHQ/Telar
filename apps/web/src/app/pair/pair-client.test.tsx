import { describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { buttonLabelled, click, flush, installTestDom, mount } from "@/test/dom";
import { typeInto } from "@/test/type-into";

mock.module("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined }) }));
const { codeFromInput, formatTyped, PairClient } = await import("./pair-client");

installTestDom();

test("Enter on a retyped code pairs again, and the card shows it is working", async () => {
  const answers: Array<(response: Response) => void> = [];
  globalThis.fetch = (() => new Promise<Response>((resolve) => answers.push(resolve))) as unknown as typeof fetch;
  const { host } = await mount(<PairClient />);
  await flush(() => Boolean(host.querySelector("input")));
  const field = () => host.querySelector("input")!;
  const enter = () => act(async () => field().form!.requestSubmit());

  await typeInto(field(), "48129037");
  await enter();
  answers[0]!(Response.json({ error: { message: "That pairing code has expired." } }, { status: 401 }));
  await flush(() => host.textContent!.includes("expired"));

  await typeInto(field(), "1");
  expect(host.textContent).not.toContain("expired");
  await enter();
  expect(answers).toHaveLength(2);
  expect(field().readOnly).toBe(true);
  expect(host.querySelector("button")!.textContent).toBe("Pairing…");
});

test("pairing this browser again sends the same client id", async () => {
  const sent: { token: string; clientId?: string }[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ error: { message: "That pairing code has expired." } }, { status: 401 });
  }) as typeof fetch;
  const { host } = await mount(<PairClient />);
  await flush(() => Boolean(host.querySelector("input")));
  await typeInto(host.querySelector("input")!, "48129037");
  await click(buttonLabelled("Pair", host));
  await flush(() => host.textContent!.includes("expired"));
  await click(buttonLabelled("Pair", host));
  await flush(() => sent.length === 2);
  expect(sent[0]!.token).toBe("4812 9037");
  expect(sent[0]!.clientId).toMatch(/^[0-9a-f-]{36}$/);
  expect(sent[1]!.clientId).toBe(sent[0]!.clientId);
});

describe("formatTyped", () => {
  test("digits are grouped 4+4 as they are typed; letters are left alone", () => {
    expect(formatTyped("4812")).toBe("4812");
    expect(formatTyped("48129")).toBe("4812 9");
    expect(formatTyped("4812 9037")).toBe("4812 9037");
    expect(formatTyped("4812-9037")).toBe("4812 9037");
    expect(formatTyped("tlr_abc")).toBe("tlr_abc");
    expect(formatTyped("http://h/pair#token=tlr_x")).toBe("http://h/pair#token=tlr_x");
  });
});

describe("codeFromInput", () => {
  test("a bare code is itself, trimmed", () => {
    expect(codeFromInput("  tlr_abc123  ")).toBe("tlr_abc123");
  });

  test("a whole pairing link yields the code in its fragment", () => {
    expect(codeFromInput("http://100.110.136.102:57547/pair#token=37410745")).toBe("37410745");
    expect(codeFromInput("http://127.0.0.1:3000/pair#token=tlr_x&other=1")).toBe("tlr_x");
  });

  test("a link with no token in its fragment is handed on whole for the server to refuse", () => {
    expect(codeFromInput("http://host/pair#nothing")).toBe("http://host/pair#nothing");
  });
});
