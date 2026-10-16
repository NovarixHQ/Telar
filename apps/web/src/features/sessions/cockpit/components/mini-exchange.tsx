"use client";

import { useLayoutEffect, useRef } from "react";
import type { EngineRequest } from "@telar/engine-client";
import { Composer, type ComposerProps } from "@/features/composer";
import { usePanelFullscreen } from "@/features/panel";
import { MiniComposer } from "./mini-composer";
import { transcriptRows } from "../model";
import type { useTranscriptModel } from "../hooks/use-transcript-model";
import { SessionTurn } from "./session-turn";

type Decide = Parameters<typeof SessionTurn>[0]["onDecide"];

function MiniExchange({ model, sending, onDecide }: { model: ReturnType<typeof useTranscriptModel>; sending: boolean; onDecide: Decide }) {
  const { shown, hostOf } = transcriptRows(model.transcript);
  const turn = shown.at(-1);
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  });
  if (!turn) return null;
  const hostRun = (request: EngineRequest) => hostOf.get(request.runId) ?? request.runId;
  return (
    <>
      <SessionTurn turn={turn} live={turn.runId === model.active?.runId} sending={sending} requests={model.openRequests.filter((request) => hostRun(request) === turn.runId)} onDecide={onDecide} />
      <div ref={end} />
    </>
  );
}

/** The session's composer, or while the panel fills the window, the one that floats over it. */
export function SessionComposer({ composer, model, sending, onDecide }: { composer: ComposerProps; model: ReturnType<typeof useTranscriptModel>; sending: boolean; onDecide: Decide }) {
  const fullscreen = usePanelFullscreen();
  if (!fullscreen) return <Composer {...composer} />;
  return <MiniComposer composer={composer} exchange={<MiniExchange model={model} sending={sending} onDecide={onDecide} />} />;
}
