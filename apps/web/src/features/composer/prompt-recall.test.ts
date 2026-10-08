import { describe, expect, test } from "bun:test";
import { recallablePrompts } from "./prompt-recall";

describe("recallablePrompts", () => {
  test("keeps what a person typed, oldest first, without repeats or machine turns", () => {
    expect(
      recallablePrompts([
        { prompt: "fix it" },
        { prompt: "fix it ", origin: "user" },
        { prompt: "woke up", origin: "provider" },
        { prompt: "from a peer", origin: "session" },
        { prompt: "/compact", kind: "compact" },
        { prompt: "old history", kind: "import" },
        { prompt: "   " },
        { prompt: "ship it", kind: "message", origin: "user" },
      ]),
    ).toEqual(["fix it", "ship it"]);
  });
});
