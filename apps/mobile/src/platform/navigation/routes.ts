import type { Session } from "@telar/engine-client";

export type RootStack = {
  Hosts: undefined;
  Pair: { link?: string } | undefined;
  Sessions: { hostId: string; hostName?: string };
  Panel: { hostId: string; sessionId: string; tab?: string };
  Session: { hostId: string; sessionId: Session["id"]; title?: string; draft?: string };
};
