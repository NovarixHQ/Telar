import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { JournalItem } from "@telar/client/journal";
import { ProviderSwitchRow } from "./provider-switch-row";

const item = (carriedTurns: number) =>
  ({
    id: "switch_run_three",
    runId: "run_three",
    sessionId: "session_one",
    status: "completed",
    startedAt: 1,
    detail: {
      type: "provider_switch",
      from: { driver: "claude", instanceId: "claude", model: "Opus 5.5" },
      to: { driver: "codex", instanceId: "codex", model: "GPT-5.4" },
      carriedTurns,
    },
  }) as JournalItem;

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("says which provider it left, which it moved to, and how many turns went with it", () => {
  expect(text(renderToStaticMarkup(<ProviderSwitchRow item={item(12)} />))).toBe("Switched from Claude · Opus 5.5 to Codex · GPT-5.4 12 turns carried");
});

test("a switch that carried nothing does not count zero", () => {
  expect(text(renderToStaticMarkup(<ProviderSwitchRow item={item(0)} />))).toBe("Switched from Claude · Opus 5.5 to Codex · GPT-5.4");
});
