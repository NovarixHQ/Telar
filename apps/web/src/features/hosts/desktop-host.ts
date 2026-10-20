export type DesktopHost = {
  runsLocalEngine: boolean;
  get: () => Promise<{ local: boolean; remote: { baseUrl: string; name: string } | null }>;
  connect: (link: string) => Promise<unknown>;
  setLocal: (on: boolean) => Promise<unknown>;
  forget: () => Promise<unknown>;
};

export function desktopHost(): DesktopHost | undefined {
  if (typeof window === "undefined") return undefined;
  const host = (window as { telarDesktop?: { host?: Partial<DesktopHost> } }).telarDesktop?.host;
  return host?.get && host.connect && host.setLocal && host.forget ? (host as DesktopHost) : undefined;
}
