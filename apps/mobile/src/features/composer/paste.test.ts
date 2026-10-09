import { expect, test } from "bun:test";
import type { ComposerPasteModule, PastedFile } from "../../../modules/composer-paste";
import { takeFiles, type Picked } from "./intake";
import { listenForPaste } from "./paste";

function fakeSource() {
  let listener: ((event: { files: PastedFile[] }) => void) | undefined;
  const source: ComposerPasteModule = {
    addListener: (_name, next) => ((listener = next), { remove: () => (listener = undefined) }),
  };
  return { source, paste: (files: PastedFile[]) => listener?.({ files }), listening: () => listener !== undefined };
}

const png: PastedFile = { uri: "file:///tmp/paste-1.png", name: "Pasted image.png", mimeType: "image/png", size: 2048 };

test("a pasted image comes through as an attachable file while the composer listens", () => {
  const { source, paste, listening } = fakeSource();
  const got: Picked[][] = [];
  const stop = listenForPaste(source, (files) => got.push(files));
  paste([png]);
  expect(takeFiles(got[0]!, "image")).toEqual({ files: [{ uri: png.uri, name: "Pasted image.png", mediaType: "image/png" }], refusals: [] });
  stop();
  expect(listening()).toBe(false);
  paste([png]);
  expect(got).toHaveLength(1);
});

test("a text paste sends no files, so the field keeps the text", () => {
  const { source, paste } = fakeSource();
  const got: Picked[][] = [];
  listenForPaste(source, (files) => got.push(files));
  paste([]);
  expect(got).toEqual([]);
});

test("an oversized or empty paste is refused with a reason", () => {
  const { refusals } = takeFiles([{ ...png, size: 30 * 1024 * 1024 }, { ...png, size: 0 }], "image");
  expect(refusals).toEqual(["Pasted image.png is 30.0 MB — attachments stop at 20.0 MB.", "Pasted image.png came through empty."]);
});

test("without the native module there is nothing to listen to", () => {
  expect(() => listenForPaste(null, () => {})()).not.toThrow();
});
