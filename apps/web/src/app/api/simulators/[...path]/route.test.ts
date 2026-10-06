import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hubVideo, simulatorEngine } from "../../../../../../engine/test/fake-simulator-hub";
import { GET, POST } from "./route";

const saved = { TELAR_HOME: process.env.TELAR_HOME, TELAR_COCKPIT: process.env.TELAR_COCKPIT };
const cleanups: Array<() => unknown> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function cockpit(video?: () => ReadableStream<Uint8Array>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "telar-simulators-api-"));
  process.env.TELAR_HOME = home;
  process.env.TELAR_COCKPIT = "1";
  const running = await simulatorEngine({ ready: true, engineRoot: path.join(home, "engine"), ...(video ? { video } : {}) });
  cleanups.push(() => fs.rmSync(home, { recursive: true, force: true }), running.close);
  return running;
}

const context = (segments: string[]) => ({ params: Promise.resolve({ path: segments }) });

test("the cockpit streams a simulator through the engine, and the engine's refusals pass through", async () => {
  const { hub } = await cockpit();
  const segments = ["hub", "vendor", "serve-sim", "helper", "A1B2-UDID", "stream.mjpeg"];
  const stream = await GET(new Request(`http://cockpit.test/api/simulators/${segments.join("/")}?ticket=stk_x`, { headers: { cookie: "telar_device=x" } }), context(segments));
  expect(stream.status).toBe(200);
  expect(await stream.text()).toBe("--frame\r\njpeg");
  expect(hub.requests.at(-1)?.search).toBe("");
  const exec = await POST(new Request("http://cockpit.test/api/simulators/hub/vendor/serve-sim/exec", { method: "POST", body: "{}" }), context(["hub", "vendor", "serve-sim", "exec"]));
  expect(exec.status).toBe(404);
});

test("the cockpit hands on each video chunk as soon as the hub writes it", async () => {
  const hub = hubVideo(new Uint8Array([0, 0, 0, 2, 2, 7]));
  await cockpit(hub.video);
  const segments = ["hub", "vendor", "serve-sim", "helper", "A1B2-UDID", "stream.avcc"];
  const reader = (await GET(new Request(`http://cockpit.test/api/simulators/${segments.join("/")}`), context(segments))).body!.getReader();
  expect((await reader.read()).value).toEqual(new Uint8Array([0, 0, 0, 2, 2, 7]));
  hub.write(new Uint8Array([0, 0, 0, 2, 3, 8]));
  expect((await reader.read()).value).toEqual(new Uint8Array([0, 0, 0, 2, 3, 8]));
  hub.end();
  expect((await reader.read()).done).toBe(true);
});
