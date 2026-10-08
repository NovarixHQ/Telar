import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_INBOX_POLICY, DEFAULT_SETTLE_DELEGATED_AFTER_HOURS, type InboxPolicy } from "@telar/engine-client";
import { forgetInboxPolicies } from "../inbox-policy";
import { SettingsGroup } from "@/features/settings";
import { SettlingRows } from "./settling-rows";

GlobalRegistrator.register({ url: "http://localhost/settings" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let policy: InboxPolicy;
let patches: Record<string, unknown>[] = [];

const realFetch = globalThis.fetch;
const realSetTimeout = window.setTimeout;

beforeEach(() => {
  forgetInboxPolicies();
  policy = { ...DEFAULT_INBOX_POLICY };
  patches = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body));
      patches.push(patch);
      policy = { ...policy, ...patch };
    }
    return new Response(JSON.stringify({ inbox: policy }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  window.setTimeout = ((fn: () => void) => {
    queueMicrotask(fn);
    return 0;
  }) as unknown as typeof window.setTimeout;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.setTimeout = realSetTimeout;
});

afterAll(async () => await GlobalRegistrator.unregister());

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(async () => await Promise.resolve());
};

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(
      <SettingsGroup title="Organization">
        <SettlingRows />
      </SettingsGroup>,
    ));
  await flush();
  const labelled = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
  return {
    host,
    labelled,
    click: async (element: Element | null) => {
      await act(async () => (element as HTMLElement).click());
      await flush();
    },
    type: async (label: string, value: string) => {
      const input = labelled(label)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await flush();
    },
    done: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const QUIET = "Settle quiet sessions";
const DELEGATED = "Settle delegated sessions";
const QUIET_WINDOW = "Settle quiet sessions after";
const DELEGATED_WINDOW = "Settle delegated sessions after";

test("each switch patches its own key only", async () => {
  const view = await mount();
  await view.click(view.labelled(DELEGATED));
  await view.click(view.labelled(QUIET));
  expect(patches).toEqual([{ settleDelegatedAfterHours: null }, { autoSettleAfterHours: null }]);
  view.done();
});

test("each duration sits in its switch's row and appears only while the switch is on", async () => {
  policy = { ...policy, autoSettleAfterHours: null };
  const view = await mount();
  expect(view.labelled(QUIET_WINDOW)).toBeNull();
  expect(view.labelled(DELEGATED_WINDOW)).not.toBeNull();
  await view.click(view.labelled(DELEGATED));
  expect(view.labelled(DELEGATED_WINDOW)).toBeNull();
  await view.click(view.labelled(QUIET));
  expect(view.host.querySelector(`#settings-row-organization-settle-quiet-sessions [aria-label="${QUIET_WINDOW}"]`)).not.toBeNull();
  view.done();
});

test("the delegated window reverts to the protocol's default, an hour", async () => {
  expect(DEFAULT_INBOX_POLICY.settleDelegatedAfterHours).toBe(DEFAULT_SETTLE_DELEGATED_AFTER_HOURS);
  expect(DEFAULT_SETTLE_DELEGATED_AFTER_HOURS).toBe(1);
  expect(DEFAULT_INBOX_POLICY.autoSettleAfterHours).not.toBe(DEFAULT_SETTLE_DELEGATED_AFTER_HOURS);
  policy = { ...policy, settleDelegatedAfterHours: 5 };
  const view = await mount();
  await view.click(view.host.querySelector('#settings-row-organization-settle-delegated-sessions [aria-label="Revert to the default"]'));
  expect(patches).toEqual([{ settleDelegatedAfterHours: DEFAULT_SETTLE_DELEGATED_AFTER_HOURS }]);
  view.done();
});

test("typing a duration patches that window alone", async () => {
  const view = await mount();
  await view.type(DELEGATED_WINDOW, "3");
  expect(patches).toEqual([{ settleDelegatedAfterHours: 3 }]);
  view.done();
});
