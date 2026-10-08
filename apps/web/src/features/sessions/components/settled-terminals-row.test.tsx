import { expect, test } from "bun:test";
import { act } from "react";
import { DEFAULT_INBOX_POLICY, type InboxPolicy } from "@telar/engine-client";
import { flush, installTestDom, mount } from "@/test/dom";
import { forgetInboxPolicies } from "../inbox-policy";
import { SettledTerminalsRow } from "./settled-terminals-row";

installTestDom();

test("the settled terminal limit is one count, patched alone", async () => {
  forgetInboxPolicies();
  let policy: InboxPolicy = { ...DEFAULT_INBOX_POLICY };
  const patches: unknown[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body));
      patches.push(patch);
      policy = { ...policy, ...patch };
    }
    return Response.json({ inbox: policy });
  }) as typeof fetch;
  const { host } = await mount(<SettledTerminalsRow />);
  await flush();
  expect(host.textContent).toContain("Terminals settled sessions may keep open");
  const input = host.querySelector<HTMLInputElement>('[aria-label="How many terminals settled sessions may keep open"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
  expect(patches).toEqual([{ settledTerminalLimit: 2 }]);
});
