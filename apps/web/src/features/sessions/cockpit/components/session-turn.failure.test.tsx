import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionTurn } from "@/features/sessions/cockpit";
import type { JournalTurn } from "@telar/client/journal";

const failed = (extra: Partial<JournalTurn>): JournalTurn => ({
  runId: "run_1",
  origin: "user",
  prompt: "Plot the exoplanets",
  state: "failed",
  resultText: "",
  items: [],
  tasks: [],
  ...extra,
});

const render = (turn: JournalTurn) =>
  renderToStaticMarkup(<SessionTurn turn={turn} requests={[]} sending={false} live={false} onDecide={() => {}} />);

describe("a failed turn in the transcript", () => {
  test("an explained failure is one row, without the generic ended-early line", () => {
    const html = render(failed({ failure: "This session's folder isn't reachable: /private/tmp/exoplanets.", failureCode: "workspace_unavailable" }));
    expect(html).toContain("Stopped: the project folder isn&#x27;t reachable");
    expect(html).not.toContain("This turn ended early");
  });

  test("a failure with no explanation still says the turn ended early", () => {
    expect(render(failed({}))).toContain("This turn ended early");
  });
});
