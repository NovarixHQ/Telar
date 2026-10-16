# Engine: traps and constraints

## Storage

- SQLite (the execution store) is the only journal backend. Old homes with JSON journals are imported once on open, and that importer stays.
- Writes go through `command(name, fn)`. Commands are re-entrant. Session rows are flushed only when the outermost command ends, and `afterCommit` callbacks run once, in order. Don't await inside a command: SQLite commands are synchronous. That is why `createSessionAsync`/`submitTurnAsync` prefetch git first and then run the synchronous command.
- Every in-memory cache has exactly one writer. Keep a cache in the module that writes it, or it goes stale.
- The hot paths are `appendEvent` (called once per streamed chunk), `writeQueue` and the heartbeat reads. Measure with the `bench:*` scripts before and after touching them.

## Turns

- A turn is accepted, then queued, claimed, running, and finally completed, failed or stopped. A claimed turn requeues after a restart instead of vanishing.
- Sequence numbers do not mean run order. `openProviderTurn` can open a turn from a background task while a lower-sequence turn is still queued. The cockpit therefore orders the transcript by `startedAt`, and puts turns that haven't started last.
- A message sent while a turn is running is **steered** into it and renders inside that turn.
- A turn ending fires, in this order: subscriptions, then held notifications, then delegation settling. Keep that order.

## Sessions talking to sessions

- `sessions_send` carries an intent (`task`, `fyi`, `result`, `blocker`). With no intent, a send to a session the sender tasked is a `task`; anything else is an `fyi`. An `fyi` never opens a turn. Blockers and parked requests interrupt, a busy parent included.
- A `task` makes the recipient a child node of the lineage (`domains/sessions/lineage.ts`: parent, root, generation; `GET /v2/sessions/:id/children`). Its turns and tasks are the nodes below it and stay in their own stores; sub-agents nest through `Task.parentTaskId`, and one reported between turns with no known parent is filed under the session's first turn, flagged `orphan`, never under a guessed latest turn.
- A child is live while any node below it is (`liveness.ts`: a live turn or task, a working builder, a schedule, an awaited subscription, held mail, an open delivery). Liveness is recomputed in a `beforeCommit` hook for every session whose turn or task rows changed, at boot after recovery and by the 30 s sweep. Never derive it only when a turn ends: a process death, the boot sweep and a Stop end work without a turn ending, and that is how builders used to stay "working" for good. A turn cut off by a lost worker stays live for two minutes, so a planned restart can continue it. The lineage's hook is registered before the session index's, so the rows it writes are flushed.
- A child ends once: on its `result`, when it is put away, or when nothing below it is live. Then its last turn decides: failed or stopped end it so; a stop of its background work ends it `stopped`; otherwise it is nudged once and, idle again without a result, ends `done` with "will not continue". The nudge is only this safety net.
- Each ending is one row of the delivery outbox (`deliveries.json`, keyed by parent, child and generation), written in the transaction that ends the child: pending, claimed by a wake turn on the parent, delivered once that turn reaches a model, acknowledged when the parent reads the run itself. Siblings that end while the parent works go out as one wake when its turn ends, or join the wake already queued. A claim whose turn never ran goes back to pending, so a restart re-delivers exactly once. A subscription never wakes a parent about its builder's run; the result message itself stays passive.
- A permission prompt from background work between turns is a request owned by its task (`RequestGate.openForTask`), answered on the worker heartbeat and cancelled when the task ends. It never opens a turn.
- A child waiting on its blocker refuses an `fyi`: only a `task` reopens it.
- Planned: `create` takes a mode, `child` or `handoff`, and the intents go away.

## HTTP

- Routes are matched literal paths first, then patterns in declared order. `/v2/sessions/mcp`, `/live`, `/find` and `/activity` must beat the `sessions/:id` pattern.
- Streaming routes (`/sessions/stream`, `/run/stream`) own the raw response.
- Every interval started in `startEngine` must be cleared by `stopTimers()`, on close and on the error path.

## Agent tools

- `telarWall(caps)` is the single list of tools every provider gets. Claude receives them in-process through `toSdkTools`; Codex and OpenCode receive them over the per-run socket. Never register a toolkit anywhere else; the copies drift.
- Tool names are `mcp__telar__<prefix>_*`. Approvals and the read-only policy key on those names, so renaming a tool changes what gets approved.
