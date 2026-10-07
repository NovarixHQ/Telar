import { createContext } from "react";
import type { SessionChild } from "@telar/engine-client";

export type SessionFacts = { title?: string; href?: string; child?: SessionChild };

/** What the transcript may say about a session it mentions; ids are never shown. */
export const SessionLookup = createContext<(sessionId: string) => SessionFacts | undefined>(() => undefined);
