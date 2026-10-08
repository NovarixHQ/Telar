import { expect, test } from "bun:test";
import { languageBadge } from "./badge";

test("the badge names the language, or AUTO when the host detects it", () => {
  expect(languageBadge("es")).toBe("ES");
  expect(languageBadge("multi")).toBe("AUTO");
  expect(languageBadge(undefined)).toBe("AUTO");
  expect(languageBadge(" ")).toBe("AUTO");
});
