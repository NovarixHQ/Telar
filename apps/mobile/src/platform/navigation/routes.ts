import type { Session } from "@telar/engine-client";

export type RootStack = {
  Hosts: undefined;
  Pair: { link?: string } | undefined;
  Sessions: { hostId: string; hostName?: string };
  Files: { hostId: string; sessionId: string };
  File: { hostId: string; sessionId: string; path: string };
  Session: { hostId: string; sessionId: Session["id"]; title?: string; draft?: string };
};
