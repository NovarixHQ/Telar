import { expect, test } from "bun:test";
import { alertsToRemove, approvalOf, pairedHostOf, pushHostId, readsOf, reconcileQueries, sessionLink, sessionOfAlert, sessionOfUrl } from "./payload";

const HOST = "3F2A1B4C-0D5E-4F60-8A9B-1C2D3E4F5A6B";

test("a tap on the engine's link opens that session's route", () => {
  const ref = sessionOfUrl(`telar://session?host=${HOST}&id=session_abc`);
  expect(ref).toEqual({ hostId: HOST, sessionId: "session_abc" });
  expect(sessionLink(ref!)).toBe(`telar://session/${HOST}/session_abc`);
});

test("links that are not a session open nothing", () => {
  for (const url of [undefined, 42, "", "telar://pair?link=x", `telar://session?host=${HOST}`, "https://example.com/session?host=a&id=b"]) {
    expect(sessionOfUrl(url)).toBeUndefined();
  }
});

test("an alert belongs to the session in its thread id, else to its url", () => {
  expect(sessionOfAlert({ identifier: "a", threadIdentifier: `${HOST}:s1` })).toEqual({ hostId: HOST, sessionId: "s1" });
  expect(sessionOfAlert({ identifier: "a", threadIdentifier: null, url: `telar://session?host=${HOST}&id=s2` })).toEqual({ hostId: HOST, sessionId: "s2" });
  expect(sessionOfAlert({ identifier: "a", threadIdentifier: `${HOST}:` })).toBeUndefined();
});

test("a read push names the sessions to clear", () => {
  expect(readsOf({ read: { host: HOST, sessions: ["s1", "", 3, "s2"] } })).toEqual([{ hostId: HOST, sessionId: "s1" }, { hostId: HOST, sessionId: "s2" }]);
  expect(readsOf({ aps: {} })).toEqual([]);
  expect(readsOf(undefined)).toEqual([]);
});

test("seen elsewhere removes every alert for that session and leaves the rest", () => {
  const delivered = [
    { identifier: "1", threadIdentifier: `${HOST}:s1` },
    { identifier: "2", threadIdentifier: `${HOST.toLowerCase()}:s1` },
    { identifier: "3", threadIdentifier: `${HOST}:s2` },
    { identifier: "4", url: `telar://session?host=${HOST}&id=s1` },
  ];
  expect(alertsToRemove(delivered, [{ hostId: HOST, sessionId: "s1" }])).toEqual(["1", "2", "4"]);
  expect(alertsToRemove(delivered, [])).toEqual([]);
});

test("launch asks each host about at most 64 distinct sessions", () => {
  const delivered = Array.from({ length: 70 }, (_, i) => ({ identifier: String(i), threadIdentifier: `${HOST}:s${i % 66}` }));
  const queries = reconcileQueries([...delivered, { identifier: "x", threadIdentifier: "other:s1" }]);
  expect(queries.get(HOST)).toHaveLength(64);
  expect(new Set(queries.get(HOST)).size).toBe(64);
  expect(queries.get("other")).toEqual(["s1"]);
});

test("an approve action needs both the session and the request", () => {
  const url = `telar://session?host=${HOST}&id=s1`;
  expect(approvalOf({ url, request: "req_1" })).toEqual({ hostId: HOST, sessionId: "s1", requestId: "req_1" });
  expect(approvalOf({ url })).toBeUndefined();
  expect(approvalOf({ url, request: "" })).toBeUndefined();
});

test("a push names the host by the bare UUID it was registered with, which maps back to the paired host", () => {
  const paired = [`host_${HOST.toLowerCase()}`, "host_00000000-0000-4000-8000-000000000000"];
  expect(pushHostId(paired[0]!)).toBe(HOST);
  expect(pairedHostOf(HOST, paired)).toBe(paired[0]);
  expect(pairedHostOf("99999999-0000-4000-8000-000000000000", paired)).toBeUndefined();
  expect(alertsToRemove([{ identifier: "1", threadIdentifier: `${HOST}:s1` }], [{ hostId: paired[0]!, sessionId: "s1" }])).toEqual(["1"]);
});
