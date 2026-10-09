import { expect, test } from "bun:test";
import type { z } from "zod";
import { EngineEvent, EngineHealth, LiveSessionRow, Project, Session, SidebarLayout } from "../src";
import { RECORDED_HOSTS, type RecordedHost } from "./fixtures/hosts";

const body = (host: RecordedHost, path: string) => {
  const answer = host.answers[path];
  if (answer?.status !== 200) throw new Error(`${host.version} recorded no answer for ${path}`);
  return answer.body as Record<string, unknown>;
};

const parses = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).error?.issues ?? []).toEqual([]);

for (const host of RECORDED_HOSTS) {
  test(`today's schemas read what a ${host.version} host serves`, () => {
    parses(EngineHealth, body(host, "/v2/health"));
    const live = body(host, "/v2/sessions/live");
    for (const row of live.sessions as unknown[]) parses(LiveSessionRow, row);
    for (const project of live.projects as unknown[]) parses(Project, project);
    parses(SidebarLayout, body(host, "/v2/sidebar-layout").layout);
    parses(Session, body(host, "/v2/sessions/session_compat").session);
    for (const event of body(host, "/v2/sessions/session_compat/events?after=0").events as unknown[]) parses(EngineEvent, event);
  });
}
