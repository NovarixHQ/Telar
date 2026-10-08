import type { Session } from "@telar/engine-client";

export type RootStack = {
  Hosts: undefined;
  Pair: { link?: string; hostId?: string } | undefined;
  HostSettings: { hostId: string };
  Sessions: { hostId: string; hostName?: string };
  Diff: { hostId: string; sessionId: string };
  Session: { hostId: string; sessionId: Session["id"]; title?: string; draft?: string };
};
