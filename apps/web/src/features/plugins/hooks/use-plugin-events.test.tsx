import { beforeEach, expect, test } from "bun:test";
import { act } from "react";
import type { PluginEventFrame } from "@telar/engine-client";
import { installTestDom, mount } from "@/test/dom";
import { fakeSessionsStream } from "@/test/sessions-stream";
import { usePluginEvents, type PluginEventFilter } from "./use-plugin-events";

installTestDom();

let stream = fakeSessionsStream();
const heard: Record<string, string[]> = {};

beforeEach(() => {
  stream = fakeSessionsStream();
  for (const key of Object.keys(heard)) delete heard[key];
  globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit) => stream.answer(init?.signal)) as typeof fetch;
});

function Listener({ label, filter }: { label: string; filter: PluginEventFilter }) {
  usePluginEvents("local", filter, (frame) => (heard[label] ??= []).push(`${frame.name}:${JSON.stringify(frame.data)}`));
  return null;
}

async function settle() {
  for (let turn = 0; turn < 10; turn += 1) await act(async () => await Promise.resolve());
}

const frame = (scope: Record<string, unknown>, name = "synced", data: unknown = 1) =>
  ({ type: "plugin.event", at: 1, pluginId: "echo", name, data, ...scope }) as PluginEventFrame;

test("each listener hears only its plugin's named events in its own scope", async () => {
  await mount(
    <>
      <Listener label="session" filter={{ pluginId: "echo", name: "synced", sessionId: "s1" }} />
      <Listener label="project" filter={{ pluginId: "echo", name: ["synced"], projectId: "p1" }} />
      <Listener label="machine" filter={{ pluginId: "echo", name: "synced" }} />
    </>,
  );
  await settle();
  stream.announce(frame({ scope: "session", sessionId: "s1", id: 1 }, "synced", "s1"));
  stream.announce(frame({ scope: "session", sessionId: "s2", id: 1 }, "synced", "s2"));
  stream.announce(frame({ scope: "project", projectId: "p1" }, "synced", "p1"));
  stream.announce(frame({ scope: "project", projectId: "p2" }, "synced", "p2"));
  stream.announce(frame({ scope: "machine" }, "synced", "mac"));
  stream.announce(frame({ scope: "machine" }, "other", "mac"));
  stream.announce({ ...frame({ scope: "machine" }), pluginId: "latex" });
  await settle();
  expect(heard).toEqual({ session: ['synced:"s1"'], project: ['synced:"p1"'], machine: ['synced:"mac"'] });
});
