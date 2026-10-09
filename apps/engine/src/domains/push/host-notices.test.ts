import { describe, expect, test } from "bun:test";
import type { LiveSessionRow } from "@telar/engine-client";
import { DESKTOP_DISMISS, DESKTOP_NOTICE } from "./desktop";
import { alertId } from "./push";
import { hostPath, pollHost, type HostWatch, type PairedHost } from "./host-notices";

const NOW = 1_000_000;
const host: PairedHost = { id: "host_studio", baseUrl: "http://studio.local:4100", deviceToken: "tlr_device" };
const path = "/hosts/host_studio/projects/p1/sessions/s1";

describe("where a host's alert opens", () => {
  test("a host session opens under that host's route", () => {
    expect(hostPath("host_studio", "/projects/p1/sessions/s1")).toBe(path);
    expect(hostPath("host_studio", "/main")).toBe("/");
  });
});

function row(activity: LiveSessionRow["activity"], extra: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return { id: "s1", title: "Fix the login", projectId: "p1", activity, activityAt: activity === "working" ? 1 : 2, ...extra } as LiveSessionRow;
}

function fakeHost(state: { sessions: LiveSessionRow[] }) {
  const fetcher = (async (url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tlr_device");
    if (url === `${host.baseUrl}/api/sessions/live?all=1`) return Response.json({ sessions: state.sessions, assignments: {}, projects: [] });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const sent: Record<string, unknown>[] = [];
  const channel = { connected: true, send: (message: unknown) => sent.push(message as Record<string, unknown>) };
  return { fetcher, sent, channel };
}

describe("a paired host's sessions reach this Mac's desktop", () => {
  test("a host session that needs you posts a notice that opens it here", async () => {
    const state = { sessions: [row("working")] };
    const { fetcher, sent, channel } = fakeHost(state);
    const watch: HostWatch = { states: new Map(), etags: new Map(), shown: new Map() };
    const poll = () => pollHost(host, watch, { fetcher, channel, now: NOW });

    await poll();
    expect(sent).toEqual([]);
    state.sessions = [row("blocked")];
    await poll();
    expect(sent).toEqual([{ type: DESKTOP_NOTICE, kind: "blocked", sessionId: "s1", title: "Fix the login", body: expect.any(String), path, id: alertId("s1") }]);
  });

  test("a finished or failed host session posts too", async () => {
    const state = { sessions: [row("working", { lastTurnOrigin: "user" })] };
    const { fetcher, sent, channel } = fakeHost(state);
    const watch: HostWatch = { states: new Map(), etags: new Map(), shown: new Map() };
    const poll = () => pollHost(host, watch, { fetcher, channel, now: NOW });
    await poll();
    state.sessions = [row("idle", { lastTurnOrigin: "user", lastTurnEndedAt: 5, lastTurnFailed: true })];
    await poll();
    expect(sent.map((n) => n.kind)).toEqual(["failed"]);
  });

  test("posts even while the host's own Mac is in use, and a read on any device takes it down here", async () => {
    const state = { sessions: [row("working", { lastTurnOrigin: "user", lastTurnSequence: 1, lastReadTurnSequence: 1 })] };
    const { fetcher, sent, channel } = fakeHost(state);
    const watch: HostWatch = { states: new Map(), etags: new Map(), shown: new Map() };
    const poll = () => pollHost(host, watch, { fetcher, channel, now: NOW });
    await poll();
    state.sessions = [row("idle", { lastTurnOrigin: "user", lastTurnEndedAt: 5, lastTurnSequence: 2, lastReadTurnSequence: 1 })];
    await poll();
    await poll();
    expect(sent.map((n) => n.type)).toEqual([DESKTOP_NOTICE]);
    state.sessions = [row("idle", { lastTurnOrigin: "user", lastTurnEndedAt: 5, lastTurnSequence: 2, lastReadTurnSequence: 2 })];
    await poll();
    await poll();
    expect(sent.slice(1)).toEqual([{ type: DESKTOP_DISMISS, sessionId: "s1", id: alertId("s1") }]);
  });

  test("a host that cannot be reached posts nothing", async () => {
    const sent: unknown[] = [];
    const fetcher = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await pollHost(host, { states: new Map(), etags: new Map(), shown: new Map() }, { fetcher, channel: { connected: true, send: (m) => sent.push(m) }, now: NOW });
    expect(sent).toEqual([]);
  });
});
