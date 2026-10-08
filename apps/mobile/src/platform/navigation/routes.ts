import type { Session } from "@telar/engine-client";

export type RootStack = {
  Rail: undefined;
  Settings: undefined;
  Unavailable: { title: string; systemImage: "chart.bar" | "folder.badge.plus" | "square.and.pencil" };
  Pair: { link?: string } | undefined;
  Diff: { hostId: string; sessionId: string };
  Session: { hostId: string; sessionId: Session["id"]; title?: string; draft?: string };
};
