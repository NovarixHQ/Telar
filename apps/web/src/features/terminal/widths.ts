import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { Terminal } from "@xterm/xterm";

/** Unicode 11 cell widths, which is what shells and prompts assume for emoji. Needs `allowProposedApi`. */
export function loadUnicodeWidths(term: Terminal): void {
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
}
