import { expect, test } from "bun:test";
import { PLUGIN_EVENT_MAX_BYTES, type PluginEventFrame } from "@telar/engine-client";
import { createPluginEvents } from "./events";

function bus() {
  const journal: unknown[] = [];
  const events = createPluginEvents({
    now: () => 7,
    journal: (_sessionId, entry) => (journal.push(entry), { id: journal.length, at: 7 }),
    checkSession: (_pluginId, sessionId) => {
      if (sessionId === "off") throw new Error("echo is not enabled for this session's project");
    },
    checkProject: () => undefined,
  });
  const heard: PluginEventFrame[] = [];
  events.watch((frame) => heard.push(frame));
  return { events, journal, heard };
}

test("session events are journaled, not broadcast; project and machine events are broadcast, not journaled", () => {
  const { events, journal, heard } = bus();
  expect(events.emit("echo", ["said"], { scope: "session", sessionId: "s1", name: "said", data: 1 })).toMatchObject({ id: 1, sessionId: "s1" });
  events.emit("echo", ["said"], { scope: "machine", name: "said" });
  expect(journal).toEqual([{ type: "plugin.event", pluginId: "echo", scope: "session", name: "said", data: 1 }]);
  expect(heard).toEqual([{ type: "plugin.event", pluginId: "echo", scope: "machine", name: "said", data: null, at: 7 }]);
});

test("an undeclared name, an oversized payload, a malformed event or a session it is off for is refused", () => {
  const { events, journal, heard } = bus();
  expect(() => events.emit("echo", ["said"], { scope: "machine", name: "shouted" })).toThrow("did not declare the event shouted");
  expect(() => events.emit("echo", ["said"], { scope: "machine", name: "said", data: "x".repeat(PLUGIN_EVENT_MAX_BYTES) })).toThrow("more than");
  expect(() => events.emit("echo", ["said"], { name: "said" })).toThrow("echo:");
  expect(() => events.emit("echo", ["said"], { scope: "session", sessionId: "off", name: "said" })).toThrow("not enabled");
  expect(journal).toEqual([]);
  expect(heard).toEqual([]);
});
