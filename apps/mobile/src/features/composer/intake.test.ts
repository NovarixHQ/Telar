import { expect, test } from "bun:test";
import { intake } from "./intake";

test("a picked file keeps its name, or gets one from its type", () => {
  expect(intake({ uri: "file:///a", name: "report.pdf", mimeType: "application/pdf", size: 10 }, "file")).toEqual({ file: { uri: "file:///a", name: "report.pdf", mediaType: "application/pdf" } });
  expect(intake({ uri: "file:///b", mimeType: "image/jpeg", size: 10 }, "photo")).toMatchObject({ file: { name: "photo.jpg" } });
  expect(intake({ uri: "file:///c", name: "IMG_0001", mimeType: "image/heic" }, "photo")).toMatchObject({ file: { name: "IMG_0001.heic" } });
  expect(intake({ uri: "file:///d", name: "blob" }, "file")).toMatchObject({ file: { name: "blob.octet-stream", mediaType: "application/octet-stream" } });
});

test("empty and oversized files are refused with the reason", () => {
  expect(intake({ uri: "file:///e", name: "e.txt", mimeType: "text/plain", size: 0 }, "file")).toEqual({ refused: "e.txt came through empty." });
  expect(intake({ uri: "file:///f", name: "big.mov", mimeType: "video/quicktime", size: 30 * 1024 * 1024 }, "file")).toEqual({ refused: "big.mov is 30.0 MB — attachments stop at 20.0 MB." });
});
