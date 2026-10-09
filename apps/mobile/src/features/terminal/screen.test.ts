import { describe, expect, test } from "bun:test";
import { TerminalScreen } from "./screen";

const shown = (...chunks: string[]) => {
  const screen = new TerminalScreen();
  chunks.forEach((chunk) => screen.feed(chunk));
  return screen.text;
};

describe("TerminalScreen", () => {
  test("drops colour and title escapes, even split across chunks", () => {
    expect(shown("\u001b[1;32mok\u001b[0m\n", "\u001b]0;ti", "tle\u0007$ ")).toBe("ok\n$ ");
    expect(shown("a\u001b[", "31mb")).toBe("ab");
  });

  test("a carriage return rewrites the line, a backspace removes one character", () => {
    expect(shown("10%\r50%\r100%\n")).toBe("100%\n");
    expect(shown("lss\b -la")).toBe("ls -la");
    expect(shown("line\n\b")).toBe("line\n");
  });

  test("keeps CRLF output intact", () => {
    expect(shown("hello\r\nworld\r\n")).toBe("hello\nworld\n");
  });

  test("trims the oldest lines past the limit", () => {
    const screen = new TerminalScreen();
    for (let index = 0; index < 1000; index += 1) screen.feed(`${String(index).padStart(99, "0")}\n`);
    expect(screen.text.length).toBeLessThanOrEqual(48_000);
    expect(screen.text.endsWith(`${"999".padStart(99, "0")}\n`)).toBe(true);
    expect(screen.text.startsWith(`${"0".repeat(99)}\n`)).toBe(false);
  });
});
