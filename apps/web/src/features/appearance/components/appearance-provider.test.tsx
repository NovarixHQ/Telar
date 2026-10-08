import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { buttonLabelled, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { useAppearance } from "../appearance";
import { AppearanceProvider } from "./appearance-provider";

installTestDom();

// Delays of a second or more wait here until `runDebounced`; zero-delay timers stay real so `flush` works.
const pending = new Map<number, () => void>();
const [realSetTimeout, realClearTimeout] = [globalThis.setTimeout, globalThis.clearTimeout];
let nextId = 1_000_000;
beforeAll(() => {
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    if (!ms || ms < 1000) return realSetTimeout(fn, ms);
    pending.set(++nextId, fn);
    return nextId;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    if (!pending.delete(id)) realClearTimeout(id);
  }) as typeof clearTimeout;
});
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

async function runDebounced() {
  const due = [...pending.values()];
  pending.clear();
  await act(async () => due.forEach((fn) => fn()));
  await flush();
}

function AccentButton() {
  const { setAppearance } = useAppearance();
  return <button onClick={() => setAppearance({ accent: "rose" })}>Rose</button>;
}

const hostAppearance = {
  version: 3,
  scheme: "light",
  translucent: false,
  frost: "blur",
  composition: { light: { base: "#c88337", layers: [], overrides: {} }, dark: { base: "#252525", layers: [], overrides: {} } },
  images: {},
  accent: "sea",
  fontSize: 15,
};

const stored = () => JSON.parse(window.localStorage.getItem("telar-appearance") ?? "{}") as Record<string, unknown>;

test("a window wears the host's appearance, never overwrites it with its own defaults, and shares what it changes", async () => {
  window.localStorage.setItem("telar-looks", "[]");
  const calls = stubFetch({
    "GET /api/appearance": () => ({ appearance: hostAppearance, updatedAt: 7 }),
    "PUT /api/appearance": () => ({ ok: true, updatedAt: 8, etag: '"a8"' }),
  });
  const { host } = await mount(
    <AppearanceProvider>
      <AccentButton />
    </AppearanceProvider>,
  );
  await flush(() => stored().accent === "sea");

  expect(stored()).toMatchObject({ accent: "sea", fontSize: 15 });
  expect(window.localStorage.getItem("telar-theme")).toBe("light");
  expect(JSON.parse(window.localStorage.getItem("telar-composition") ?? "{}").light.base).toBe("#c88337");
  expect(window.localStorage.getItem("telar-looks")).toBeNull();

  await runDebounced();
  expect(calls.filter((call) => call.route === "PUT /api/appearance")).toEqual([]);

  await click(buttonLabelled("Rose", host));
  await runDebounced();
  const puts = calls.filter((call) => call.route === "PUT /api/appearance");
  expect(puts).toHaveLength(1);
  expect(puts[0]!.body).toMatchObject({ version: 3, accent: "rose", fontSize: 15, scheme: "light", composition: { light: { base: "#c88337" } } });
});
