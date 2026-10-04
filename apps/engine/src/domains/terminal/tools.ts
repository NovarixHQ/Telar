import { RunIcon, RunShell, type RunStopSignal, type RunView, type RunWaitAnswer } from "@telar/engine-client";
import { z } from "zod";
import { err, failure, json, ok, type ToolFactory } from "../agent-tools";
import type { RunCapability, RunTarget } from "./capability";

function closedPhrase(run: RunView): string | undefined {
  if (run.status !== "closed") return undefined;
  const code = run.exitCode ?? run.signal;
  const exit = code === undefined ? "" : ` (exit ${code})`;
  if (run.closedBy === "person") return `Closed by the person${exit}. Do not reopen it unless they ask.`;
  if (run.closedBy === "telar") return `Closed by Telar${exit}.`;
  return `Closed by you${exit}.`;
}

function describe(run: RunView): string {
  const where = run.worktreeBranch ? `${run.worktreePath} (${run.worktreeBranch})` : run.worktreePath;
  const readiness =
    run.readiness.kind === "ready"
      ? ` — ${run.readinessUrl ?? "its ready pattern"} ${run.readinessUrl ? "is answering" : "was printed"}`
      : run.readiness.kind === "pending"
        ? ` — waiting for ${run.readinessUrl ?? "its ready pattern"}`
        : run.readiness.kind === "unattributable"
          ? ` — readiness cannot be attributed to this process (${run.readiness.reason})`
          : "";
  const closed = closedPhrase(run);
  const ended = closed ? ` ${closed}` : run.endedAt ? ` The shell ended, exit ${run.exitCode ?? run.signal ?? "?"}.` : "";
  const last = run.lastExit ? `; the last command exited ${run.lastExit.exitCode ?? "with an unknown code"}` : "";
  const activity = run.endedAt ? "" : run.activity === "busy" ? ` Busy with "${run.command}".` : ` Idle at the prompt${last}.`;
  const warning = run.warning ? ` Warning: ${run.warning}.` : "";
  return `"${run.title}" (terminal ${run.terminalId}) from ${where}, cwd ${run.cwd}.${activity}${readiness}${ended}${warning}${run.error ? ` ${run.error}` : ""}`;
}

const lineText = (lines: { stream: string; text: string }[]) => lines.map((line) => (line.stream === "stderr" ? `! ${line.text}` : line.text)).join("\n");

const SIGNAL = z
  .enum(["SIGTERM", "SIGINT", "SIGKILL"])
  .optional()
  .describe("Sent first, e.g. SIGINT; the close follows regardless.");

const signalOf = (value: unknown): RunStopSignal | undefined => (value === "SIGTERM" || value === "SIGINT" || value === "SIGKILL" ? value : undefined);

