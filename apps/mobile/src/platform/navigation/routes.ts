import type { Session } from "@telar/engine-client";

export type RootStack = {
  Rail: undefined;
  Settings: undefined;
  NewSession: { hostId?: string; projectId?: string; baseRef?: string } | undefined;
  BranchPicker: { hostId: string; projectId: string; baseRef?: string };
  ProjectPicker: { hostId?: string; projectId?: string } | undefined;
  /** `pick` hands the new project back to the new-session form. */
  AddProject: { hostId: string; pick?: boolean };
  Pair: { link?: string } | undefined;
  Panel: { hostId: string; sessionId: string; tab?: string };
  Usage: { hostId?: string } | undefined;
  Session: { hostId: string; sessionId: Session["id"]; title?: string; draft?: string };
};
