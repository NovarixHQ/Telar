import { afterAll, beforeAll, expect, test } from "bun:test";
import { textOf } from "./helpers";
import { BrowserRuntime } from "./runtime";

const real = process.env.TELAR_REAL_BROWSER_DIR;
const browser = real ? new BrowserRuntime({ browsersPath: real, autoInstall: false, installExitHandler: false }) : null;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: () => new Response("<title>Telar</title><h1>Hello from the host</h1><button>Go</button>", { headers: { "content-type": "text/html" } }) });
});
afterAll(async () => {
  await browser?.close();
  server.stop(true);
});

test.skipIf(!real)("the engine's own Chromium navigates and reads the page back", async () => {
  const url = `http://127.0.0.1:${server.port}/`;
  const navigated = await browser!.call("scope", "browser_navigate", { url });
  expect(navigated.isError).toBeFalsy();
  const snapshot = await browser!.call("scope", "browser_snapshot");
  expect(textOf(snapshot)).toContain("Hello from the host");
  const state = await browser!.state("scope", { screenshot: false });
  expect(state.tabs.map((tab) => tab.url)).toContain(url);
}, 120_000);
