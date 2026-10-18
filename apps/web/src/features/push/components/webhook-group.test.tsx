import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import type { WebhookStatus } from "@telar/engine-client";
import { buttonLabelled, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { WebhookGroup } from "./webhook-group";

installTestDom();

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function type(label: string, value: string) {
  const input = document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("saving a URL shows where it posts and offers the secret and a test", async () => {
  let saved: WebhookStatus = { configured: false, hasSecret: false };
  const calls = stubFetch({
    "GET /api/engine/v2/push/webhook": () => saved,
    "PUT /api/engine/v2/push/webhook": () => (saved = { configured: true, target: "https://hooks.example.com/…", hasSecret: false }),
    "POST /api/engine/v2/push/webhook/test": () => ({ status: 204 }),
  });
  const { host } = await mount(<WebhookGroup />);
  await flush(() => !(host.querySelector('input[aria-label="Webhook URL"]') as HTMLInputElement | null)?.disabled);
  expect(host.querySelector('input[aria-label="Webhook secret"]')).toBeNull();

  await type("Webhook URL", "https://hooks.example.com/telar");
  await click(buttonLabelled("Save", host));
  expect(calls.find((call) => call.route === "PUT /api/engine/v2/push/webhook")?.body).toEqual({ url: "https://hooks.example.com/telar" });
  await flush(() => Boolean(host.textContent?.includes("https://hooks.example.com/…")));
  expect(host.querySelector('input[aria-label="Webhook secret"]')).not.toBeNull();

  await click(buttonLabelled("Send", host));
  await flush(() => Boolean(host.textContent?.includes("Delivered (204).")));
  expect(host.textContent).toContain("Delivered (204).");
});

test("a secret is saved on its own, without resending the URL", async () => {
  const calls = stubFetch({
    "GET /api/engine/v2/push/webhook": () => ({ configured: true, target: "https://hooks.example.com/…", hasSecret: false }),
    "PUT /api/engine/v2/push/webhook": () => ({ configured: true, target: "https://hooks.example.com/…", hasSecret: true }),
  });
  const { host } = await mount(<WebhookGroup />);
  await flush(() => host.querySelector('input[aria-label="Webhook secret"]') !== null);
  await type("Webhook secret", "s3cret");
  const saves = () => [...host.querySelectorAll("button")].filter((node) => node.textContent?.trim() === "Save");
  await click(saves().at(-1));
  expect(calls.find((call) => call.route === "PUT /api/engine/v2/push/webhook")?.body).toEqual({ secret: "s3cret" });
  await flush(() => (host.querySelector('input[aria-label="Webhook secret"]') as HTMLInputElement).placeholder === "A secret is saved");
  expect((host.querySelector('input[aria-label="Webhook secret"]') as HTMLInputElement).value).toBe("");
});
