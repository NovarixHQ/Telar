import { expect, test } from "bun:test";
import { cliFlags, quoteCliArgs, tokenizeCliArgs } from "./cli-args";

test("splits on whitespace and keeps quoted runs whole", () => {
  expect(tokenizeCliArgs("")).toEqual([]);
  expect(tokenizeCliArgs("  --search   -c model=o3 ")).toEqual(["--search", "-c", "model=o3"]);
  expect(tokenizeCliArgs(`--name "two words" --path 'a b' --empty ""`)).toEqual(["--name", "two words", "--path", "a b", "--empty", ""]);
  expect(tokenizeCliArgs(String.raw`--say "a \"quoted\" word" one\ arg`)).toEqual(["--say", 'a "quoted" word', "one arg"]);
});

test("an unclosed quote is refused rather than guessed at", () => {
  expect(() => tokenizeCliArgs(`--name "open`)).toThrow("unclosed");
});

test("flags read as a map, a bare flag as null", () => {
  expect(cliFlags(["--chrome", "--effort", "high", "--mode=plan", "stray", "-x"])).toEqual({ chrome: null, effort: "high", mode: "plan" });
});

test("quoted arguments read back as the same list", () => {
  const args = ["--acp", "two words", "it's", "", "--key=value"];
  expect(tokenizeCliArgs(quoteCliArgs(args))).toEqual(args);
});
