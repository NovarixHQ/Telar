type AvccChunk = { type: "description" | "keyframe" | "delta" | "seed"; payload: Uint8Array };

const AVCC_TAGS: Record<number, AvccChunk["type"]> = { 1: "description", 2: "keyframe", 3: "delta", 4: "seed" };
const FRAME_DURATION_US = 16_667;
const SOFT_DECODE_QUEUE = 8;
const WATCHDOG_MS = 15_000;
const RETRY_MS = 1_000;
const PRIME_MS = 2_000;
const BACKLOG_LIMIT = 3;
const BACKLOG_WINDOW_MS = 30_000;

export class AvccDemuxer {
  private buffer = new Uint8Array(0);

  push(bytes: Uint8Array): AvccChunk[] {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer);
    joined.set(bytes, this.buffer.length);
    const chunks: AvccChunk[] = [];
    let offset = 0;
    while (joined.length - offset >= 4) {
      const length = new DataView(joined.buffer, offset, 4).getUint32(0, false);
      if (joined.length - offset - 4 < length) break;
      const type = length >= 1 ? AVCC_TAGS[joined[offset + 4]!] : undefined;
      if (type) chunks.push({ type, payload: joined.slice(offset + 5, offset + 4 + length) });
      offset += 4 + length;
    }
    this.buffer = joined.slice(offset);
    return chunks;
  }
}

export function avcCodecString(description: Uint8Array): string {
  if (description.length < 4) return "avc1.42E01E";
  const hex = (byte: number) => byte.toString(16).padStart(2, "0");
  return `avc1.${hex(description[1]!)}${hex(description[2]!)}${hex(description[3]!)}`;
}

export function canDecodeH264(scope: { isSecureContext?: boolean; VideoDecoder?: unknown; EncodedVideoChunk?: unknown } = globalThis): boolean {
  return scope.isSecureContext === true && typeof scope.VideoDecoder === "function" && typeof scope.EncodedVideoChunk === "function";
}

const supported = (config: VideoDecoderConfig) => VideoDecoder.isConfigSupported(config).then((answer) => answer.supported === true, () => false);

async function decoderConfig(description: Uint8Array): Promise<VideoDecoderConfig | undefined> {
  const config: VideoDecoderConfig = { codec: avcCodecString(description), description, optimizeForLatency: true };
  const software: VideoDecoderConfig = { ...config, hardwareAcceleration: "prefer-software" };
  if (await supported(software)) return software;
  return (await supported(config)) ? config : undefined;
}

export type StreamStatus = { state: "connecting" | "streaming" | "error"; detail?: string };

type StreamOptions = {
  canvas: HTMLCanvasElement;
  url: (file: "stream.avcc" | "stream.mjpeg") => string;
  onStatus: (status: StreamStatus) => void;
  onMjpeg: (url: string) => void;
  onFrame: (width: number, height: number) => void;
};

export function startStream(options: StreamOptions): { stop: () => void; mjpegLoaded: (width: number, height: number) => void } {
  let stopped = false;
  let controller: AbortController | undefined;
  let decoder: VideoDecoder | undefined;
  let awaitingKeyframe = true;
  let timestamp = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let streaming = false;
  let backlogs: number[] = [];

  const arm = (detail: string) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => fail(detail), WATCHDOG_MS);
  };
  const fail = (detail: string) => {
    if (stopped) return;
    streaming = false;
    options.onStatus({ state: "error", detail });
  };
  const painted = (width: number, height: number) => {
    clearTimeout(watchdog);
    options.onFrame(width, height);
    if (!streaming) options.onStatus({ state: "streaming" });
    streaming = true;
  };
  const paint = (source: CanvasImageSource, width: number, height: number) => {
    const context = options.canvas.getContext("2d");
    if (!context) return fail("This browser could not draw the simulator.");
    if (options.canvas.width !== width || options.canvas.height !== height) Object.assign(options.canvas, { width, height });
    context.drawImage(source, 0, 0, width, height);
    painted(width, height);
  };
  const show = (frame: VideoFrame) => {
    try {
      paint(frame, frame.displayWidth, frame.displayHeight);
    } finally {
      frame.close();
    }
  };
  const closeDecoder = () => {
    if (decoder && decoder.state !== "closed") decoder.close();
    decoder = undefined;
    awaitingKeyframe = true;
  };
  const fallBack = () => {
    controller?.abort();
    closeDecoder();
    arm("No video arrived from the simulator.");
    options.onMjpeg(options.url("stream.mjpeg"));
  };
  const catchUp = () => {
    const now = Date.now();
    backlogs = [...backlogs.filter((at) => now - at < BACKLOG_WINDOW_MS), now];
    if (backlogs.length >= BACKLOG_LIMIT) return fallBack();
    controller?.abort();
    closeDecoder();
    void readAvcc();
  };
  const configure = async (description: Uint8Array): Promise<boolean> => {
    const config = await decoderConfig(description);
    if (stopped || !config) return false;
    closeDecoder();
    decoder = new VideoDecoder({
      output: show,
      error: () => !stopped && catchUp(),
    });
    decoder.configure(config);
    return true;
  };
  const decode = (key: boolean, data: Uint8Array) => {
    if (!decoder || decoder.state !== "configured") return;
    if (awaitingKeyframe && !key) return;
    awaitingKeyframe = false;
    if (decoder.decodeQueueSize > SOFT_DECODE_QUEUE) return catchUp();
    decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp, data }));
    timestamp += FRAME_DURATION_US;
  };
  const prime = async () => {
    const priming = new AbortController();
    const timer = setTimeout(() => priming.abort(), PRIME_MS);
    try {
      const response = await fetch(options.url("stream.mjpeg"), { signal: priming.signal });
      await response.body?.getReader().read();
    } catch {
    } finally {
      clearTimeout(timer);
      priming.abort();
    }
  };
  const seed = (payload: Uint8Array, own: AbortController) =>
    void createImageBitmap(new Blob([payload as BlobPart], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (!own.signal.aborted) paint(bitmap, bitmap.width, bitmap.height);
        bitmap.close();
      })
      .catch(() => undefined);
  const readAvcc = async () => {
    const own = new AbortController();
    controller = own;
    const demuxer = new AvccDemuxer();
    arm("No video arrived from the simulator.");
    try {
      const response = await fetch(options.url("stream.avcc"), { signal: own.signal });
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped || own.signal.aborted) break;
        for (const chunk of demuxer.push(value)) {
          if (own.signal.aborted) break;
          if (chunk.type === "seed") seed(chunk.payload, own);
          else if (chunk.type === "description") {
            if (!(await configure(chunk.payload))) return fallBack();
          } else decode(chunk.type === "keyframe", chunk.payload);
        }
      }
    } catch {}
    if (stopped || own.signal.aborted) return;
    closeDecoder();
    options.onStatus({ state: "connecting" });
    retry = setTimeout(() => void readAvcc(), RETRY_MS);
  };

  options.onStatus({ state: "connecting" });
  if (canDecodeH264()) {
    void prime();
    void readAvcc();
  } else fallBack();

  return {
    stop() {
      stopped = true;
      clearTimeout(watchdog);
      clearTimeout(retry);
      controller?.abort();
      closeDecoder();
    },
    mjpegLoaded: painted,
  };
}
