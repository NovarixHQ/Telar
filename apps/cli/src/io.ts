export type Io = { out(line: string): void; err(line: string): void };

export const processIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export class UsageError extends Error {}
