import { describe, expect, test } from "bun:test";
import { createTerminalBridge, describeTerminalEnding, type TerminalChunk, type TerminalEnding } from "./bridge";

describe("describeTerminalEnding", () => {
  test("an observed exit says so, with its status", () => {
    expect(describeTerminalEnding({ id: "t", fate: "exited", exitCode: 0 })).toBe("Shell exited.");
    expect(describeTerminalEnding({ id: "t", fate: "exited", exitCode: 127 })).toContain("127");
    expect(describeTerminalEnding({ id: "t", fate: "exited", signal: "SIGTERM" })).toContain("SIGTERM");
  });

  test("a nonzero status is REPORTED rather than reinterpreted", () => {
    // A missing binary and an unusable cwd both fork fine and fail inside the
    // child, so each arrives as a nonzero `exited` (126 and 1, measured by W1),
    // never as `failed`. "The command was wrong" is read off the code by a
    // human; this surface does not guess which of the two it was.
    expect(describeTerminalEnding({ id: "t", fate: "exited", exitCode: 126 })).toContain("126");
  });

  test("`failed` says no process ever existed", () => {
    const sentence = describeTerminalEnding({ id: "t", fate: "failed", error: "ENOENT" });
    expect(sentence).toContain("never started");
    expect(sentence).toContain("ENOENT");
  });

  test("a terminal the host closed on purpose says closed, not the signal that did it", () => {
    // The SIGTERM is how a close works, not news about the process.
    const sentence = describeTerminalEnding({ id: "t", fate: "exited", signal: "SIGTERM", closed: "session" });
    expect(sentence).toBe("Shell closed.");
  });
});

type Call = { path: string; body: Record<string, unknown> };

function engine(answer: (call: Call) => unknown, streams: Array<(controller: ReadableStreamDefaultController<Uint8Array>) => void> = []) {
  const calls: Call[] = [];
  const encoder = new TextEncoder();
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { path: String(input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    calls.push(call);
    if (call.path.endsWith("/stream")) {
      const start = streams.shift();
      if (!start) return new Response(null, { status: 404 });
      return new Response(new ReadableStream<Uint8Array>({ start }), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json(answer(call));
  };
  const frame = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  return { calls, fetcher, frame };
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the bridge to the engine's terminals", () => {
  test("opens, resizes, closes and asks about activity over the engine's terminal routes", async () => {
    const { calls, fetcher } = engine(() => ({ id: "term_1", pid: 7 }));
    const bridge = createTerminalBridge(fetcher);

    expect(await bridge.open({ cwd: "/work", cols: 100, rows: 30, sessionId: "s1" })).toEqual({ id: "term_1", pid: 7 });
    await bridge.resize("term_1", 120, 40);
    await bridge.close?.("term_1");
    await bridge.active?.(["term_1"]);
    await bridge.kill("term_1", "SIGINT");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/terminals/open",
      "/api/terminals/term_1/resize",
      "/api/terminals/term_1/close",
      "/api/terminals/active",
      "/api/terminals/term_1/kill",
    ]);
    expect(calls[0]!.body).toEqual({ cwd: "/work", cols: 100, rows: 30, sessionId: "s1" });
    expect(calls[3]!.body).toEqual({ ids: ["term_1"] });
    expect(calls[4]!.body).toEqual({ signal: "SIGINT" });
  });

  test("keystrokes go one request at a time and in order, the ones typed meanwhile joined into the next", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sent: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      sent.push((JSON.parse(String(init?.body)) as { data: string }).data);
      if (sent.length === 1) await gate;
      inFlight -= 1;
      return Response.json({ ok: true });
    };
    const bridge = createTerminalBridge(fetcher);

    void bridge.write("t", "l");
    await nextTurn();
    void bridge.write("t", "s");
    void bridge.write("t", "\r");
    release();
    await nextTurn();
    await nextTurn();

    expect(sent).toEqual(["l", "s\r"]);
    expect(peak).toBe(1);
  });

  test("follow delivers a terminal's output and its ending to the listeners, then stops asking", async () => {
    const live = engine(() => ({}), [
      (controller) => {
        controller.enqueue(live.frame({ type: "data", data: "hello\r\n", cursor: 1 }));
        controller.enqueue(live.frame({ type: "exit", ending: { id: "term_1", fate: "exited", exitCode: 3 } }));
        controller.close();
      },
    ]);
    const bridge = createTerminalBridge(live.fetcher);
    const chunks: TerminalChunk[] = [];
    const endings: TerminalEnding[] = [];
    bridge.onData((chunk) => void chunks.push(chunk));
    bridge.onExit((ending) => void endings.push(ending));

    bridge.follow?.("term_1");
    await nextTurn();
    await nextTurn();

    expect(chunks).toEqual([{ id: "term_1", data: "hello\r\n", cursor: 1 }]);
    expect(endings).toEqual([{ id: "term_1", fate: "exited", exitCode: 3 }]);
    expect(live.calls).toEqual([{ path: "/api/terminals/term_1/stream", body: { after: 0 } }]);
  });

  test("a dropped stream is picked up again from the last cursor", async () => {
    const live = engine(() => ({}), [
      (controller) => {
        controller.enqueue(live.frame({ type: "data", data: "one", cursor: 4 }));
        controller.close();
      },
      (controller) => {
        controller.enqueue(live.frame({ type: "data", data: "two", cursor: 5 }));
      },
    ]);
    const bridge = createTerminalBridge(live.fetcher, [0]);
    const chunks: string[] = [];
    bridge.onData((chunk) => void chunks.push(chunk.data));

    const stop = bridge.follow?.("term_1");
    for (let turn = 0; turn < 5; turn += 1) await nextTurn();

    expect(chunks).toEqual(["one", "two"]);
    expect(live.calls.map((call) => call.body)).toEqual([{ after: 0 }, { after: 4 }]);
    stop?.();
  });

  test("a terminal the engine no longer knows ends instead of being retried for ever", async () => {
    const live = engine(() => ({}), []);
    const bridge = createTerminalBridge(live.fetcher);
    const endings: TerminalEnding[] = [];
    bridge.onExit((ending) => void endings.push(ending));

    bridge.follow?.("term_gone");
    await nextTurn();
    await nextTurn();

    expect(endings).toEqual([{ id: "term_gone", fate: "exited" }]);
    expect(live.calls).toHaveLength(1);
  });

  test("an image path is read by the engine and comes back as bytes, or as its refusal", async () => {
    const { fetcher } = engine((call) => (call.body.path === "/a.png" ? { ok: true, base64: btoa("PNG") } : { ok: false, code: "ENOENT" }));
    const bridge = createTerminalBridge(fetcher);
    const answer = await bridge.readImageFile?.("/a.png");
    expect(answer?.ok && new TextDecoder().decode(answer.bytes)).toBe("PNG");
    expect(await bridge.readImageFile?.("/b.png")).toEqual({ ok: false, code: "ENOENT" });
  });
});
