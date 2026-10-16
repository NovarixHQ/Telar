import { describe, expect, test } from "bun:test";
import type { TurnObservation } from "@telar/engine-client";
import { SteerMailbox } from "../../domains/turns";
import { until } from "../../../test/wait";
import { createClaudeDriver, run } from "../../../test/claude-harness";

describe("background work outlives its turn, but not its process (#465)", () => {
  const settleUntil = async (check: () => boolean, ms = 1_000) => {
    const until = Date.now() + ms;
    while (!check() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 2));
    expect(check()).toBe(true);
  };

  /** A session door with a recorder behind each hook — the idle-pump shape,
   *  re-declared because the one above is scoped to its own describe block. */
  const door465 = () => {
    const tasks: TurnObservation[] = [];
    const turns: Array<{ input: string; reason: unknown; observations: TurnObservation[]; closed?: unknown }> = [];
    let runSeq = 0;
    return {
      tasks,
      turns,
      hooks: {
        onTasks: async (batch: TurnObservation[]) => void tasks.push(...batch),
        onProviderTurn: async ({ input, reason }: { input: string; reason: unknown }) => {
          const record = { input, reason, observations: [] as TurnObservation[] } as (typeof turns)[number];
          turns.push(record);
          return {
            runId: `run_465_${(runSeq += 1)}`,
            onObservations: async (batch: TurnObservation[]) => void record.observations.push(...batch),
            close: async (result: unknown) => { record.closed = result; },
          };
        },
      },
    };
  };

  test("a reply with nothing left but a RUNNING background task settles, and the shell's ending opens a turn of its own", async () => {
    let releaseWake: (() => void) | undefined;
    const woke = new Promise<void>((resolve) => { releaseWake = resolve; });
    const driver = createClaudeDriver(async () => ({
      async *query({ prompt }: { prompt: AsyncIterable<{ uuid?: string }> }) {
        const input = prompt[Symbol.asyncIterator]();
        const first = await input.next();
        const uuid = first.value!.uuid!;
        yield { type: "stream_event", event: { type: "message_start" }, user_message_uuid: uuid };
        yield { type: "system", subtype: "task_started", task_id: "bg1", tool_use_id: "toolu_bg", description: "watch CI", task_type: "local_bash", is_backgrounded: true };
        yield { type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "bg1", task_type: "local_bash", description: "watch CI" }] };
        yield { type: "assistant", message: { content: [{ type: "text", text: "Watching CI; I'll report back." }], stop_reason: "end_turn" } };
        // …and then nothing. No `result` — the measured stall exactly.
        await woke;
        yield { type: "system", subtype: "task_notification", task_id: "bg1", status: "completed", summary: "CI is green" };
        yield { type: "user", message: { role: "user", content: "Background task completed (CI is green)." } };
        yield { type: "stream_event", event: { type: "message_start" } };
        yield { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } };
        yield { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Green — merging." } } };
        yield { type: "stream_event", event: { type: "content_block_stop", index: 0 } };
        yield { type: "result", subtype: "success", stop_reason: "end_turn", origin: { kind: "task-notification" } };
        await input.next();
      },
    }) as never);
    const door = door465();
    const { sink, result } = run(driver, { sessionId: "session_465_bg", session: door.hooks, endTurnGraceMs: 20 });
    // The turn ends on the reply it actually wrote, with the shell still alive.
    await expect(result).resolves.toMatchObject({ text: "Watching CI; I'll report back." });
    // NOT swept: background work is what outlives a turn, and closing it here
    // would kill the very thing the person is waiting on.
    expect(sink.observations.some((o) => o.kind === "task.completed")).toBe(false);

    releaseWake!();
    // Its ending arrives on the idle pump and opens a NEW turn, named after the
    // shell that woke it — the wake path #71/#447 already built.
    await settleUntil(() => door.turns[0]?.closed !== undefined);
    expect(door.turns).toHaveLength(1);
    expect(door.turns[0]!.reason).toEqual({ kind: "task_notification", taskId: "task_toolu_bg" });
    expect(door.turns[0]!.closed).toEqual({ text: "Green — merging." });
  });

  test("a process that dies BETWEEN turns with background work inside it says how much was lost, and the rows stop claiming to run", async () => {
    let releaseDeath: (() => void) | undefined;
    const died = new Promise<void>((resolve) => { releaseDeath = resolve; });
    const driver = createClaudeDriver(async () => ({
      async *query({ prompt }: { prompt: AsyncIterable<{ uuid?: string }> }) {
        const input = prompt[Symbol.asyncIterator]();
        const first = await input.next();
        const uuid = first.value!.uuid!;
        yield { type: "system", subtype: "task_started", task_id: "bg1", tool_use_id: "toolu_bg", description: "watch CI", task_type: "local_bash", is_backgrounded: true };
        yield { type: "system", subtype: "task_started", task_id: "bg2", tool_use_id: "toolu_bg2", description: "tail the log", task_type: "monitor", is_backgrounded: true };
        yield { type: "stream_event", event: { type: "message_start" }, user_message_uuid: uuid };
        yield { type: "assistant", message: { content: [{ type: "text", text: "both running" }] } };
        yield { type: "result", subtype: "success", stop_reason: "end_turn", user_message_uuid: uuid };
        // The turn is over and the process is idle. Then it dies — a crash, a
        // quit, the owner restarting Telar.
        await died;
      },
    }) as never);
    const door = door465();
    await run(driver, { sessionId: "session_465_death", session: door.hooks }).result;
    releaseDeath!();

    await settleUntil(() => door.tasks.some((o) => o.kind === "runtime.warning"));
    const warning = door.tasks.find((o) => o.kind === "runtime.warning");
    expect(warning?.kind === "runtime.warning" && warning.message).toContain("2 tasks still running");
    // Both rows are closed, so `livenessOf` stops reading the session as busy.
    const closed = door.tasks.filter((o) => o.kind === "task.completed");
    expect(closed.map((o) => (o.kind === "task.completed" ? [o.task.id, o.task.state] : []))).toEqual([
      ["task_toolu_bg", "stopped"],
      ["task_toolu_bg2", "stopped"],
    ]);
  });

  test("a process that dies DURING a turn reports the same loss on the turn itself", async () => {
    const driver = createClaudeDriver(async () => ({
      async *query({ prompt }: { prompt: AsyncIterable<{ uuid?: string }> }) {
        const input = prompt[Symbol.asyncIterator]();
        const first = await input.next();
        yield { type: "stream_event", event: { type: "message_start" }, user_message_uuid: first.value!.uuid! };
        yield { type: "system", subtype: "task_started", task_id: "bg1", tool_use_id: "toolu_bg", description: "watch CI", task_type: "local_bash", is_backgrounded: true };
        // The stream ends mid-turn: no result, and the shell dies with it.
      },
    }) as never);
    const { sink, result } = run(driver, { sessionId: "session_465_death_midturn" });
    // The turn still fails — the process really did go away mid-answer.
    await expect(result).rejects.toThrow();
    const warning = sink.observations.find((o) => o.kind === "runtime.warning");
    expect(warning?.kind === "runtime.warning" && warning.message).toContain("1 task still running");
    const closed = sink.observations.find((o) => o.kind === "task.completed");
    expect(closed?.kind === "task.completed" && closed.task).toMatchObject({ id: "task_toolu_bg", state: "stopped" });
  });
});

