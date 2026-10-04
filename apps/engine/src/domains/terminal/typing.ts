import { type ShellMarker, typedCommand } from "./shell";
import type { LiveRun } from "./live-run";
import { isTerminal } from "./types";

export type TypingHost = {
  now(): number;
  pty(): boolean;
  promptWaitMs(): number;
  announce(run: LiveRun): void;
  pollReadiness(run: LiveRun): void;
};

export function typeCommand(host: TypingHost, run: LiveRun, command: string, options: { armed?: boolean } = {}): void {
  run.command = command;
  run.activity = "busy";
  run.typed = false;
  if (!options.armed) {
    run.warning = undefined;
    if (run.status === "ready") run.status = "running";
    run.readiness = run.config.readinessUrl || run.readyPattern ? { kind: "pending" } : { kind: "none" };
    if (run.readiness.kind === "pending" && run.config.readinessUrl) host.pollReadiness(run);
  }
  if (run.prompted || !run.shell.integrated) {
    send(host, run, command);
  } else {
    run.queued = command;
    clearTimeout(run.promptTimer);
    run.promptTimer = setTimeout(() => {
      if (run.queued === undefined || isTerminal(run.status)) return;
      run.shell = { ...run.shell, integrated: false };
      flushQueued(host, run);
    }, host.promptWaitMs());
    run.promptTimer.unref?.();
  }
  host.announce(run);
}

function flushQueued(host: TypingHost, run: LiveRun): void {
  clearTimeout(run.promptTimer);
  const command = run.queued;
  run.queued = undefined;
  if (command !== undefined) send(host, run, command);
}

function send(host: TypingHost, run: LiveRun, command: string): void {
  run.typed = true;
  void run.handle?.write?.(typedCommand(command, run.shell, host.pty())).catch(() => false);
}

export function onMarker(host: TypingHost, run: LiveRun, marker: ShellMarker): void {
  if (marker.kind === "prompt") {
    run.prompted = true;
    if (run.queued !== undefined) flushQueued(host, run);
    return;
  }
  if (marker.kind === "busy") {
    if (run.activity === "busy") return;
    run.activity = "busy";
    run.typed = true;
    host.announce(run);
    return;
  }
  if (run.activity !== "busy" || !run.typed) return;
  run.activity = "idle";
  run.lastExit = { ...(marker.exitCode === undefined ? {} : { exitCode: marker.exitCode }), at: host.now() };
  if (run.readyTimer) clearInterval(run.readyTimer);
  if (run.readiness.kind !== "none") run.readiness = { kind: "none" };
  if (run.status === "ready") run.status = "running";
  wakeIdle(run);
  host.announce(run);
}

export function wakeIdle(run: LiveRun): void {
  const waiters = run.idleWaiters;
  run.idleWaiters = [];
  for (const waiter of waiters) waiter();
}

export function untilIdle(run: LiveRun, ms: number): Promise<boolean> {
  if (run.activity === "idle" || isTerminal(run.status)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      run.idleWaiters = run.idleWaiters.filter((waiter) => waiter !== onIdle);
      resolve(run.activity === "idle");
    }, ms);
    timer.unref?.();
    const onIdle = () => {
      clearTimeout(timer);
      resolve(true);
    };
    run.idleWaiters.push(onIdle);
  });
}
