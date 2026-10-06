import { afterEach, beforeEach, expect, test } from "bun:test";
import { avcCodecString, AvccDemuxer, canDecodeH264, startStream } from "./stream";

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

type Frame = { displayWidth: number; displayHeight: number; closed: boolean; close: () => void };

class FakeDecoder {
  static supported = true;
  static all: FakeDecoder[] = [];
  static isConfigSupported = async () => ({ supported: FakeDecoder.supported });
  state = "unconfigured";
  decodeQueueSize = 0;
  constructor(readonly init: { output: (frame: Frame) => void }) {
    FakeDecoder.all.push(this);
  }
  configure() {
    this.state = "configured";
  }
  decode() {
    this.decodeQueueSize += 1;
  }
  close() {
    this.state = "closed";
  }
  emit(width: number): Frame {
    this.decodeQueueSize = Math.max(0, this.decodeQueueSize - 1);
    const frame: Frame = { displayWidth: width, displayHeight: 10, closed: false, close: () => (frame.closed = true) };
    this.init.output(frame);
    return frame;
  }
}

const globals = ["isSecureContext", "VideoDecoder", "EncodedVideoChunk", "requestAnimationFrame", "cancelAnimationFrame", "fetch"] as const;
const saved = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
let frames: Array<() => void> = [];
let opened: Array<{ file: string; write: (bytes: number[]) => void }> = [];
let waiting: Array<() => void> = [];

beforeEach(() => {
  FakeDecoder.supported = true;
  FakeDecoder.all = [];
  frames = [];
  opened = [];
  waiting = [];
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  set("isSecureContext", true);
  set("VideoDecoder", FakeDecoder);
  set("EncodedVideoChunk", class {});
  set("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  set("cancelAnimationFrame", () => undefined);
  set("fetch", async (url: string, init: { signal: AbortSignal }) => {
    const file = url.split("/").pop()!;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    init.signal.addEventListener("abort", () => controller.error(new Error("aborted")));
    if (file !== "stream.mjpeg") opened.push({ file, write: (bytes) => controller.enqueue(new Uint8Array(bytes)) });
    for (const wake of waiting.splice(0)) wake();
    return new Response(body);
  });
});

afterEach(() => {
  for (const name of globals) {
    const descriptor = saved[name];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const avccOpened = async (count: number) => {
  while (opened.length < count) await new Promise<void>((resolve) => waiting.push(resolve));
  await settle();
  return opened[count - 1]!;
};
const decoderReady = async (count: number) => {
  while (FakeDecoder.all.length < count || FakeDecoder.all[count - 1]!.state !== "configured") await settle();
  return FakeDecoder.all[count - 1]!;
};
const opening = [...envelope(1, 1, 0x64, 0x00, 0x33), ...envelope(2, 0xaa)];
const deltas = (count: number) => Array.from({ length: count }, (_, index) => envelope(3, index)).flat();

function player() {
  const drawn: number[] = [];
  const mjpeg: string[] = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (source: Frame) => drawn.push(source.displayWidth) }) } as unknown as HTMLCanvasElement;
  const stream = startStream({ canvas, url: (file) => `/hub/${file}`, onStatus: () => undefined, onMjpeg: (url) => mjpeg.push(url), onFrame: () => undefined });
  return { drawn, mjpeg, stop: stream.stop };
}

test("an origin that cannot decode H.264 plays MJPEG and never opens the H.264 stream", async () => {
  Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false });
  const { mjpeg, stop } = player();
  await settle();
  expect(mjpeg).toEqual(["/hub/stream.mjpeg"]);
  expect(opened).toEqual([]);
  stop();
});

test("a simulator profile the decoder rejects plays MJPEG", async () => {
  FakeDecoder.supported = false;
  const { mjpeg, stop } = player();
  (await avccOpened(1)).write(opening);
  while (mjpeg.length === 0) await settle();
  expect(mjpeg).toEqual(["/hub/stream.mjpeg"]);
  stop();
});

test("decoded frames that land together paint once, as the newest, and the older ones are released", async () => {
  const { drawn, stop } = player();
  (await avccOpened(1)).write([...opening, ...deltas(2)]);
  const decoder = await decoderReady(1);
  const early = [decoder.emit(1), decoder.emit(2)];
  decoder.emit(3);
  expect(frames).toHaveLength(1);
  frames.splice(0).forEach((paint) => paint());
  expect(drawn).toEqual([3]);
  expect(early.every((frame) => frame.closed)).toBe(true);
  stop();
});

test("a decode backlog reopens the H.264 stream instead of switching to MJPEG, until it keeps happening", async () => {
  const { mjpeg, stop } = player();
  for (let backlog = 1; backlog <= 2; backlog += 1) {
    (await avccOpened(backlog)).write([...opening, ...deltas(9)]);
    await avccOpened(backlog + 1);
    expect(mjpeg).toEqual([]);
  }
  opened[2]!.write([...opening, ...deltas(9)]);
  while (mjpeg.length === 0) await settle();
  expect(mjpeg).toEqual(["/hub/stream.mjpeg"]);
  expect(opened).toHaveLength(3);
  stop();
});
