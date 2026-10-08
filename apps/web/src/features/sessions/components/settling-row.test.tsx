import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_INBOX_POLICY, type InboxPolicy } from "@telar/engine-client";
import { forgetInboxPolicies } from "../inbox-policy";
import { SettingsGroup } from "@/features/settings";
import { SettlingRow } from "./settling-row";

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
        <SettlingRow />
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

const SWITCH = "Settle sessions";
const WINDOW = "Settle sessions after";

test("one switch turns the single settle window off and on", async () => {
  const view = await mount();
  await view.click(view.labelled(SWITCH));
  expect(view.labelled(WINDOW)).toBeNull();
  await view.click(view.labelled(SWITCH));
  expect(patches).toEqual([{ autoSettleAfterHours: null }, { autoSettleAfterHours: DEFAULT_INBOX_POLICY.autoSettleAfterHours }]);
  expect(view.host.querySelector(`#settings-row-organization-settle-sessions [aria-label="${WINDOW}"]`)).not.toBeNull();
  view.done();
});

test("the window reverts to the protocol's default", async () => {
  policy = { autoSettleAfterHours: 5 };
  const view = await mount();
  await view.click(view.host.querySelector('#settings-row-organization-settle-sessions [aria-label="Revert to the default"]'));
  expect(patches).toEqual([{ autoSettleAfterHours: DEFAULT_INBOX_POLICY.autoSettleAfterHours }]);
  view.done();
});

test("typing a duration patches the window", async () => {
  policy = { autoSettleAfterHours: 24 };
  const view = await mount();
  await view.type(WINDOW, "3");
  expect(patches).toEqual([{ autoSettleAfterHours: 72 }]);
  view.done();
});
