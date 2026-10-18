import { execFile } from "node:child_process";

export type ProcessRow = { pid: number; ppid: number; pgid: number; tpgid: number; tty: string; command: string };

export type TerminalProcesses = { active: boolean; processes: number; command?: string; groups: number[] };

export function readProcessTable(): Promise<ProcessRow[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-A", "-ww", "-o", "pid=,ppid=,pgid=,tpgid=,tty=,command="],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => (error ? reject(error) : resolve(parseProcessTable(stdout))),
    );
  });
}

export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s?(.*)$/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), tpgid: Number(match[4]), tty: match[5]!, command: match[6]!.trim() });
  }
  return rows;
}

function ttyName(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/^\/dev\//, "").trim();
  return name && !/^\?+$/.test(name) ? name : undefined;
}

export function terminalProcesses(terminal: { pid: number; tty?: string }, rows: ProcessRow[]): TerminalProcesses {
  const tty = ttyName(terminal.tty);
  const shell = rows.find((row) => row.pid === terminal.pid);
  const members = rows.filter(
    (row) => row.pid !== terminal.pid && (row.ppid === terminal.pid || row.pgid === terminal.pid || (tty !== undefined && ttyName(row.tty) === tty)),
  );
  const foreground = shell && shell.tpgid > 1 && shell.tpgid !== terminal.pid ? shell.tpgid : undefined;
  const lead =
    (foreground !== undefined && (members.find((row) => row.pid === foreground) ?? members.find((row) => row.pgid === foreground))) || members[0];
  const groups = [...new Set([terminal.pid, ...members.map((row) => row.pgid)])].filter((group) => Number.isInteger(group) && group > 1);
  return { active: foreground !== undefined || members.length > 0, processes: members.length, command: lead?.command, groups };
}
