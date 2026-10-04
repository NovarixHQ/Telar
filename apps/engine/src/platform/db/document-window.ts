export type DocumentIndex = {
  version: number;
  length: number;
  rows: Array<{ key: string; tag?: string; start: number; end: number }>;
};

export function parseSpan(bytes: Buffer): unknown[] {
  return JSON.parse(`[${bytes.toString("utf8")}]`) as unknown[];
}
