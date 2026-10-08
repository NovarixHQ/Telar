import { z } from "zod";

export type StorageCategory =
  | "worktrees"
  | "journal"
  | "sessions"
  | "python"
  | "browser-profiles"
  | "usage"
  | "dictation"
  | "run"
  | "diagnostics"
  | "settings"
  /** Attributed to nothing above, so the rows still sum to the total. */
  | "other";

export type StorageEntry = {
  category: StorageCategory;
  bytes: number;
  path: string;
  kind: "directory" | "file";
  status?: "measuring" | "partial";
  /** While `measuring`: how many of the row's parts have settled. */
  progress?: { measured: number; of: number };
};

export type StoreCopy = { root: string; files: number; bytes: number };

type PackageCacheStatus = { name: string; path: string; dedup: "different-device" | "unreachable" };

export type StorageReport = {
  root: string;
  total: number;
  entries: StorageEntry[];
  measuredAt: number;
  tookMs: number;
  partial: boolean;
  caches?: PackageCacheStatus[];
};

export type JournalReclaim = { before: number; after: number; deltas: number; starts: number; sessions: number; usage?: number };

export const CLEANUP_SETTLED_DAYS = [1, 3, 7, 14, 30] as const;

export const CleanupPolicy = z.object({
  /** Release the checkout of a session settled or archived this many days. `null` is off. */
  settledDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).nullable().default(3),
});
export type CleanupPolicy = z.infer<typeof CleanupPolicy>;

export const DEFAULT_CLEANUP_POLICY: CleanupPolicy = { settledDays: 3 };

export const CleanupReport = z.object({
  at: z.number(),
  freedBytes: z.number().min(0),
  released: z.number().int().min(0),
  logs: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type CleanupReport = z.infer<typeof CleanupReport>;

export const CleanupState = z.object({
  policy: CleanupPolicy,
  last: CleanupReport.optional(),
  running: z.boolean(),
});
export type CleanupState = z.infer<typeof CleanupState>;
