import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnFailureRow } from "./turn-status";

describe("a turn waiting for a usage limit to reset", () => {
  const render = (props: Parameters<typeof TurnFailureRow>[0]) => renderToStaticMarkup(<TurnFailureRow {...props} />);
  /** Read back through the same rule the row uses, so the test asserts the
   *  row's own wording rather than the runner's timezone or clock. Three hours
   *  from now crosses midnight after 21:00, and the row then names the weekday. */
  const resumeAt = Date.now() + 3 * 60 * 60 * 1000;
  const resets = new Date(resumeAt);
  const expected =
    resets.toDateString() === new Date().toDateString()
      ? resets.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : resets.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

  test("says when the limit lifts, and names which limit", () => {
    const markup = render({ failure: "limited", code: "rate_limited", resumeAt, limitType: "five_hour" });
    expect(markup).toContain(`Waiting for the five hour limit to reset at ${expected}`);
    // NOT the destructive colour: a session that is merely waiting must not
    // read as one that is damaged.
    expect(markup).not.toContain("text-destructive");
  });

  test("offers Resume now only when there is something to press", () => {
    const withButton = render({ failure: "limited", code: "rate_limited", resumeAt, onResume: () => {} });
    expect(withButton).toContain("Resume now");
    expect(render({ failure: "limited", code: "rate_limited", resumeAt })).not.toContain("Resume now");
  });

  test("the button says it is working, so a slow resume is not pressed twice", () => {
    const markup = render({ failure: "limited", code: "rate_limited", resumeAt, onResume: () => {}, resuming: true });
    expect(markup).toContain("Resuming…");
    expect(markup).toContain("disabled");
  });

  test("`other` names nothing actionable, so it earns no parenthetical", () => {
    const markup = render({ failure: "limited", code: "rate_limited", resumeAt, limitType: "other" });
    expect(markup).toContain("Waiting for the limit to reset at");
  });

  test("an ordinary failure still reads as one, with its own message", () => {
    const markup = render({ failure: "the CLI died", code: "driver_failed" });
    expect(markup).toContain("the CLI died");
    expect(markup).not.toContain("Waiting for the");
  });

  test("a limit with no reset time falls back rather than promising a time it lacks", () => {
    // Otherwise the row renders "resets at Invalid Date", which is worse than
    // the plain failure it replaced.
    const markup = render({ failure: "limited", code: "rate_limited" });
    expect(markup).toContain("limited");
    expect(markup).not.toContain("Waiting for the");
  });

});

describe("a failed turn", () => {
  const render = (props: Parameters<typeof TurnFailureRow>[0]) => renderToStaticMarkup(<TurnFailureRow {...props} />);
  const visible = (markup: string) => markup.split("<details")[0]!;

  test("a missing folder says only that it stopped; the remedy stays with the banner", () => {
    const markup = render({
      failure: "This session's folder isn't reachable: /private/tmp/exoplanets. The folder no longer exists; it may have been moved or deleted. Restore it, or re-register the project with its current location, and retry.",
      code: "workspace_unavailable",
      detail: "Claude Code process exited with code 1.",
    });
    expect(visible(markup)).toContain("Stopped: the project folder isn&#x27;t reachable");
    expect(visible(markup)).not.toContain("re-register");
    expect(markup).toContain("<summary");
    expect(markup).toContain("/private/tmp/exoplanets");
    expect(markup).toContain("Claude Code process exited with code 1.");
  });

  test("shows the first sentence and keeps the rest behind Details", () => {
    const markup = render({ failure: "The provider is not installed. Install it from Settings, then retry.", code: "provider_unavailable" });
    expect(visible(markup)).toContain("The provider is not installed.");
    expect(visible(markup)).not.toContain("Install it from Settings");
    expect(markup).toContain("Install it from Settings, then retry.");
  });

  test("a one-sentence failure has no disclosure", () => {
    expect(render({ failure: "the CLI died", code: "driver_failed" })).not.toContain("<details");
  });

  for (const code of ["provider_unavailable", "driver_failed", "budget_exhausted", "interrupted", "internal_error", "rate_limited", "workspace_unavailable"] as const) {
    test(`${code} renders as one status row with its details behind a disclosure`, () => {
      const markup = render({ failure: "Something stopped. More here.", code });
      expect(markup.match(/role="status"/g)).toHaveLength(1);
      expect(visible(markup)).not.toContain("More here.");
      expect(markup).toContain("More here.");
    });
  }
});
