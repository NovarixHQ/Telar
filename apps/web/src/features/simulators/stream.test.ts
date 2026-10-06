import { expect, test } from "bun:test";
import { avcCodecString, AvccDemuxer, canDecodeH264 } from "./stream";

const envelope = (tag: number, ...payload: number[]) => [0, 0, 0, payload.length + 1, tag, ...payload];

test("the demuxer yields whole envelopes, waits for split ones, and skips unknown tags", () => {
  const demuxer = new AvccDemuxer();
  const bytes = new Uint8Array([...envelope(1, 1, 0x64, 0x00, 0x33), ...envelope(9, 7), ...envelope(2, 0xaa, 0xbb)]);
  expect(demuxer.push(bytes.slice(0, 7))).toEqual([]);
  const chunks = demuxer.push(bytes.slice(7, 15));
  expect(chunks).toEqual([{ type: "description", payload: new Uint8Array([1, 0x64, 0x00, 0x33]) }]);
  expect(demuxer.push(bytes.slice(15))).toEqual([{ type: "keyframe", payload: new Uint8Array([0xaa, 0xbb]) }]);
});

test("the codec string comes from the avcC profile and level", () => {
  expect(avcCodecString(new Uint8Array([1, 0x64, 0x00, 0x33]))).toBe("avc1.640033");
  expect(avcCodecString(new Uint8Array([1]))).toBe("avc1.42E01E");
});

test("H.264 is used only on a secure origin that has WebCodecs", () => {
  const codecs = { VideoDecoder: () => undefined, EncodedVideoChunk: () => undefined };
  expect(canDecodeH264({ isSecureContext: true, ...codecs })).toBe(true);
  expect(canDecodeH264({ isSecureContext: false, ...codecs })).toBe(false);
  expect(canDecodeH264({ isSecureContext: true })).toBe(false);
});
