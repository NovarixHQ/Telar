import { expect, test } from "bun:test";
import { attachmentSymbol, humanBytes } from "./attachments";

test("sizes and glyphs read as the Swift app's", () => {
  expect([humanBytes(500), humanBytes(2048), humanBytes(5 * 1024 ** 3)]).toEqual(["500 B", "2.0 KB", "5.00 GB"]);
  expect(["image/png", "application/pdf", "text/markdown", "application/zip"].map(attachmentSymbol)).toEqual(["photo", "doc.richtext", "doc.text", "doc"]);
});
