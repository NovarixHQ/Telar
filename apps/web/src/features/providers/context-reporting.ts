import type { ProviderDriverKind } from "@telar/engine-client";

// The drivers whose every turn carries a context figure; the others may never send one.
const REPORTS_CONTEXT: ReadonlySet<ProviderDriverKind> = new Set(["claude", "codex"]);

export const reportsContextUsage = (driver: ProviderDriverKind): boolean => REPORTS_CONTEXT.has(driver);
