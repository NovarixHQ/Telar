import path from "node:path";
import type { WorkspaceFile } from "@telar/engine-client";
import type { DsCapability } from "./capability";

export type TableWindow = {
  path: string;
  columns: string[];
  dtypes?: string[];
  total: number;
  offset: number;
  rows: unknown[][];
  truncated?: boolean;
};

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function inferTypes(rows: string[][], width: number): string[] {
  const types: string[] = [];
  for (let c = 0; c < width; c++) {
    let numeric = true;
    let boolean = true;
    let seen = 0;
    for (const row of rows.slice(0, 200)) {
      const v = row[c];
      if (v === undefined || v === "") continue;
      seen++;
      if (!NUMERIC.test(v)) numeric = false;
      if (!/^(true|false)$/i.test(v)) boolean = false;
      if (!numeric && !boolean) break;
    }
    types.push(seen === 0 ? "string" : numeric ? "number" : boolean ? "boolean" : "string");
  }
  return types;
}

export function windowCsv(text: string, delimiter: string, options: { offset: number; limit: number; sort?: string; desc?: boolean }): Omit<TableWindow, "path"> {
  const all = parseDelimited(text, delimiter);
  const header = all[0] ?? [];
  const body = all.slice(1);
  const dtypes = inferTypes(body, header.length);
  let rows: unknown[][] = body.map((row) => row.map((v, c) => (dtypes[c] === "number" && v !== "" ? Number(v) : v)));
  if (options.sort) {
    const c = header.indexOf(options.sort);
    if (c >= 0) {
      const dir = options.desc ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const x = a[c] as string | number;
        const y = b[c] as string | number;
        if (x === y) return 0;
        if (x === "" || x === undefined) return 1;
        if (y === "" || y === undefined) return -1;
        return (x < y ? -1 : 1) * dir;
      });
    }
  }
  return { columns: header, dtypes, total: rows.length, offset: options.offset, rows: rows.slice(options.offset, options.offset + options.limit) };
}

type WindowOptions = { offset: number; limit: number; sort?: string; desc?: boolean };

/** A window of rows from a CSV or TSV in the session's tree, or a Parquet file read through its kernel. */
export async function tableWindow(cwd: string, target: string, options: WindowOptions, io: { read(target: string): WorkspaceFile; execute: DsCapability["execute"] }): Promise<TableWindow> {
  if (/\.parquet$/i.test(target)) return { path: target, ...(await parquetWindow(io.execute, path.resolve(cwd, target), options)) };
  const file = io.read(target);
  if (file.binary) throw new Error("that file is not text");
  return { path: target, ...windowCsv(file.text, /\.tsv$/i.test(target) ? "\t" : ",", options), ...(file.truncated ? { truncated: true } : {}) };
}

async function parquetWindow(execute: DsCapability["execute"], file: string, options: WindowOptions): Promise<Omit<TableWindow, "path">> {
  const sort = options.sort ? `.sort_values(${JSON.stringify(options.sort)}, ascending=${options.desc ? "False" : "True"})` : "";
  const code = `import pandas as _pd, json as _j\n_df = _pd.read_parquet(${JSON.stringify(file)})${sort}\n_w = _df.iloc[${options.offset}:${options.offset + options.limit}]\nprint("__TELAR_TABLE__" + _j.dumps({"columns": list(map(str, _df.columns)), "dtypes": [str(_df.dtypes[c]) for c in _df.columns], "total": int(len(_df)), "rows": _j.loads(_w.to_json(orient="values", date_format="iso"))}, default=str))`;
  const result = await execute({ code, producer: "table" });
  const line = result.outputs.find((output) => output.kind === "text" && output.text.includes("__TELAR_TABLE__"));
  if (!result.ok || !line || line.kind !== "text") throw new Error(result.error ? `${result.error.ename}: ${result.error.evalue}` : "could not read the parquet file");
  return { offset: options.offset, ...(JSON.parse(line.text.slice(line.text.indexOf("__TELAR_TABLE__") + 15)) as Omit<TableWindow, "path" | "offset">) };
}
