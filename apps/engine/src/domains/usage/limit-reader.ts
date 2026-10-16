import type { ProviderDriverKind, UsageLimits } from "@telar/engine-client";
import { readUsageLimitSource } from "./limits";
import type { UsageLimitSources } from "./sources";

const LIMITS_TTL_MS = 5 * 60_000;
const NEAR_LIMIT_PERCENT = 80;

/** In memory only, stale-while-revalidate, one read in flight: a quota figure is true for minutes. */
export class UsageLimitReader {
  private snapshot: UsageLimits | undefined;
  private inFlight: Promise<UsageLimits> | undefined;

  constructor(
    private readonly sources: UsageLimitSources,
    private readonly readSource: typeof readUsageLimitSource = readUsageLimitSource,
    private readonly now: () => number = Date.now,
  ) {}

  refresh(): Promise<UsageLimits> {
    return (this.inFlight ??= Promise.all(this.sources.resolve().map((source) => this.readSource(source)))
      .then((sources) => (this.snapshot = { sources, readAt: this.now() }))
      .finally(() => (this.inFlight = undefined)));
  }

  async read(refresh: boolean): Promise<UsageLimits> {
    const cached = this.snapshot;
    if (refresh || !cached) return this.refresh();
    this.revalidate();
    return cached;
  }

  forget(): void {
    this.snapshot = undefined;
  }

  nearLimit(driver: ProviderDriverKind): { label: string; usedPercent: number } | undefined {
    this.revalidate();
    const windows = (this.snapshot?.sources ?? [])
      .flatMap((source) => source.accounts)
      .filter((account) => account.driver === driver)
      .flatMap((account) => account.windows)
      .filter((window) => !window.key.startsWith("model:") && window.usedPercent >= NEAR_LIMIT_PERCENT);
    const fullest = windows.sort((a, b) => b.usedPercent - a.usedPercent)[0];
    return fullest ? { label: fullest.label, usedPercent: fullest.usedPercent } : undefined;
  }

  private revalidate(): void {
    if (this.sources.resolve().length === 0) return;
    if (!this.snapshot || this.now() - this.snapshot.readAt >= LIMITS_TTL_MS) void this.refresh().catch(() => undefined);
  }
}
