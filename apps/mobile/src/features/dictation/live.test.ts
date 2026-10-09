import { expect, test } from "bun:test";
import { listenUrl, openLive, readWords } from "./live";
import type { Words } from "./strip";

const grant = { token: "jwt", language: "es", keyterms: ["Telar"] };

class FakeSocket {
  readyState = 0;
  sent: Array<string | ArrayBuffer> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

const start = () => {
  let socket!: FakeSocket;
  const heard: Words[] = [];
  let ended = 0;
  const live = openLive(grant, 16_000, { words: (words) => heard.push(words), ended: () => ended++ }, (url, protocols) => (socket = new FakeSocket(url, protocols)));
  return { live, socket, heard, ended: () => ended };
};

const result = (transcript: string, final: boolean) => JSON.stringify({ type: "Results", is_final: final, channel: { alternatives: [{ transcript }] } });

test("the live query asks for interim results on raw 16 kHz mono audio, with the language and key terms", () => {
  const url = new URL(listenUrl("es", ["Telar", "worktree"], 16_000));
  expect(url.protocol).toBe("wss:");
  expect(url.searchParams.get("interim_results")).toBe("true");
  expect(url.searchParams.get("encoding")).toBe("linear16");
  expect(url.searchParams.get("sample_rate")).toBe("16000");
  expect(url.searchParams.get("language")).toBe("es");
  expect(url.searchParams.getAll("keyterm")).toEqual(["Telar", "worktree"]);
});

test("only result frames are read as words", () => {
  expect(readWords(result(" open the diff ", true))).toEqual({ text: "open the diff", final: true });
  expect(readWords(result("open", false))).toEqual({ text: "open", final: false });
  expect(readWords(JSON.stringify({ type: "Metadata" }))).toBeUndefined();
  expect(readWords("not json")).toBeUndefined();
});

test("the grant rides in the subprotocol and audio captured before the socket opens is sent once it does", () => {
  const { live, socket } = start();
  expect(socket.protocols).toEqual(["bearer", "jwt"]);
  const early = new ArrayBuffer(2);
  live.send(early);
  expect(socket.sent).toEqual([]);
  socket.open();
  const late = new ArrayBuffer(4);
  live.send(late);
  expect(socket.sent).toEqual([early, late]);
});

test("finishing asks for the last words, keeps them, and is not reported as a dropped connection", async () => {
  const { live, socket, heard, ended } = start();
  socket.open();
  const finishing = live.finish();
  expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
  socket.onmessage?.({ data: result("last words", true) });
  socket.onclose?.();
  await finishing;
  expect(heard).toEqual([{ text: "last words", final: true }]);
  expect(socket.closed).toBe(true);
  expect(ended()).toBe(0);
});

test("a socket that drops while listening is reported once; a cancelled one is not", () => {
  const dropped = start();
  dropped.socket.open();
  dropped.socket.onerror?.();
  dropped.socket.onclose?.();
  expect(dropped.ended()).toBe(1);

  const cancelled = start();
  cancelled.socket.open();
  cancelled.live.cancel();
  cancelled.socket.onclose?.();
  expect(cancelled.ended()).toBe(0);
  expect(cancelled.socket.closed).toBe(true);
});
