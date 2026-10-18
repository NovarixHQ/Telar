import { expect, test } from "bun:test";
import { EngineClientError } from "./errors";
import { httpTransport, type Send } from "./transport";

const sending = (answer: () => Response): { send: Send; seen: { pathname: string; init: RequestInit }[] } => {
  const seen: { pathname: string; init: RequestInit }[] = [];
  return { seen, send: async (pathname, init) => (seen.push({ pathname, init }), answer()) };
};

test("a call becomes one request and its JSON answer comes back", async () => {
  const { send, seen } = sending(() => Response.json({ ok: true }));
  expect(await httpTransport(send).request<{ ok: boolean }>("POST", "/v2/projects", { name: "One" })).toEqual({ ok: true });
  expect(seen[0]!.pathname).toBe("/v2/projects");
  expect(seen[0]!.init).toMatchObject({ method: "POST", body: '{"name":"One"}', headers: { "content-type": "application/json" } });
});

test("an engine refusal carries its code and status; a body that is not JSON is an unavailable engine", async () => {
  const refused = httpTransport(sending(() => Response.json({ error: { code: "conflict", message: "busy" } }, { status: 409 })).send);
  expect(await refused.request("GET", "/v2/x").catch((error: unknown) => error)).toMatchObject({ code: "conflict", message: "busy", status: 409 });
  const garbled = httpTransport(sending(() => new Response("<html>", { status: 502 })).send);
  const error = (await garbled.request("GET", "/v2/x").catch((caught: unknown) => caught)) as EngineClientError;
  expect(error).toMatchObject({ code: "engine_unavailable", transport: "malformed_response" });
});

test("a caller can turn failures into its own error type", async () => {
  class Mine extends Error {}
  const { send } = sending(() => Response.json({ error: { code: "not_found", message: "gone" } }, { status: 404 }));
  const transport = httpTransport(send, (code, message) => new Mine(`${code}: ${message}`));
  await expect(transport.request("GET", "/v2/x")).rejects.toThrow(new Mine("not_found: gone"));
});

test("a matching tag is unchanged, and bytes keep their type", async () => {
  const same = httpTransport(sending(() => new Response(null, { status: 304, headers: { etag: "t1" } })).send);
  expect(await same.requestIfChanged("/v2/sessions/live", "t1")).toEqual({ unchanged: true, etag: "t1" });
  const file = httpTransport(sending(() => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } })).send);
  expect(await file.readBytes("/v2/icon")).toEqual({ data: new Uint8Array([1, 2]), contentType: "image/png" });
});
