import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RunRow } from "./run-row";
import type { RunApi } from "../run/api";

GlobalRegistrator.register({ url: "http://localhost/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function mount(configurations: { id: string; name: string }[]) {
  const calls: string[] = [];
  const api = {
    configurations: async () => ({ configurations }),
    status: async () => ({ terminals: [] }),
    start: async (_session: string, configId: string) => {
      calls.push(configId);
      return undefined;
    },
  } as unknown as RunApi;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<RunRow sessionId="session_1" api={api} />));
  await act(async () => await new Promise((resolve) => queueMicrotask(() => resolve(undefined))));
  return { host, calls };
}

test("one press runs the first configuration, by name", async () => {
  const { host, calls } = await mount([{ id: "config_dev", name: "dev server" }, { id: "config_test", name: "tests" }]);
  const run = host.querySelector<HTMLButtonElement>('[aria-label="Run dev server"]')!;
  expect(run.textContent).toContain("dev server");
  await act(async () => run.click());
  expect(calls).toEqual(["config_dev"]);
  expect(host.querySelector('[aria-label="Choose what to run"]')).not.toBeNull();
});

test("a project with nothing configured offers to add a configuration", async () => {
  const { host } = await mount([]);
  expect(host.querySelector('[aria-label="Add a run configuration"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Choose what to run"]')).toBeNull();
});
