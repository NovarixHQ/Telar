import { describe, expect, test } from "bun:test";
import { buttonLabelled as button, click, flush, installTestDom, mount, stubFetch } from "@/test/dom";
import { typeInto } from "@/test/type-into";
import { GlobalInstructionsRow } from "./instructions-row";

installTestDom();

async function mountGlobal(instructions?: string) {
  const calls = stubFetch({
    "GET /api/engine/v2/orientation": () => ({ orientation: { preamble: true, skill: true, ...(instructions ? { instructions } : {}) }, text: "" }),
    "PATCH /api/engine/v2/orientation": (patch) => ({ orientation: { preamble: true, skill: true, instructions: ((patch as { instructions: string }).instructions).trim() }, text: "" }),
  });
  const { host } = await mount(<GlobalInstructionsRow />);
  await flush(() => calls.some((call) => call.route === "GET /api/engine/v2/orientation"));
  await flush();
  return { host, calls, field: () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Agent instructions"]')! };
}

describe("global agent instructions", () => {
  test("shows what the engine holds, with the limit, and no save until something changes", async () => {
    const { host, field } = await mountGlobal("Answer in Spanish.");
    expect(field().value).toBe("Answer in Spanish.");
    expect(field().maxLength).toBe(4000);
    expect(host.textContent).toContain("18 / 4000");
    expect(button("Save")).toBeUndefined();
  });

  test("Save sends the text to the engine and the row settles on its answer", async () => {
    const { calls, field } = await mountGlobal();
    await typeInto(field(), "Run the tests. ");
    await click(button("Save"));
    expect(calls.filter((call) => call.route === "PATCH /api/engine/v2/orientation").map((call) => call.body)).toEqual([{ instructions: "Run the tests. " }]);
    expect(button("Save")).toBeUndefined();
  });

  test("Discard puts back what was saved", async () => {
    const { calls, field } = await mountGlobal("Keep it short.");
    await typeInto(field(), " Always.");
    await click(button("Discard"));
    expect(field().value).toBe("Keep it short.");
    expect(calls.some((call) => call.route === "PATCH /api/engine/v2/orientation")).toBeFalse();
  });
});