test("a steer that cuts a tool call does not wedge the turn — the cut row closes and the next result ends it (#465)", async () => {
  let startedGenerating: (() => void) | undefined;
  const generating = new Promise<void>((resolve) => { startedGenerating = resolve; });
  let releaseGeneration: (() => void) | undefined;
  const cut = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  const heard: unknown[] = [];
  const driver = createClaudeDriver(async () => ({
    query({ prompt }: { prompt: AsyncIterable<{ uuid?: string; message: { content: unknown } }> }) {
      const iterator = prompt[Symbol.asyncIterator]();
      async function* pump() {
        const first = await iterator.next();
        const uuid = first.value!.uuid!;
        heard.push(first.value!.message.content);
        yield { type: "stream_event", event: { type: "message_start" }, user_message_uuid: uuid };
        yield { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_cut", name: "Bash", input: { command: "gh pr checks" } }] } };
        startedGenerating!();
        // The call is in flight when the steer lands. Its `tool_result` never
        // arrives — the interrupt killed the response that would have sent it.
        await cut;
        yield { type: "result", subtype: "interrupted", user_message_uuid: uuid };
        const second = await iterator.next();
        heard.push(second.value!.message.content);
        yield { type: "stream_event", event: { type: "message_start" } };
        yield { type: "assistant", message: { content: [{ type: "text", text: "stopped, here is where I got to" }] } };
        // The shape the measured stall produced: a result that states nothing
        // definite. Against a stale tool set this used to park the pump.
        yield { type: "result", subtype: "success", stop_reason: null };
        await iterator.next();
      }
      return Object.assign(pump(), { interrupt: async () => releaseGeneration!() });
    },
  }) as never);
  const steer = new SteerMailbox();
  const { sink, result } = run(driver, { sessionId: "session_465_cut", steer });
  await generating;
  steer.push("actually, stop");
  // THE ASSERTION IS THAT THIS RESOLVES AT ALL. Before the fix the pump sat on
  // the stale id until a human pressed Stop — here, until the test timed out.
  await expect(result).resolves.toMatchObject({ text: "stopped, here is where I got to" });
  // The steer really was delivered as a second message, not queued behind.
  expect(heard).toEqual(["prompt", "actually, stop"]);
  // And the call the interrupt killed is closed rather than left spinning, with
  // the reason on the row: it really did not finish.
  const closed = sink.observations.find((o) => o.kind === "item.completed" && o.itemId === "item_toolu_cut");
  expect(closed?.kind === "item.completed" && closed.status).toBe("failed");
  expect(JSON.stringify(closed?.kind === "item.completed" ? closed.detail : undefined)).toContain("cut by a steer");
});

const reply = (uuid: string, prose: string) => [
  { type: "stream_event", event: { type: "message_start" }, user_message_uuid: uuid },
  { type: "assistant", message: { content: [{ type: "text", text: prose }] } },
  { type: "result", subtype: "success", stop_reason: "end_turn", user_message_uuid: uuid },
];

type Gate = (name: string, args: Record<string, unknown>, options: { signal: AbortSignal; toolUseID: string }) => Promise<unknown>;

const asChild = (toolUseID: string) => ({ signal: new AbortController().signal, toolUseID });

/** The engine's door, recording every task request and every turn the driver asked it to open. */
const taskDoor = (options: { decide?: () => Promise<"accept" | "decline"> } = {}) => {
  const observed: TurnObservation[] = [];
  const asked: Array<{ taskId: string; request: unknown }> = [];
  const turns: unknown[] = [];
  return {
    observed,
    asked,
    turns,
    hooks: {
      onTasks: async (batch: TurnObservation[]) => void observed.push(...batch),
      onProviderTurn: async (opening: unknown) => {
        turns.push(opening);
        return undefined;
      },
      onTaskRequest: async (taskId: string, request: unknown) => {
        asked.push({ taskId, request });
        return options.decide ? await options.decide() : ("accept" as const);
      },
    },
  };
};

/** A turn that leaves background agents running, then frames `between` the turns. */
const dispatcher = (agents: string[], between: unknown[] = []) => {
  const held: { gate?: Gate; release?: () => void } = {};
  const released = new Promise<void>((resolve) => { held.release = resolve; });
  const driver = createClaudeDriver((async () => ({
    async *query({ prompt, options }: { prompt: AsyncIterable<{ uuid?: string }>; options: { canUseTool?: Gate } }) {
      const input = prompt[Symbol.asyncIterator]();
      const first = await input.next();
      held.gate = options.canUseTool;
      for (const agent of agents) {
        yield { type: "system", subtype: "task_started", task_id: agent, tool_use_id: `toolu_${agent}`, description: agent, task_type: "local_agent", is_backgrounded: true };
      }
      yield* reply(first.value!.uuid!, "dispatched; they will report back");
      if (between.length > 0) await released;
      yield* between as never[];
      await input.next();
    },
  })) as never);
  return { driver, held };
};

describe("background work asks under its task, never under a turn of its own", () => {
  test("a backgrounded agent's tool call after its turn settles is asked under its task and opens no turn", async () => {
    const door = taskDoor();
    const { driver, held } = dispatcher(["ag1"]);
    await expect(run(driver, { sessionId: "session_bg_asked", session: door.hooks, onRequest: async () => "accept" }).result).resolves.toMatchObject({ text: "dispatched; they will report back" });
    await expect(held.gate!("Bash", { command: "rm -rf build" }, asChild("toolu_child"))).resolves.toEqual({ behavior: "allow" });
    expect(door.asked.map((each) => each.taskId)).toEqual(["task_toolu_ag1"]);
    expect(door.turns).toEqual([]);
  });

  test("a decision the human declines reaches the child as the human's, not as plumbing", async () => {
    const door = taskDoor({ decide: async () => "decline" });
    const { driver, held } = dispatcher(["ag1"]);
    await run(driver, { sessionId: "session_bg_declined", session: door.hooks, onRequest: async () => "accept" }).result;
    await expect(held.gate!("Bash", { command: "rm -rf /" }, asChild("toolu_child"))).resolves.toMatchObject({ behavior: "deny", message: "The human declined this tool call." });
  });

  test("with no background work alive, the child is told what happened and nothing is asked", async () => {
    const door = taskDoor();
    const { driver, held } = dispatcher([]);
    await run(driver, { sessionId: "session_bg_none", session: door.hooks, onRequest: async () => "accept" }).result;
    const answer = (await held.gate!("Bash", { command: "ls" }, asChild("toolu_child"))) as { behavior: string; message: string };
    expect(answer).toMatchObject({ behavior: "deny" });
    expect(answer.message).toContain("Nobody declined it");
    expect(door.asked).toEqual([]);
    expect(door.turns).toEqual([]);
  });

  test("with several agents live, the call is asked under the sub-agent that made it", async () => {
    const door = taskDoor();
    const call = { type: "assistant", parent_tool_use_id: "toolu_ag2", message: { content: [{ type: "tool_use", id: "toolu_child", name: "Bash", input: { command: "ls" } }] } };
    const { driver, held } = dispatcher(["ag1", "ag2"], [call]);
    await run(driver, { sessionId: "session_bg_owner", session: door.hooks, onRequest: async () => "accept" }).result;
    held.release!();
    await until("the call to be asked under the sub-agent that made it", async () => {
      door.asked.length = 0;
      await held.gate!("Bash", { command: "ls" }, asChild("toolu_child"));
      return door.asked[0]?.taskId === "task_toolu_ag2";
    });
    expect(door.asked.map((each) => each.taskId)).toEqual(["task_toolu_ag2"]);
  });
});
