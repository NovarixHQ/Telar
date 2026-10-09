import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import type { HostConnection } from "../../platform/connection";
import { explain, grantOf, MIC_REFUSED, SOCKET_ENDED, TranscriptionRefused } from "./grant";
import { openLive, type Live } from "./live";
import { EMPTY_STRIP, flush, hear } from "./strip";

export type DictationPhase = "idle" | "starting" | "listening";

/** Tap to listen, tap again to stop: interim words show in `heard`, final ones are written into the draft as they land. */
export function useDictation(host: HostConnection | undefined, onWords: (words: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [problem, setProblem] = useState<string>();
  const [heard, setHeard] = useState("");
  const [language, setLanguage] = useState<string>();
  const live = useRef<Live>(undefined);
  const strip = useRef(EMPTY_STRIP);
  const generation = useRef(0);
  const write = useRef(onWords);
  write.current = onWords;
  const { stream } = useAudioStream({ sampleRate: 16_000, encoding: "int16", onBuffer: ({ data }) => live.current?.send(data) });

  const take = (step: { strip: typeof EMPTY_STRIP; commit: string }) => {
    strip.current = step.strip;
    setHeard(step.strip.heard);
    if (step.commit) write.current(step.commit);
  };

  const close = () => {
    generation.current += 1;
    live.current = undefined;
    stream.stop();
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    take(flush(strip.current));
    strip.current = EMPTY_STRIP;
    setLanguage(undefined);
    setPhase("idle");
  };

  const fail = async (error: unknown) => {
    close();
    setProblem(host ? await explain(error, () => host.call(false, () => host.client.dictationDiagnosis())) : String(error));
  };

  const start = async () => {
    if (!host) return;
    const mine = generation.current;
    setProblem(undefined);
    setPhase("starting");
    try {
      const grant = grantOf(await host.call(false, () => host.client.dictationToken()));
      if (!(await requestRecordingPermissionsAsync()).granted) {
        setPhase("idle");
        setProblem(MIC_REFUSED);
        return;
      }
      if (generation.current !== mine) return;
      await stream.start();
      if (generation.current !== mine) return stream.stop();
      strip.current = EMPTY_STRIP;
      live.current = openLive(grant, stream.sampleRate, {
        words: (words) => take(hear(strip.current, words)),
        ended: () => void fail(new TranscriptionRefused(SOCKET_ENDED)),
      });
      setLanguage(grant.language);
      setPhase("listening");
    } catch (error) {
      if (generation.current === mine) await fail(error);
    }
  };

  const finish = async () => {
    const now = live.current;
    if (!now) return;
    stream.stop();
    await now.finish();
    if (live.current === now) close();
  };

  useEffect(
    () => () => {
      generation.current += 1;
      live.current?.cancel();
      live.current = undefined;
    },
    [],
  );

  return {
    phase,
    problem,
    heard,
    language,
    finish,
    toggle: () => void (phase === "listening" ? finish() : phase === "idle" ? start() : undefined),
  };
}
