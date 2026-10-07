type PairSimulatorsResult = { paired: string[]; failed: string[]; message: string };

type DesktopDev = { pairSimulators: () => Promise<PairSimulatorsResult> };

export function desktopDev(): DesktopDev | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { telarDesktop?: { dev?: DesktopDev } }).telarDesktop?.dev;
}
