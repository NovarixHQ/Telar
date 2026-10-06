import type { SimulatorInput } from "@telar/engine-client";

export type HubSocket = { send(data: Uint8Array<ArrayBuffer>): void; close(): void; readonly open: boolean };
export type OpenSocket = (url: string) => Promise<HubSocket>;

const OPEN_TIMEOUT_MS = 10_000;
const IDLE_MS = 60_000;

const openWebSocket: OpenSocket = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("The simulator hub did not open its input socket."));
    }, OPEN_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve({ send: (data) => socket.send(data), close: () => socket.close(), get open() { return socket.readyState === WebSocket.OPEN; } });
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("The simulator hub refused its input socket."));
    };
  });

const TAGS = { touch: 0x03, button: 0x04, key: 0x06, orientation: 0x07, keyboard: 0x0d } as const;

export function encodeInput(event: SimulatorInput): Uint8Array<ArrayBuffer> {
  const payload =
    event.type === "touch" ? { type: event.phase, x: event.x, y: event.y }
    : event.type === "button" ? { button: event.button }
    : event.type === "key" ? { type: event.phase, usage: event.usage }
    : event.type === "orientation" ? { orientation: event.orientation }
    : { enabled: event.enabled };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const frame = new Uint8Array(json.length + 1);
  frame[0] = TAGS[event.type];
  frame.set(json, 1);
  return frame;
}

export class InputRelay {
  private readonly sockets = new Map<string, { socket: Promise<HubSocket>; ready?: HubSocket; idle?: ReturnType<typeof setTimeout> }>();

  constructor(private readonly open: OpenSocket = openWebSocket) {}

  async send(origin: string, udid: string, events: readonly SimulatorInput[]): Promise<void> {
    const url = `${origin.replace(/^http/, "ws")}/vendor/serve-sim/helper/ws?device=${encodeURIComponent(udid)}`;
    let entry = this.sockets.get(url);
    if (entry && !(await entry.socket.catch(() => undefined))?.open) {
      this.drop(url);
      entry = undefined;
    }
    if (!entry) {
      entry = { socket: this.open(url) };
      this.sockets.set(url, entry);
    }
    const socket = await entry.socket.catch((error: unknown) => {
      this.drop(url);
      throw error;
    });
    entry.ready = socket;
    for (const event of events) socket.send(encodeInput(event));
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => this.drop(url), IDLE_MS);
    entry.idle.unref?.();
  }

  closeAll(): void {
    for (const url of this.sockets.keys()) this.drop(url);
  }

  private drop(url: string): void {
    const entry = this.sockets.get(url);
    if (!entry) return;
    this.sockets.delete(url);
    clearTimeout(entry.idle);
    if (entry.ready) entry.ready.close();
    else void entry.socket.then((socket) => socket.close(), () => undefined);
  }
}
