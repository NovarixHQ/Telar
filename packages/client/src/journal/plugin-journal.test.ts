import { expect, test } from "bun:test";
import type { EngineEvent } from "@telar/engine-client";
import { pluginJournalRow } from "./plugin-journal";

const event = (note?: { text: string; failed?: boolean; attachmentId?: string }) =>
  ({ id: 9, at: 5, sessionId: "s1", runId: "r1", type: "plugin.event", pluginId: "latex", scope: "session", name: "compile.finished", data: {}, ...(note ? { note } : {}) }) as EngineEvent;

test("a plugin event with a note is a transcript row; without one it is not", () => {
  expect(pluginJournalRow(event({ text: "Compiled main.tex" }))).toMatchObject({ id: "latex_9", runId: "r1", status: "completed", detail: { type: "unknown", label: "Compiled main.tex" } });
  expect(pluginJournalRow(event({ text: "Compile failed", failed: true }))).toMatchObject({ status: "failed", detail: { type: "error", error: { message: "Compile failed" } } });
  expect(pluginJournalRow(event({ text: "Drew a figure", attachmentId: "att_1" }))).toMatchObject({ plotAttachmentId: "att_1" });
  expect(pluginJournalRow(event())).toBeUndefined();
});
