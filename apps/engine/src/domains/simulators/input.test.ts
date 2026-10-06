import { expect, test } from "bun:test";
import { encodeInput, InputRelay, type HubSocket } from "./input";

const decode = (frame: Uint8Array) => ({ tag: frame[0], body: JSON.parse(new TextDecoder().decode(frame.subarray(1))) });

test("each input is one tag byte and its JSON, as serve-sim's helper reads it", () => {
  expect(decode(encodeInput({ type: "touch", phase: "begin", x: 0.25, y: 0.5 }))).toEqual({ tag: 0x03, body: { type: "begin", x: 0.25, y: 0.5 } });
  expect(decode(encodeInput({ type: "button", button: "home" }))).toEqual({ tag: 0x04, body: { button: "home" } });
  expect(decode(encodeInput({ type: "key", phase: "down", usage: 4 }))).toEqual({ tag: 0x06, body: { type: "down", usage: 4 } });
  expect(decode(encodeInput({ type: "orientation", orientation: "landscape_left" }))).toEqual({ tag: 0x07, body: { orientation: "landscape_left" } });
  expect(decode(encodeInput({ type: "keyboard", enabled: false }))).toEqual({ tag: 0x0d, body: { enabled: false } });
});

test("a watch's crown turns by its delta, and its crown and side button are pressed as HID usages", () => {
  expect(decode(encodeInput({ type: "crown", delta: -12.5 }))).toEqual({ tag: 0x0a, body: { delta: -12.5 } });
  expect(decode(encodeInput({ type: "button", button: "digital_crown" }))).toEqual({ tag: 0x04, body: { button: "digital_crown", page: 12, usage: 64, phase: "press" } });
  expect(decode(encodeInput({ type: "button", button: "side_button" }))).toEqual({ tag: 0x04, body: { button: "side_button", page: 12, usage: 149, phase: "press" } });
});

function sockets() {
  const opened: Array<{ url: string; frames: Uint8Array[]; open: boolean; closed: boolean }> = [];
  const relay = new InputRelay(async (url) => {
    const entry = { url, frames: [] as Uint8Array[], open: true, closed: false };
    opened.push(entry);
    const socket: HubSocket = {
      send: (data) => void entry.frames.push(data),
      close: () => {
        entry.open = false;
        entry.closed = true;
      },
      get open() {
        return entry.open;
      },
    };
    return socket;
  });
  return { relay, opened };
}

test("one socket per simulator carries its input, and a socket that closed is reopened", async () => {
  const { relay, opened } = sockets();
  await relay.send("http://127.0.0.1:4321", "A1B2", [{ type: "button", button: "home" }]);
  await relay.send("http://127.0.0.1:4321", "A1B2", [{ type: "touch", phase: "begin", x: 0, y: 0 }, { type: "touch", phase: "end", x: 0, y: 0 }]);
  expect(opened.map((entry) => entry.url)).toEqual(["ws://127.0.0.1:4321/vendor/serve-sim/helper/ws?device=A1B2"]);
  expect(opened[0]!.frames).toHaveLength(3);
  opened[0]!.open = false;
  await relay.send("http://127.0.0.1:4321", "A1B2", [{ type: "button", button: "lock" }]);
  expect(opened).toHaveLength(2);
  relay.closeAll();
  expect(opened[1]!.closed).toBe(true);
});

test("a socket that cannot open is not kept, so the next input tries again", async () => {
  let attempts = 0;
  const relay = new InputRelay(async () => {
    attempts += 1;
    throw new Error("refused");
  });
  await expect(relay.send("http://127.0.0.1:4321", "A1B2", [{ type: "button", button: "home" }])).rejects.toThrow("refused");
  await expect(relay.send("http://127.0.0.1:4321", "A1B2", [{ type: "button", button: "home" }])).rejects.toThrow("refused");
  expect(attempts).toBe(2);
});
