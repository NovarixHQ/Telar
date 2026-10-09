import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const written = (term: import("@xterm/xterm").Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

test("an emoji takes two cells, so the text after it lines up with the shell's idea of the column", async () => {
  const { Terminal } = await import("@xterm/xterm");
  const { loadUnicodeWidths } = await import("./widths");
  const term = new Terminal({ allowProposedApi: true, cols: 20, rows: 2 });
  loadUnicodeWidths(term);
  expect(term.unicode.activeVersion).toBe("11");
  await written(term, "🤘x");
  expect(term.buffer.active.cursorX).toBe(3);
  term.dispose();
});
