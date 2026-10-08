import { expect, test } from "bun:test";
import { EngineClient, type FetchLike } from "./client";
import { EngineClientError } from "./errors";

function recording(answer: () => Promise<Response>): { fetch: FetchLike; calls: { url: string; authorization?: string }[] } {
  const calls: { url: string; authorization?: string }[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({ url: String(input), authorization: (init?.headers as Record<string, string> | undefined)?.authorization });
    return answer();
  };
  return { fetch, calls };
}

test("an endpoint client asks for its base URL on every request", async () => {
  let base = "http://100.64.0.1:3000/";
  const { fetch, calls } = recording(async () => Response.json({ ok: true }));
  const client = new EngineClient({ baseUrl: () => base, token: "tlr_abc" }, fetch);
  await client.request("GET", "/api/health");
  base = "http://192.168.1.20:3000";
  await client.request("GET", "/api/health");
  expect(calls).toEqual([
    { url: "http://100.64.0.1:3000/api/health", authorization: "Bearer tlr_abc" },
    { url: "http://192.168.1.20:3000/api/health", authorization: "Bearer tlr_abc" },
  ]);
});

test("an abort reaches the caller as an abort, not as an unreachable engine", async () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  const client = new EngineClient({ baseUrl: () => "http://mac:3000", token: "t" }, recording(() => Promise.reject(abort)).fetch);
  await expect(client.request("GET", "/api/health")).rejects.toBe(abort);
});

test("a transport failure is an unreachable engine", async () => {
  const client = new EngineClient({ baseUrl: () => "http://mac:3000", token: "t" }, recording(() => Promise.reject(new TypeError("Network request failed"))).fetch);
  const error = await client.request("GET", "/api/health").catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(EngineClientError);
  expect((error as EngineClientError).code).toBe("engine_unavailable");
});
