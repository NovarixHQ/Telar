/** A bad slot must read as "no draft" or as the draft, never as a throw. */
import { describe, expect, test } from "bun:test";
import { readDraft, writeDraft, type DraftStorage } from "./draft";

function storage(initial: Record<string, string> = {}) {
  const slots = new Map(Object.entries(initial));
  return {
    getItem: (name: string) => slots.get(name) ?? null,
    setItem: (name: string, value: string) => void slots.set(name, value),
    removeItem: (name: string) => void slots.delete(name),
    slots,
  } satisfies DraftStorage & { slots: Map<string, string> };
}

describe("which slot a composer writes to", () => {
  test("a session keys by session; a canvas keys by project", () => {
    // The canvas key lets an unsent new conversation be found before any session exists.
    const store = storage();
    writeDraft("session_7", "project_a", "in a session", store);
    writeDraft(undefined, "project_a", "on the canvas", store);
    expect([...store.slots.keys()].sort()).toEqual(["telar:draft:new:project_a", "telar:draft:session_7"]);
  });

  test("two canvases in different projects do not share a slot", () => {
    const store = storage();
    writeDraft(undefined, "project_a", "for A", store);
    writeDraft(undefined, "project_b", "for B", store);
    expect(readDraft(undefined, "project_a", store)).toBe("for A");
    expect(readDraft(undefined, "project_b", store)).toBe("for B");
  });

  test("a project-less session still gets its own slot", () => {
    // A session with no project exists before anyone can type into it, so the
    // project half is never reached — but the session half must still key.
    const store = storage();
    writeDraft("master", undefined, "a thought", store);
    expect([...store.slots.keys()]).toEqual(["telar:draft:master"]);
    expect(readDraft("master", undefined, store)).toBe("a thought");
  });
});

describe("emptying", () => {
  test("an empty draft removes the key rather than blanking it", () => {
    // Otherwise every session anyone ever opened leaves an entry behind.
    const store = storage();
    writeDraft("session_7", "project_a", "typed", store);
    writeDraft("session_7", "project_a", "", store);
    expect(store.slots.size).toBe(0);
  });

  test("whitespace is empty", () => {
    const store = storage();
    writeDraft("session_7", "project_a", "   \n  ", store);
    expect(store.slots.size).toBe(0);
    expect(readDraft("session_7", "project_a", store)).toBe("");
  });
});

describe("reading a slot another build wrote", () => {
  test("a bare string is still someone's paragraph", () => {
    // The legacy slot shape was plain text, and such drafts still exist in real browsers.
    const store = storage({ "telar:draft:new:project_a": "written by the old build" });
    expect(readDraft(undefined, "project_a", store)).toBe("written by the old build");
  });

  test("a legacy draft is overwritten by the next keystroke, not lost", () => {
    const store = storage({ "telar:draft:new:project_a": "old" });
    writeDraft(undefined, "project_a", "old and then some", store);
    expect(readDraft(undefined, "project_a", store)).toBe("old and then some");
  });

  test("junk costs the draft, never a throw", () => {
    expect(readDraft(undefined, "project_a", storage({ "telar:draft:new:project_a": "{not json" }))).toBe("");
    expect(readDraft(undefined, "project_a", storage({ "telar:draft:new:project_a": '{"text":7}' }))).toBe("");
    expect(readDraft(undefined, "project_a", storage({ "telar:draft:new:project_a": '{"text":"  "}' }))).toBe("");
    expect(readDraft(undefined, "project_a", storage({ "telar:draft:new:project_a": '{"nope":1}' }))).toBe("");
  });

  test("only a leading brace means JSON; everything else is someone's words", () => {
    // `null` and `[1,2]` are valid JSON but are still a legacy text draft.
    expect(readDraft(undefined, "project_a", storage({ "telar:draft:new:project_a": "null" }))).toBe("null");
    expect(readDraft(undefined, "project_a", storage({ "telar:draft:new:project_a": "[1,2]" }))).toBe("[1,2]");
  });

  test("a slot with text but no age reads", () => {
    const store = storage({ "telar:draft:new:project_a": '{"text":"aged out"}' });
    expect(readDraft(undefined, "project_a", store)).toBe("aged out");
  });
});

describe("a hostile store", () => {
  test("reads and writes fail closed rather than breaking the composer", () => {
    // Safari in private mode throws from setItem once the quota is reached.
    const hostile: DraftStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => writeDraft(undefined, "project_a", "typed", hostile)).not.toThrow();
    expect(readDraft(undefined, "project_a", hostile)).toBe("");
  });
});

describe("the cap", () => {
  test("a runaway paste is truncated, not refused", () => {
    const store = storage();
    writeDraft(undefined, "project_a", "x".repeat(50_000), store);
    expect(readDraft(undefined, "project_a", store)).toHaveLength(20_000);
  });
});
