"use client";

import { createContext } from "react";
import type { SessionChild } from "@telar/engine-client";

export type SessionFacts = { title?: string; href?: string; child?: SessionChild };

export const SessionLookup = createContext<(sessionId: string) => SessionFacts | undefined>(() => undefined);
