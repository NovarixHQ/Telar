const BASE_MS = 1_000;
const FIRST_CEILING_MS = 2_000;
const MAX_CEILING_MS = 5 * 60_000;
export const RESET_AFTER_ONLINE_MS = 30_000;

/** The wait before retry `attempt` (0-based): at least a second, under a ceiling that doubles from 2 s to 5 min. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_CEILING_MS, FIRST_CEILING_MS * 2 ** Math.max(0, attempt));
  return Math.round(BASE_MS + random() * (ceiling - BASE_MS));
}
