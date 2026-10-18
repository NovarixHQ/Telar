import { PtyHost, type TerminalEnding } from "../src/domains/terminal/pty-host";
import { nodePtySpawner } from "../src/domains/terminal/node-pty";

const host = new PtyHost({ spawnPty: nodePtySpawner(), version: "probe", closeGraceMs: 500 });

type Shell = { id: string; output: () => string; ended: Promise<TerminalEnding>; waitFor: (text: string) => Promise<void> };

async function shell(script: string, options: { cols?: number; rows?: number; cwd?: string } = {}): Promise<Shell> {
  let output = "";
  const waiting: Array<{ text: string; resolve: () => void }> = [];
  let resolveEnded!: (ending: TerminalEnding) => void;
  const ended = new Promise<TerminalEnding>((resolve) => (resolveEnded = resolve));
  const opened = await host.open(
    { shell: "/bin/sh", args: ["-c", script], ...options },
    {
      data(chunk) {
        output += chunk;
        for (const wait of waiting.splice(0)) {
          if (output.includes(wait.text)) wait.resolve();
          else waiting.push(wait);
        }
      },
      ending: resolveEnded,
    },
  );
  if (opened.ending) resolveEnded(opened.ending);
  return {
    id: opened.id,
    output: () => output,
    ended,
    waitFor: (text) => (output.includes(text) ? Promise.resolve() : new Promise((resolve) => waiting.push({ text, resolve }))),
  };
}

function within<T>(label: string, promise: Promise<T>, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const cases: Array<[string, () => Promise<void>]> = [
  [
    "a shell's output, input and exit status cross the pty",
    async () => {
      const one = await shell('printf ready; read line; printf "got-$line"; exit 7');
      await within("ready", one.waitFor("ready"));
      host.write(one.id, "hi\n");
      const ending = await within("exit", one.ended);
      if (!one.output().includes("got-hi") || ending.exitCode !== 7) throw new Error(`output ${JSON.stringify(one.output())}, ending ${JSON.stringify(ending)}`);
    },
  ],
  [
    "the child sees a tty and Telar's terminal environment",
    async () => {
      const one = await shell('[ -t 1 ] && printf "tty:$TERM:$TERM_PROGRAM:$TERM_PROGRAM_VERSION"');
      await within("env", one.ended);
      if (!one.output().includes("tty:xterm-256color:Telar:probe")) throw new Error(JSON.stringify(one.output()));
    },
  ],
  [
    "a resize reaches the child",
    async () => {
      const one = await shell("printf ready; read line; stty size", { cols: 80, rows: 24 });
      await within("ready", one.waitFor("ready"));
      host.resize(one.id, 120, 40);
      host.write(one.id, "\n");
      await within("exit", one.ended);
      if (!one.output().includes("40 120")) throw new Error(JSON.stringify(one.output()));
    },
  ],
  [
    "close ends a running command and says it was closed",
    async () => {
      const one = await shell("printf ready; sleep 60");
      await within("ready", one.waitFor("ready"));
      await within("close", host.close(one.id));
      const ending = await within("exit", one.ended);
      if (ending.closed !== "close") throw new Error(JSON.stringify(ending));
    },
  ],
  [
    "activity names the foreground command",
    async () => {
      const one = await shell("printf ready; sleep 60");
      await within("ready", one.waitFor("ready"));
      const [activity] = await host.active([one.id]);
      await host.close(one.id);
      if (!activity?.active || !activity.command?.includes("sleep")) throw new Error(JSON.stringify(activity));
    },
  ],
  [
    "a missing directory fails the terminal without a process",
    async () => {
      const one = await shell("true", { cwd: "/nonexistent-telar-probe" });
      const ending = await within("ending", one.ended);
      if (ending.fate !== "failed") throw new Error(JSON.stringify(ending));
    },
  ],
];

let passed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
await host.dispose();
console.log(`${process.versions.bun ? "bun" : "node"} ${process.platform}-${process.arch}`);
if (passed === cases.length) console.log(`PTY_HOST_OK ${passed}/${cases.length}`);
process.exit(passed === cases.length ? 0 : 1);
