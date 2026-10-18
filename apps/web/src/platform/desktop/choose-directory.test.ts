/**
 * A picker has three answers: a path, a cancel, and "no picker here".
 * Cancel must never be reported as a failure.
 */
import { describe, expect, test } from "bun:test";
import { chooseDirectory, readDirectoryChoice } from "@/platform/desktop/choose-directory";

const shell = (answer: unknown) => ({ dialog: { chooseDirectory: async () => answer } });

describe("readDirectoryChoice", () => {
  test("a trailing slash is trimmed, because the engine compares paths as strings", () => {
    // `/repo/` and `/repo` register as two projects on the same directory.
    expect(readDirectoryChoice({ path: "/Users/me/code/thing/" })).toEqual({ path: "/Users/me/code/thing" });
    expect(readDirectoryChoice({ path: "  /Users/me/thing  " })).toEqual({ path: "/Users/me/thing" });
  });

  test("cancelling is its own answer", () => {
    expect(readDirectoryChoice({ cancelled: true })).toEqual({ cancelled: true });
  });

  test("no picker on this platform is its own answer too", () => {
    // A Linux machine with no osascript is behaving correctly and must not be
    // reported as a failure.
    expect(readDirectoryChoice({ unavailable: "macOS only." })).toEqual({ unavailable: "macOS only." });
  });

  test("an empty path is not a path", () => {
    // Nothing has produced one, and treating it as a choice would register a
    // project on the engine's own working directory.
    expect(readDirectoryChoice({ path: "" })).toMatchObject({ unavailable: expect.any(String) });
    expect(readDirectoryChoice({ path: "   " })).toMatchObject({ unavailable: expect.any(String) });
    expect(readDirectoryChoice(null)).toMatchObject({ unavailable: expect.any(String) });
    expect(readDirectoryChoice({ path: 42 })).toMatchObject({ unavailable: expect.any(String) });
  });
});

describe("chooseDirectory", () => {
  test("asks the desktop shell", async () => {
    expect(await chooseDirectory({}, { bridge: shell({ path: "/from/shell" }) })).toEqual({ path: "/from/shell" });
  });

  test("no shell is unavailable, not a failure", async () => {
    expect(await chooseDirectory({}, { bridge: undefined })).toMatchObject({ unavailable: expect.any(String) });
  });

  test("a shell that throws is unavailable, not an unhandled rejection", async () => {
    const angry = { dialog: { chooseDirectory: async () => { throw new Error("no window"); } } };
    expect(await chooseDirectory({}, { bridge: angry })).toEqual({ unavailable: "no window" });
  });
});
