import type { LatexToolchain } from "./toolchain";

export type LatexDiagnostic = {
  severity: "error" | "warning";
  file?: string;
  line?: number;
  message: string;
  code?: "missing-package" | "missing-file" | "undefined-control-sequence" | "undefined-reference" | "citation-undefined" | "overfull" | "other";
  detail?: string;
  suggestion?: string;
};

export type LatexPackagesAnswer =
  | { mode: "automatic"; note: string }
  | { mode: "managed"; packages: { name: string; revision?: string; description?: string }[] }
  | { mode: "unavailable"; reason: string };

export type CompileStatus = {
  status: "running" | "ok" | "failed" | "cancelled";
  path: string;
  pdfPath?: string;
  diagnostics: LatexDiagnostic[];
  logTail: string[];
  error?: string;
  jobId?: string;
  startedAt: number;
  finishedAt?: number;
};

export type CompileResult = {
  ok: boolean;
  path: string;
  pdfPath?: string;
  diagnostics: LatexDiagnostic[];
  logTail: string[];
  error?: string;
};

export type ResolvedToolchainAnswer = {
  kind: "tectonic" | "texlive";
  binPath: string;
  engine?: string;
  version?: string;
  tlmgr: boolean;
  mainFile?: string;
  available: LatexToolchain;
};

export type LatexCapability = {
  toolchain(): Promise<ResolvedToolchainAnswer>;
  compile(input?: { path?: string; timeoutMs?: number }): Promise<CompileResult>;
  status(): Promise<CompileStatus | { status: "never" }>;
  log(input?: { tail?: number; around?: number; find?: string }): Promise<{ lines: string[] }>;
  packages(): Promise<LatexPackagesAnswer>;
  install(input: { add?: string[]; remove?: string[] }): Promise<{ ok: boolean; lines: string[]; error?: string }>;
  clean(input?: { pdf?: boolean }): Promise<{ removed: string[] }>;
};