function runToolsContext(tool: ToolFactory, capability: RunCapability) {
  const personClosed = async (terminalId: string | undefined): Promise<string | undefined> => {
    if (!terminalId) return undefined;
    try {
      const run = (await capability.status()).terminals.find((entry) => entry.terminalId === terminalId);
      return run?.status === "closed" && run.closedBy === "person" ? closedPhrase(run) : undefined;
    } catch {
      return undefined;
    }
  };
  const idOf = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
  const target = (terminalId: string | undefined): RunTarget => (terminalId ? { terminalId } : {});
  const list = async () => {
    try {
      const status = await capability.status();
      const terminals = status.terminals.filter((run) => !run.endedAt || run.closedBy === "person");
      const ended = status.terminals.length - terminals.length;
      const where = status.sessionWorktreePath ? `\nThis session's worktree: ${status.sessionWorktreePath}` : "";
      const more = ended ? `\n${ended} ended terminal(s) not listed; terminal_output still reads them.` : "";
      if (!terminals.length) return ok(`This session has no open terminals.${more}${where}`);
      return ok(`${terminals.map((run) => `- ${describe(run)}`).join("\n")}${more}${where}`);
    } catch (error) {
      return err(`Could not list the terminals: ${failure(error)}`);
    }
  };
  const opened = (run: RunView, lead = "", hint = "") =>
    ok(`${lead}Typed into ${describe(run)}\nterminalId: ${run.terminalId}. Read it with terminal_output; wait for it with terminal_wait; run the next command here with terminal_run.${hint}`);
  const idleTerminals = async (): Promise<RunView[]> => {
    try {
      return (await capability.status()).terminals.filter((run) => !run.endedAt && run.activity === "idle");
    } catch {
      return [];
    }
  };
  const openFromConfig = async (configId: string) => {
    try {
      return opened(await capability.start({ configId, openedBy: "agent" }));
    } catch (error) {
      return err(`Did not open: ${failure(error)}`);
    }
  };
  const kill = async (terminalId: string | undefined, signal: unknown) => {
    const first = signalOf(signal);
    try {
      const run = await capability.stop({ ...target(terminalId), ...(first ? { signal: first } : {}), closedBy: "agent" });
      return ok(`Closed ${describe(run)}`);
    } catch (error) {
      return err(`Did not close: ${failure(error)}`);
    }
  };
  const output = async (terminalId: string | undefined, args: Record<string, unknown>) => {
    try {
      const result = await capability.output({
        ...target(terminalId),
        ...(typeof args.after === "number" ? { after: args.after } : {}),
        ...(typeof args.tail === "number" ? { tail: args.tail } : {}),
        ...(typeof args.grep === "string" ? { grep: args.grep } : {}),
        ...(args.stream === "stdout" || args.stream === "stderr" ? { stream: args.stream } : {}),
      });
      const body = lineText(result.lines);
      const dropped = result.dropped ? `[${result.dropped} earlier line(s) dropped]\n` : "";
      const narrowed = args.tail !== undefined || args.grep !== undefined || args.stream !== undefined;
      const empty = narrowed ? "(no line in this window matched)" : "(no output yet)";
      const closed = await personClosed(terminalId);
      return ok(`${closed ? `${closed}\n` : ""}${dropped}${body || empty}\n[cursor ${result.cursor}]`);
    } catch (error) {
      return err(`Could not read the output: ${failure(error)}`);
    }
  };
  const wait = async (terminalId: string | undefined, args: Record<string, unknown>) => {
    if (args.pattern === undefined && args.ready !== true && args.exit !== true) {
      return err("Give something to wait FOR: pattern, ready or exit. Waiting for nothing is a sleep, which is what this tool replaces.");
    }
    let result: RunWaitAnswer;
    try {
      result = await capability.wait({
        ...target(terminalId),
        ...(typeof args.pattern === "string" ? { pattern: args.pattern } : {}),
        ...(args.ready === true ? { ready: true } : {}),
        ...(args.exit === true ? { exit: true } : {}),
        timeoutMs: Number(args.timeoutMs),
      });
    } catch (error) {
      return err(`Could not wait on that terminal: ${failure(error)}`);
    }
    const closed = result.fired === "exit" ? await personClosed(terminalId) : undefined;
    const ended = `ENDED — the terminal itself closed${result.exitCode === undefined ? "" : ` (exit ${result.exitCode})`}; terminal_list says how.`;
    const verdicts: Record<RunWaitAnswer["fired"], string> = {
      timeout: "TIMED OUT — the condition did not happen in the time given. It may still be starting; do not assume it is up.",
      ready: "READY — it reported ready.",
      finished: `FINISHED — the command exited ${result.exitCode ?? "with an unknown code"}. The shell is still open: run the next command in it with terminal_run.`,
      exit: closed ? `ENDED — ${closed}` : ended,
      pattern: "MATCHED — a line matched your pattern.",
    };
    return ok(`${verdicts[result.fired]}\n${lineText(result.lines) || "(nothing was printed while waiting)"}\n[cursor ${result.cursor}]`);
  };
  const OUTPUT_SHAPE = {
    after: z.number().int().min(0).optional().describe("Cursor from an earlier call."),
    tail: z.number().int().min(1).max(1000).optional().describe("Only the last N lines."),
    grep: z.string().min(1).max(500).optional().describe("Regex; only matching lines."),
    stream: z.enum(["stdout", "stderr"]).optional().describe("One stream only."),
  };
  const WAIT_SHAPE = {
    pattern: z.string().min(1).max(500).optional().describe("Regex over new lines, e.g. 'Listening on'."),
    ready: z.boolean().optional().describe("Wait for its ready URL or pattern."),
    exit: z.boolean().optional().describe("Wait for the command to finish; answers its exit code."),
    timeoutMs: z.number().int().min(0).max(60_000).describe("At most 60000."),
  };
  const ready = (value: unknown) => {
    if (typeof value !== "string") return {};
    return /^https?:\/\//i.test(value) ? { readinessUrl: value } : { readyPattern: value };
  };
  const READY = z.string().min(1).max(500).optional().describe("A URL that answers, or a regex printed, once it is up.");
  return { idOf, list, opened, idleTerminals, openFromConfig, kill, output, wait, ready, READY, OUTPUT_SHAPE, WAIT_SHAPE };
}

