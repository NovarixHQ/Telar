import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { OWN_GROUP, stopGroup } from "../../platform/process/group";

type Message = { id?: string | number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };

type AcpIncomingRequest = { method: string; params: Record<string, unknown> };
type RequestHandler = (request: AcpIncomingRequest) => Promise<unknown>;
type NotificationHandler = (method: string, params: Record<string, unknown>) => void;

export class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "AcpRpcError";
  }
}

const METHOD_NOT_FOUND = -32601;
const STDERR_TAIL = 4000;

export class AcpConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private partial = "";
  private stderr = "";
  private readonly record: ((direction: "in" | "out", line: string) => void) | undefined;
  closed = false;
  onRequest: RequestHandler = async () => {
    throw new AcpRpcError(METHOD_NOT_FOUND, "not supported");
  };
  onNotification: NotificationHandler = () => {};
  onClose: (error: Error) => void = () => {};

  constructor(command: string, args: readonly string[], options: { cwd?: string | undefined; env: Record<string, string | undefined>; recordDir?: string | undefined }) {
    this.record = options.recordDir ? recorder(options.recordDir) : undefined;
    this.child = spawn(command, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: Object.fromEntries(Object.entries(options.env).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: OWN_GROUP,
    });
    this.child.on("error", (error) => this.close(error));
    this.child.on("exit", (code, signal) => this.close(new Error(`the agent exited (${signal ?? `code ${code}`})${this.stderrTail()}`)));
    this.child.stdin.on("error", () => undefined);
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      const lines = (this.partial + chunk).split("\n");
      this.partial = lines.pop()!;
      for (const line of lines) if (line.trim()) this.consume(line);
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL);
    });
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("the agent is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) this.write({ jsonrpc: "2.0", method, params });
  }

  kill(): void {
    stopGroup(this.child);
    this.close(new Error("the agent was stopped"));
  }

  private stderrTail(): string {
    const tail = this.stderr.trim();
    return tail ? `: ${tail.split("\n").slice(-3).join(" ")}` : "";
  }

  private write(message: Record<string, unknown>): void {
    const line = JSON.stringify(message);
    this.record?.("out", line);
    this.child.stdin.write(`${line}\n`);
  }

  private consume(line: string): void {
    this.record?.("in", line);
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return;
    }
    if (message.method !== undefined && message.id !== undefined) return void this.answer(message.id, message.method, message.params);
    if (message.method !== undefined) return this.onNotification(message.method, asParams(message.params));
    if (message.id === undefined) return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error) waiter.reject(new AcpRpcError(message.error.code, message.error.message));
    else waiter.resolve(message.result ?? null);
  }

  private async answer(id: string | number, method: string, params: unknown): Promise<void> {
    try {
      this.write({ jsonrpc: "2.0", id, result: (await this.onRequest({ method, params: asParams(params) })) ?? null });
    } catch (error) {
      const code = error instanceof AcpRpcError ? error.code : -32603;
      this.write({ jsonrpc: "2.0", id, error: { code, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  private close(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    this.onClose(error);
  }
}

const asParams = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// TELAR_ACP_RECORD=<dir> keeps every line both ways, so a run against a real agent can become a replay test.
function recorder(dir: string): (direction: "in" | "out", line: string) => void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `acp-${Date.now()}-${process.pid}.ndjson`);
  return (direction, line) => fs.appendFileSync(file, `${JSON.stringify({ direction, line: JSON.parse(line) as unknown })}\n`);
}
