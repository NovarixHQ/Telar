import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ProviderInstance } from "@telar/engine-client";
import { UsageLimitsField } from "./provider-option-fields";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const codex: ProviderInstance = { id: "codex", driver: "codex", enabled: true, env: [], createdAt: 1, updatedAt: 1 };

async function pressShow(answer: Response) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return answer;
  }) as typeof fetch;
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<UsageLimitsField instance={codex} />));
  const button = [...host.querySelectorAll("button")].find((element) => element.textContent === "Show")!;
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { host, asked };
}

test("Show reads the login's windows and lists each one's use", async () => {
  const windows = [
    { key: "primary", label: "5 h", usedPercent: 42.4 },
    { key: "secondary", label: "week", usedPercent: 18 },
  ];
  const { host, asked } = await pressShow(Response.json({ windows }));
  expect(asked).toEqual(["/api/provider-instances/codex/limits"]);
  expect(host.textContent).toContain("5 h: 42% · week: 18%");
  expect(host.textContent).toContain("Refresh");
});

test("a refused read says why instead of showing numbers", async () => {
  const { host } = await pressShow(Response.json({ error: { code: "unavailable", message: "codex is not on PATH" } }, { status: 503 }));
  expect(host.textContent).toContain("codex is not on PATH");
});
