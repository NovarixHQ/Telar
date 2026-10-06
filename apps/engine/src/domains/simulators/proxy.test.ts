import { afterEach, expect, test } from "bun:test";
import { simulatorEngine } from "../../../test/fake-simulator-hub";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function engine(ready = true) {
  const running = await simulatorEngine({ ready });
  closers.push(running.close);
  return running;
}

const STREAM = "/v2/simulators/hub/vendor/serve-sim/helper/A1B2-UDID/stream.mjpeg";

test("a stream is piped from the hub without the ticket, the caller's credentials or caching", async () => {
  const { request, hub } = await engine();
  const answer = await request(`${STREAM}?ticket=stk_secret&fps=30`, { headers: { cookie: "telar_device=x", "x-telar-host": "host-secret", accept: "multipart/x-mixed-replace", origin: "http://cockpit.test" } });
  expect(answer.status).toBe(200);
  expect(answer.headers.get("content-type")).toBe("multipart/x-mixed-replace; boundary=frame");
  expect(answer.headers.get("cache-control")).toBe("no-store, no-transform");
  expect(answer.headers.get("content-encoding")).toBeNull();
  expect(await answer.text()).toBe("--frame\r\njpeg");
  const seen = hub.requests.at(-1)!;
  expect(seen.search).toBe("?fps=30");
  expect(seen.headers).toEqual({ accept: "multipart/x-mixed-replace", origin: "http://127.0.0.1:4321" });
});

test("the hub's shell, dashboard and any other unlisted route are never reached", async () => {
  const { request, hub } = await engine();
  const before = hub.requests.length;
  for (const [path, method] of [["/vendor/serve-sim/exec", "POST"], ["/", "GET"], ["/vendor/serve-sim/helper/A1B2-UDID/panel/2/stream.avcc", "GET"], ["/api/devices/boot", "POST"]] as const) {
    expect((await request(`/v2/simulators/hub${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) })).status).toBe(404);
  }
  expect(hub.requests.length).toBe(before);
});

test("only the listed routes take a write, and a write's body reaches the hub", async () => {
  const { request, hub } = await engine();
  expect((await request("/v2/simulators/hub/vendor/serve-sim/helper/A1B2-UDID/config", { method: "POST", body: "{}" })).status).toBe(405);
  const fold = await request("/v2/simulators/hub/vendor/serve-emu/api/fold?device=emulator-5554", { method: "POST", body: '{"posture":"open"}', headers: { "content-type": "application/json" } });
  expect(await fold.json()).toEqual({ hub: "/vendor/serve-emu/api/fold" });
  expect(hub.requests.at(-1)).toMatchObject({ method: "POST", search: "?device=emulator-5554", text: '{"posture":"open"}' });
});

test("with simulators off the proxy answers 503 and starts nothing", async () => {
  const { request, starts } = await engine(false);
  const answer = await request(STREAM);
  expect(answer.status).toBe(503);
  expect(starts).toEqual([]);
});