export function runTools(tool: ToolFactory, capability: RunCapability): unknown[] {
  const h = runToolsContext(tool, capability);
  return [
    ...terminalTools(tool, capability, h),
    ...configTools(tool, capability),
  ];
}

function terminalTools(tool: ToolFactory, capability: RunCapability, h: ReturnType<typeof runToolsContext>): unknown[] {
  const { idOf, list, opened, idleTerminals, openFromConfig, kill, output, wait, ready, READY, OUTPUT_SHAPE, WAIT_SHAPE } = h;
  return [
    tool(
      "terminal_open",
      "Run a command (or a saved configId) in a shell in the panel; the shell stays open after it ends. Types into your idle terminal in the same directory if there is one, else opens a new one; fresh: true always opens one. Never use '&' or a background shell for something long-running.",
      {
        command: z.string().min(1).max(4000).optional().describe("e.g. 'bun run dev'."),
        cwd: z.string().max(1024).optional().describe("Relative to the worktree."),
        name: z.string().min(1).max(120).optional().describe("Tab title."),
        ready: READY,
        configId: z.string().min(1).optional().describe("A saved run configuration."),
        fresh: z.boolean().optional().describe("Open a new terminal even if an idle one could take it."),
      },
      async (args) => {
        const configId = idOf(args.configId);
        const command = typeof args.command === "string" ? args.command : undefined;
        if (configId && command) return err("Give a command or a configId, not both.");
        if (configId) return await openFromConfig(configId);
        if (!command) return err("terminal_open needs a command, or the configId of a saved run configuration.");
        try {
          const idleBefore = await idleTerminals();
          const run = await capability.open({
            command,
            ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
            ...(typeof args.name === "string" ? { name: args.name } : {}),
            ...(args.fresh === true ? { fresh: true } : {}),
            ...ready(args.ready),
          });
          if (idleBefore.some((idle) => idle.terminalId === run.terminalId)) return opened(run, "Reused your idle terminal instead of opening another. ");
          const others = idleBefore.filter((idle) => idle.terminalId !== run.terminalId);
          const hint = others.length
            ? `\nYou also have idle terminal${others.length > 1 ? "s" : ""} ${others.map((idle) => `${idle.terminalId} ("${idle.title}")`).join(", ")}: use terminal_run there, or terminal_kill what you no longer need.`
            : "";
          return opened(run, "", hint);
        } catch (error) {
          return err(`Did not open: ${failure(error)}`);
        }
      },
    ),

    tool(
      "terminal_run",
      "Type a command into one of this session's idle terminals; its shell keeps its directory and environment. Prefer this to opening another terminal.",
      {
        terminalId: z.string().min(1).describe("An idle terminal from terminal_list."),
        command: z.string().min(1).max(4000).describe("e.g. 'bun test'."),
        ready: READY,
      },
      async (args) => {
        const terminalId = idOf(args.terminalId);
        if (!terminalId || typeof args.command !== "string") return err("terminal_run needs a terminalId and a command.");
        try {
          return opened(await capability.command({ terminalId, command: args.command, ...ready(args.ready) }));
        } catch (error) {
          return err(`Did not run: ${failure(error)}`);
        }
      },
    ),

    tool(
      "terminal_list",
      "This session's terminals, newest first: idle at the prompt or busy with a command, and who closed each. Don't reopen one the person closed unless they ask.",
      {},
      async () => await list(),
    ),

    tool(
      "terminal_output",
      "What a terminal printed, even after it ended. Pass the last cursor to read only new lines; tail, grep and stream narrow without moving it.",
      { terminalId: z.string().min(1).describe("From terminal_open or terminal_list."), ...OUTPUT_SHAPE },
      async (args) => await output(idOf(args.terminalId), args),
    ),

    tool(
      "terminal_wait",
      "Wait until a terminal prints a pattern, is ready, or its command finishes (with the exit code); never sleep instead. Says which fired or that it timed out.",
      { terminalId: z.string().min(1).describe("From terminal_open or terminal_list."), ...WAIT_SHAPE },
      async (args) => await wait(idOf(args.terminalId), args),
    ),

    tool(
      "terminal_kill",
      "Close a terminal, its shell and everything running in it. The only way to stop one: never pkill, killall or kill.",
      { terminalId: z.string().min(1).describe("From terminal_open or terminal_list."), signal: SIGNAL },
      async (args) => await kill(idOf(args.terminalId), args.signal),
    ),
  ];
}

