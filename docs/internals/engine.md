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
- A `task` files the recipient as a child node of the lineage (`domains/sessions/lineage.ts`, `GET /v2/sessions/:id/children`). A child ends once: on its `result`, when it is put away, or when nothing below it is live any more (`liveness.ts`: no live turn, task, builder, schedule, awaited subscription or held mail). Liveness is recomputed before every commit that writes one of its turns or tasks, and by the 30 s sweep, never only when a turn ends; a process death, the boot sweep and a Stop end it like a turn does. The parent is told in one line that names the `sessions_read` call; the result message itself stays passive. Each ending is one row of the delivery outbox (`deliveries.json`, keyed by parent, child and generation), written in the same transaction: pending, claimed by the parent's wake turn, delivered once that turn reaches a model, or acknowledged when the parent reads the run itself. Endings pending while the parent works go out as one wake when its turn ends; a claim whose turn never ran goes back to pending. A subscription never wakes a parent about its builder's run: the delivery is the only channel. A child waiting on its blocker refuses an `fyi`: only a `task` reopens it.
- Planned: `create` takes a mode, `child` or `handoff`, and the intents go away.

## HTTP

- Routes are matched literal paths first, then patterns in declared order. `/v2/sessions/mcp`, `/live`, `/find` and `/activity` must beat the `sessions/:id` pattern.
- Streaming routes (`/sessions/stream`, `/run/stream`) own the raw response.
- Every interval started in `startEngine` must be cleared by `stopTimers()`, on close and on the error path.

## Agent tools

- `telarWall(caps)` is the single list of tools every provider gets. Claude receives them in-process through `toSdkTools`; Codex and OpenCode receive them over the per-run socket. Never register a toolkit anywhere else; the copies drift.
- Tool names are `mcp__telar__<prefix>_*`. Approvals and the read-only policy key on those names, so renaming a tool changes what gets approved.
