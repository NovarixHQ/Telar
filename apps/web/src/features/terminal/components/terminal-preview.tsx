"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { cssColorReader, cssVariableReader, loadTerminalFonts, terminalFont, terminalTheme } from "../theme";

const SAMPLE = [
  "\x1b[32m→\x1b[0m Local: \x1b[36mhttp://127.0.0.1:3100/\x1b[0m",
  "\x1b[32m✓ 1061 passed\x1b[0m \x1b[33m△ 6 warnings\x1b[0m \x1b[31m✗ 0 failed\x1b[0m",
  "\x1b[30;42m READY \x1b[0m watching, press q to quit",
  "\x1b[1m~/telar\x1b[0m \x1b[35mmain\x1b[0m $ ",
];
const COLS = 46;

/** A read-only xterm drawing a fixed sample with the live terminal's theme and font, re-read whenever the root's appearance changes. */
export function TerminalPreview() {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const canvas = document.createElement("canvas");
    const look = () => ({ theme: terminalTheme(cssColorReader(element, canvas)), ...terminalFont(cssVariableReader(element)) });
    const term = new Terminal({ ...look(), cols: COLS, rows: SAMPLE.length, disableStdin: true, cursorBlink: false, cursorInactiveStyle: "block", scrollback: 0 });
    term.open(element);
    term.write(SAMPLE.join("\r\n"));
    const apply = () => Object.assign(term.options, look());
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true });
    void loadTerminalFonts(term.options.fontFamily ?? "", term.options.fontSize ?? 12).then(apply);
    return () => {
      observer.disconnect();
      term.dispose();
    };
  }, []);

  return <div ref={host} aria-hidden data-testid="terminal-preview" className="pointer-events-none overflow-x-auto rounded-md border border-border bg-card px-3 py-2.5" />;
}
