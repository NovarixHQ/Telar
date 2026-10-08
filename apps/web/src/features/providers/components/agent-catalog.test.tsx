import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { AgentCatalog as Catalog } from "@telar/engine-client";
import { AgentCatalog } from "./agent-catalog";

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

async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50 && !condition(); turn++) await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(condition()).toBeTrue();
}

async function mount(catalogs: Catalog[], install: () => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return String(input).endsWith("/install") ? install() : Response.json(catalogs.length > 1 ? catalogs.shift() : catalogs[0]);
  }) as typeof fetch;
  const installed: string[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<AgentCatalog onInstalled={(id) => installed.push(id)} />));
  await until(() => host.textContent?.includes("Sample") ?? false);
  const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent === label) as HTMLButtonElement | undefined;
  return { host, calls, installed, button };
}

const sample = { id: "sample", name: "Sample", version: "1.2.3", description: "An agent", distribution: "binary" as const, verified: true };

test("each agent says how it installs, and one with nothing for this Mac cannot be installed", async () => {
  const { host, button } = await mount([{ agents: [sample, { id: "far", name: "Far", version: "1.0.0", description: "", verified: false }] }], () => Response.json({}));
  expect(host.textContent).toContain("v1.2.3 · Download · checksum verified");
  expect(host.textContent).toContain("Nothing to install on this Mac");
  expect([...host.querySelectorAll("button")].filter((element) => element.textContent === "Install").map((element) => element.disabled)).toEqual([false, true]);
  expect(button("Install")).toBeDefined();
});

test("installing adds the login and the row then reads as installed", async () => {
  const after = { agents: [{ ...sample, installed: { version: "1.2.3", instanceId: "agent_sample" } }] };
  const { host, calls, installed, button } = await mount([{ agents: [sample] }, after], () => Response.json({ providerInstance: { id: "agent_sample" } }));
  await act(async () => button("Install")!.click());
  await until(() => host.textContent?.includes("Installed") ?? false);
  expect(calls).toContain("POST /api/agent-catalog/sample/install");
  expect(installed).toEqual(["agent_sample"]);
  expect(host.textContent).toContain("Installed");
});

test("a failed install says why on the agent's row", async () => {
  const { host, button } = await mount([{ agents: [sample] }], () =>
    Response.json({ error: { code: "provider_unavailable", message: "Sample could not be installed: the download does not match the registry's sha256" } }, { status: 502 }),
  );
  await act(async () => button("Install")!.click());
  await until(() => host.textContent?.includes("does not match the registry's sha256") ?? false);
});
