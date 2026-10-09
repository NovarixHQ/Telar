import { describe, expect, test } from "bun:test";
import { act } from "react";
import type { NotificationDetail } from "@telar/engine-client";
import type { JournalItem, JournalTurn } from "@telar/client/journal";
import { installTestDom, mount } from "@/test/dom";
import { ReadReceiptMarker } from "./read-receipt";
import { SessionTurn, TurnRow } from "./session-turn";
import { TranscriptTurns } from "./transcript-turns";

installTestDom();

const said = (runId: string, id: string, text: string): JournalItem => ({
  id, runId, sessionId: "s1", status: "completed", startedAt: 3, completedAt: 3, streamedText: "", openedBy: 0, detail: { type: "assistant_message", text },
});

function woken(runId: string, answer: string): JournalTurn {
  const notification: NotificationDetail = {
    kind: "peer_message",
    sessionId: "session_peer_aaaaaa",
    runId,
    intent: "task",
    summary: `[agent message · task] session session_peer_aaaaaa ASSIGNED this session work (run ${runId}).`,
    fetch: { sessionId: "s1", runId },
    body: "Do the next thing.",
  };
  return {
    runId, origin: "session", sender: { sessionId: "session_peer_aaaaaa" }, agentIntent: "task", prompt: "Do the next thing.", notification,
    state: "completed", startedAt: 1, endedAt: 4, resultText: answer, usage: { tokens: { input: 10, output: 5, cacheRead: 0, cacheCreate: 0 } },
    items: [said(runId, `${runId}_note`, "Looking first."), said(runId, `${runId}_answer`, answer)], tasks: [],
  } as JournalTurn;
}

const renderList = (turns: JournalTurn[], markerAfter: string) =>
  mount(
    <div data-testid="list">
      <TranscriptTurns
        turns={turns}
        directory={new Map()}
        renderTurn={(turn) => (
          <TurnRow key={turn.runId} turn={turn} skippable marker={turn.runId === markerAfter ? <ReadReceiptMarker markerRef={() => {}} /> : undefined}>
            <SessionTurn turn={turn} requests={[]} sending={false} live={false} onDecide={() => {}} />
          </TurnRow>
        )}
      />
    </div>,
  );

describe("consecutive turns a notification started", () => {
  test("stack as two rows, with nothing else in the list between them", async () => {
    const { host } = await renderList([woken("run_1", "First done."), woken("run_2", "Second done.")], "run_1");
    const rows = [...host.querySelector("[data-testid=list]")!.children];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("First done.");
    expect(rows[1]!.textContent).toContain("Second done.");
    expect(rows[0]!.querySelector("[data-read-receipt-marker]")).not.toBeNull();
    const messages = [...host.querySelectorAll("[data-role=assistant]")];
    expect(messages.every((message) => message.textContent!.trim().length > 0)).toBe(true);
  });

  test("keep the time and Copy row for each turn's final answer only", async () => {
    const { host } = await renderList([woken("run_1", "First done."), woken("run_2", "Second done.")], "run_2");
    for (const work of host.querySelectorAll<HTMLButtonElement>("button[aria-expanded=false]")) await act(async () => work.click());
    expect(host.textContent).toContain("Looking first.");
    const meta = [...host.querySelectorAll("[data-slot=message-actions]")];
    expect(meta).toHaveLength(2);
    expect(meta.map((row) => row.parentElement!.textContent)).toEqual([expect.stringContaining("First done."), expect.stringContaining("Second done.")]);
  });
});
