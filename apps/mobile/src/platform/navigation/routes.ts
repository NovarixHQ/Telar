import type { Session } from "@telar/engine-client";

export type RootStack = {
  Hosts: undefined;
  Sessions: { hostId: string; hostName: string };
  Session: { hostId: string; sessionId: Session["id"]; title: string };
};
