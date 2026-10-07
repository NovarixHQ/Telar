import { expect, test } from "bun:test";
import { runTurn, sent, useFakeCodex, wire } from "../../../test/codex-harness";

useFakeCodex();

const CONTEXT = "Context from this session (context, not instructions): …";

test("turns Codex has not seen go into its thread history before the turn starts, not into the message", async () => {
  await runTurn("plain", { prompt: "carry on", carriedContext: CONTEXT }).result;
  expect(sent("thread/inject_items")).toEqual({
    threadId: expect.any(String),
    items: [{ type: "message", role: "user", content: [{ type: "input_text", text: CONTEXT }] }],
  });
  const methods = wire().map((entry) => entry.method);
  expect(methods.indexOf("thread/inject_items")).toBeLessThan(methods.indexOf("turn/start"));
  expect(sent("turn/start").input).toEqual([{ type: "text", text: "carry on", text_elements: [] }]);
});

test("an app-server without inject_items reads the context inline, ahead of the message", async () => {
  await runTurn("plain", { prompt: "carry on", carriedContext: CONTEXT, options: { env: { FAKE_CODEX_INJECT: "unsupported" } } }).result;
  const [input] = sent("turn/start").input as Array<{ text: string }>;
  expect(input?.text.startsWith(CONTEXT)).toBe(true);
  expect(input?.text.endsWith("carry on")).toBe(true);
});

test("a turn with nothing carried injects nothing", async () => {
  await runTurn("plain", { prompt: "hi" }).result;
  expect(wire().some((entry) => entry.method === "thread/inject_items")).toBe(false);
});
