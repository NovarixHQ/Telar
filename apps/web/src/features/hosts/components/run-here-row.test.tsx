import { afterEach, expect, test } from "bun:test";
import { click, flush, installTestDom, mount } from "@/test/dom";
import { RunHereRow } from "./run-here-row";

installTestDom();

type Calls = string[];
function installHost(host: { runsLocalEngine: boolean; remote: { baseUrl: string; name: string } | null }, calls: Calls, connect?: () => Promise<unknown>) {
  (window as unknown as { telarDesktop: unknown }).telarDesktop = {
    host: {
      ...host,
      connect: connect ?? (async () => calls.push("connect")),
      setLocal: async (on: boolean) => calls.push(`setLocal ${on}`),
      forget: async () => calls.push("forget"),
    },
  };
}
afterEach(() => delete (window as unknown as { telarDesktop?: unknown }).telarDesktop);

test("a browser tab has no such row", async () => {
  const { host } = await mount(<RunHereRow />);
  expect(host.textContent).toBe("");
});

test("with a computer already paired, turning it off switches without asking for a link", async () => {
  const calls: Calls = [];
  installHost({ runsLocalEngine: true, remote: { baseUrl: "http://box:7420", name: "box" } }, calls);
  const { host } = await mount(<RunHereRow />);
  await flush(() => Boolean(host.querySelector('[aria-label="Run Telar on this Mac"]')));
  await click(host.querySelector('[aria-label="Run Telar on this Mac"]')!);
  expect(calls).toEqual(["setLocal false"]);
});

test("with none paired, turning it off asks for the link first and says why a pairing failed", async () => {
  const calls: Calls = [];
  installHost({ runsLocalEngine: true, remote: null }, calls, async () => {
    throw new Error("Error invoking remote method 'telar:host:connect': Error: That code expired.");
  });
  const { host } = await mount(<RunHereRow />);
  await flush(() => Boolean(host.querySelector('[aria-label="Run Telar on this Mac"]')));
  await click(host.querySelector('[aria-label="Run Telar on this Mac"]')!);
  expect(calls).toEqual([]);
  const input = host.querySelector<HTMLInputElement>('[aria-label="Pairing link from the other computer"]')!;
  expect(input).toBeTruthy();
});

test("while using another computer, the row names it and can forget it", async () => {
  const calls: Calls = [];
  installHost({ runsLocalEngine: false, remote: { baseUrl: "http://box:7420", name: "box" } }, calls);
  const { host } = await mount(<RunHereRow />);
  await flush(() => Boolean(host.textContent?.includes("box")));
  const forget = [...host.querySelectorAll("button")].find((button) => button.textContent === "Forget")!;
  await click(forget);
  expect(calls).toEqual(["forget"]);
});
