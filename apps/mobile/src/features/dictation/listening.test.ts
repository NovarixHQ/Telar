import { expect, test } from "bun:test";
import { SOCKET_ENDED, TranscriptionRefused } from "./grant";
import { Listening, MIC_LOST, NO_ROUTE } from "./listening";
import type { Live } from "./live";
import { EMPTY_STRIP, flush, hear, type Words } from "./strip";

class FakeLive implements Live {
  sent: ArrayBuffer[] = [];
  keptAlive = 0;
  cancelled = false;
  constructor(readonly on: { words: (words: Words) => void; ended: () => void }) {}
  send(chunk: ArrayBuffer) {
    this.sent.push(chunk);
  }
  keepAlive() {
    this.keptAlive += 1;
  }
  async finish() {}
  cancel() {
    this.cancelled = true;
  }
}

const setup = (rebuild: () => Promise<void> = async () => undefined) => {
  let clock = 0;
  let strip = EMPTY_STRIP;
  const draft: string[] = [];
  const sockets: FakeLive[] = [];
  const problems: unknown[] = [];
  const capture = { rebuilds: 0, stopped: 0, rebuild: () => (capture.rebuilds++, rebuild()), stop: async () => void capture.stopped++ };
  const take = (step: { strip: typeof EMPTY_STRIP; commit: string }) => {
    strip = step.strip;
    if (step.commit) draft.push(step.commit);
  };
  const run = new Listening({
    capture,
    open: async (on) => {
      const live = new FakeLive(on);
      sockets.push(live);
      return live;
    },
    words: (words) => take(hear(strip, words)),
    flush: () => take({ strip: EMPTY_STRIP, commit: flush(strip).commit }),
    ended: (problem) => problems.push(problem),
    now: () => clock,
  });
  const socket = () => sockets.at(-1)!;
  const say = (text: string, final: boolean) => socket().on.words({ text, final });
  const advance = (ms: number) => (clock += ms);
  return { run, capture, sockets, socket, say, draft, problems, heard: () => strip.heard, advance };
};

const chunk = () => new ArrayBuffer(2);

test("a route change taps the microphone again and keeps the socket and the words already heard", async () => {
  const { run, capture, sockets, socket, say, draft, heard, problems } = setup();
  await run.begin();
  say("open the diff", true);
  say("and then", false);

  await run.event({ type: "route", reason: "newDeviceAvailable" });

  expect(capture.rebuilds).toBe(1);
  expect(sockets).toHaveLength(1);
  expect(socket().cancelled).toBe(false);
  expect(heard()).toBe("and then");
  const after = chunk();
  run.audio(after);
  expect(socket().sent.at(-1)).toBe(after);
  say("and then run the tests", true);
  expect(draft).toEqual(["open the diff", "and then run the tests"]);
  expect(problems).toEqual([]);
});

test("a burst of route changes rebuilds once more after the one running, not once per event", async () => {
  const { run, capture } = setup();
  await run.begin();
  const first = run.event({ type: "route", reason: "oldDeviceUnavailable" });
  void run.event({ type: "reset" });
  void run.event({ type: "route", reason: "routeConfigurationChange" });
  await first;
  expect(capture.rebuilds).toBe(2);
});

test("our own category change does not rebuild", async () => {
  const { run, capture } = setup();
  await run.begin();
  await run.event({ type: "route", reason: "categoryChange" });
  expect(capture.rebuilds).toBe(0);
});

test("an interruption keeps the socket alive without stopping, retries while the microphone is held, and its end resumes", async () => {
  let held = true;
  const { run, capture, socket, advance, problems } = setup(async () => {
    if (held) throw new Error("insufficient priority");
  });
  await run.begin();
  await run.event({ type: "interruption", began: true });
  await run.event({ type: "route", reason: "oldDeviceUnavailable" });
  expect(capture.rebuilds).toBe(0);

  advance(4_000);
  await run.tick();
  expect(socket().keptAlive).toBe(1);
  expect(capture.rebuilds).toBe(1);
  expect(problems).toEqual([]);

  held = false;
  await run.event({ type: "interruption", began: false });
  expect(capture.rebuilds).toBe(2);
  await run.event({ type: "route", reason: "newDeviceAvailable" });
  expect(capture.rebuilds).toBe(3);
  expect(problems).toEqual([]);
  expect(socket().cancelled).toBe(false);
});

test("a microphone that cannot be tapped again stops cleanly with a reason", async () => {
  const { run, capture, socket, problems } = setup(async () => {
    throw new Error("no input");
  });
  await run.begin();
  await run.event({ type: "route", reason: "newDeviceAvailable" });
  expect(problems.map((problem) => (problem as Error).message)).toEqual([MIC_LOST]);
  expect(socket().cancelled).toBe(true);
  expect(capture.stopped).toBe(1);
});

test("a route with no microphone stops with a reason", async () => {
  const { run, problems } = setup();
  await run.begin();
  await run.event({ type: "route", reason: "noSuitableRouteForCategory" });
  expect(problems.map((problem) => (problem as Error).message)).toEqual([NO_ROUTE]);
});

test("audio that stops arriving is tapped again once, then reported instead of staying deaf", async () => {
  const { run, capture, advance, problems } = setup();
  await run.begin();
  run.audio(chunk());
  advance(3_000);
  await run.tick();
  expect(capture.rebuilds).toBe(1);
  expect(problems).toEqual([]);
  advance(3_000);
  await run.tick();
  expect(problems.map((problem) => (problem as Error).message)).toEqual([MIC_LOST]);

  const healthy = setup();
  await healthy.run.begin();
  healthy.advance(3_000);
  await healthy.run.tick();
  healthy.run.audio(chunk());
  healthy.advance(2_000);
  await healthy.run.tick();
  healthy.run.audio(chunk());
  healthy.advance(3_000);
  await healthy.run.tick();
  expect(healthy.capture.rebuilds).toBe(2);
  expect(healthy.problems).toEqual([]);
});

test("a dropped socket reconnects once, writing the interim words first and holding audio meanwhile", async () => {
  const { run, sockets, socket, say, draft, problems } = setup();
  await run.begin();
  say("open the", false);
  socket().on.ended();
  const held = chunk();
  run.audio(held);
  await Promise.resolve();
  await Promise.resolve();

  expect(sockets).toHaveLength(2);
  expect(draft).toEqual(["open the"]);
  expect(socket().sent).toEqual([held]);
  say("diff", true);
  expect(draft).toEqual(["open the", "diff"]);

  socket().on.ended();
  await Promise.resolve();
  expect(sockets).toHaveLength(3);
  socket().on.ended();
  expect(problems).toHaveLength(1);
  expect(problems[0]).toBeInstanceOf(TranscriptionRefused);
  expect((problems[0] as Error).message).toBe(SOCKET_ENDED);
});

test("finishing stops capture and nothing that follows is reported", async () => {
  const { run, capture, problems } = setup();
  await run.begin();
  await run.finish();
  await run.event({ type: "route", reason: "noSuitableRouteForCategory" });
  await run.tick();
  expect(capture.stopped).toBe(1);
  expect(problems).toEqual([]);
});
