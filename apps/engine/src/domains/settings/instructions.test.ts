import { describe, expect, test } from "bun:test";
import { personInstructions } from "./instructions";

describe("personInstructions", () => {
  test("says nothing when neither text is set", () => {
    expect(personInstructions(undefined, "  ")).toBeUndefined();
  });

  test("puts the global text before the project's", () => {
    const text = personInstructions("Answer in Spanish.", "Use pnpm here.")!;
    expect(text.indexOf("Answer in Spanish.")).toBeLessThan(text.indexOf("Use pnpm here."));
    expect(text).toContain("For this project:\nUse pnpm here.");
  });

  test("keeps a project text on its own", () => {
    expect(personInstructions(undefined, "Use pnpm here.")).toContain("Use pnpm here.");
  });
});
