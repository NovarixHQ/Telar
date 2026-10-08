import { describe, expect, test } from "bun:test";
import { SessionTurn } from "@/features/sessions/cockpit";
import type { JournalTurn } from "@telar/client/journal";
import { installTestDom, mount } from "@/test/dom";

installTestDom();

const turn: JournalTurn = {
  runId: "run_1",
  origin: "user",
  prompt: "Plot the exoplanets",
  acceptedAt: Date.now(),
  state: "completed",
  resultText: "Done.",
  items: [
    { id: "a1", runId: "run_1", sessionId: "s1", status: "completed", startedAt: Date.now(), completedAt: Date.now(), streamedText: "", openedBy: 0, detail: { type: "assistant_message", text: "Done." } },
  ],
  tasks: [],
} as JournalTurn;

describe("the time and Copy row under a message", () => {
  test("stays inside the message's column, so a wide window can't push it to the card's edge", async () => {
    const { host } = await mount(<SessionTurn turn={turn} requests={[]} sending={false} live={false} onDecide={() => {}} />);
    expect(host.querySelector("[data-role=user] [data-slot=message-actions]")).not.toBeNull();
    expect(host.querySelector("[data-role=assistant] [data-slot=message-actions]")).not.toBeNull();
    expect([...host.querySelectorAll("[data-slot=message-actions]")].every((row) => row.closest("[data-role]"))).toBe(true);
  });
});
