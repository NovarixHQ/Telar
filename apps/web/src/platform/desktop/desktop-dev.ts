type PairSimulatorsResult = { paired: string[]; failed: string[]; message: string };

type DesktopDev = { pairSimulators: () => Promise<PairSimulatorsResult> };

/** Present only in Telar Dev: the shell exposes it to dev builds alone. */
export function desktopDev(): DesktopDev | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { telarDesktop?: { dev?: DesktopDev } }).telarDesktop?.dev;
}