function configTools(tool: ToolFactory, capability: RunCapability): unknown[] {
  const forget = async (configId: unknown) => {
    if (typeof configId !== "string" || !configId) return err("delete needs the configId to forget.");
    try {
      await capability.removeConfiguration(configId);
      return ok("Removed that run configuration.");
    } catch (error) {
      return err(`Could not remove that run configuration: ${failure(error)}`);
    }
  };
  return [
    tool(
      "run_configs",
      "The project's saved run configurations (secrets hidden). Open one with terminal_open({configId}).",
      {},
      async () => {
        try {
          const configs = await capability.configurations();
          if (!configs.length) return ok("This project has no saved run configurations yet. Create one with run_save_config.");
          return json(configs);
        } catch (error) {
          return err(`Could not read the run configurations: ${failure(error)}`);
        }
      },
    ),

    tool(
      "run_save_config",
      "Create or edit (configId) a run configuration in the project's Run menu; an empty menu is yours to fill.",
      {
        configId: z.string().min(1).optional().describe("Edit this one."),
        delete: z.boolean().optional().describe("Forget configId; its open terminals keep running."),
        name: z.string().min(1).max(120).optional().describe("Menu label, e.g. 'web dev'."),
        icon: RunIcon.optional().describe("Default 'play'."),
        command: z.string().min(1).optional().describe("e.g. 'bun run dev'."),
        shell: RunShell.strict().optional().describe("Only if it needs a specific shell, e.g. {program:'/bin/bash'}."),
        cwd: z.string().optional().describe("Relative to the worktree root."),
        env: z
          .array(z.strictObject({ key: z.string().min(1), value: z.string(), secret: z.boolean().optional() }))
          .optional()
          .describe("Mark secret values secret."),
        readinessUrl: z.string().url().optional().describe("Only if the command serves it."),
      },
      async (args) => {
        if (args.delete === true) return await forget(args.configId);
        const patch = {
          ...(typeof args.name === "string" ? { name: args.name } : {}),
          ...(RunIcon.safeParse(args.icon).success ? { icon: args.icon as RunIcon } : {}),
          ...(typeof args.command === "string" ? { command: args.command } : {}),
          ...(RunShell.safeParse(args.shell).success ? { shell: RunShell.parse(args.shell) } : {}),
          ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
          ...(Array.isArray(args.env) ? { env: args.env as { key: string; value: string; secret?: boolean }[] } : {}),
          ...(typeof args.readinessUrl === "string" ? { readinessUrl: args.readinessUrl } : {}),
        };
        try {
          if (typeof args.configId === "string") {
            const updated = await capability.updateConfiguration(args.configId, patch);
            return ok(`Updated "${updated.name}" (${updated.id}): ${updated.command}`);
          }
          if (!patch.name || !patch.command) return err("A new run configuration needs at least a name and a command.");
          const created = await capability.createConfiguration({ name: patch.name, command: patch.command, ...patch });
          return ok(`Saved "${created.name}" (${created.id}): ${created.command}${created.cwd ? ` in ${created.cwd}` : ""}.`);
        } catch (error) {
          return err(`Could not save that run configuration: ${failure(error)}`);
        }
      },
    ),
  ];
}
