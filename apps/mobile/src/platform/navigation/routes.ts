import type { Session } from "@telar/engine-client";

export type RootStack = {
  Hosts: undefined;
  Pair: { link?: string } | undefined;
  Sessions: { hostId: string; hostName?: string };
  Diff: { hostId: string; sessionId: string };
  Settings: undefined;
  Usage: { hostId?: string } | undefined;
  Session: { hostId: string; sessionId: Session["id"]; title?: string; draft?: string };
};
