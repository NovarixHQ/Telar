"use client";

import { Composer, type ComposerProps } from "@/features/composer";
import { usePanelFullscreen } from "@/features/panel";
import { MiniComposer } from "./mini-composer";
import { LiveTranscript } from "./live-transcript";

type TranscriptProps = Omit<Parameters<typeof LiveTranscript>[0], "size" | "followRef">;

export const MINI_TRANSCRIPT_CAP = "40vh";

export function SessionComposer({ composer, ...transcript }: TranscriptProps & { composer: ComposerProps }) {
  const fullscreen = usePanelFullscreen();
  if (!fullscreen) return <Composer {...composer} />;
  const conversation = transcript.sync.turns.length > 0 ? <LiveTranscript {...transcript} size={{ maxHeight: MINI_TRANSCRIPT_CAP }} /> : null;
  return <MiniComposer composer={composer} transcript={conversation} />;
}
