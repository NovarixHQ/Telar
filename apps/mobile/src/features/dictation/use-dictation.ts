import { requestRecordingPermissionsAsync } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { dictationAudio } from "../../../modules/dictation-audio";
import type { HostConnection } from "../../platform/connection";
import { explain, grantOf, MIC_REFUSED, type Grant } from "./grant";
import { Listening } from "./listening";
import { openLive } from "./live";
import { EMPTY_STRIP, flush, hear } from "./strip";

export type DictationPhase = "idle" | "starting" | "listening";

const SAMPLE_RATE = 16_000;
const TICK_MS = 1_000;
const NO_CAPTURE = "This build of Telar cannot record. Update the app and try again.";

/** Tap to listen, tap again to stop: interim words show in `heard`, final ones are written into the draft as they land. */
export function useDictation(host: HostConnection | undefined, onWords: (words: string) => void) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [problem, setProblem] = useState<string>();
  const [heard, setHeard] = useState("");
  const [language, setLanguage] = useState<string>();
  const listening = useRef<Listening>(undefined);
  const strip = useRef(EMPTY_STRIP);
  const generation = useRef(0);
  const write = useRef(onWords);
  write.current = onWords;

  const take = (step: { strip: typeof EMPTY_STRIP; commit: string }) => {
    strip.current = step.strip;
    setHeard(step.strip.heard);
    if (step.commit) write.current(step.commit);
  };

  const close = () => {
    generation.current += 1;
    listening.current?.cancel();
    listening.current = undefined;
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
    const audio = dictationAudio;
    const mine = generation.current;
    setProblem(undefined);
    setPhase("starting");
    try {
      if (!audio) throw new Error(NO_CAPTURE);
      const mint = async () => grantOf(await host.call(false, () => host.client.dictationToken()));
      let first: Grant | undefined = await mint();
      if (!(await requestRecordingPermissionsAsync()).granted) {
        setPhase("idle");
        setProblem(MIC_REFUSED);
        return;
      }
      if (generation.current !== mine) return;
      await audio.start();
      if (generation.current !== mine) return void audio.stop();
      strip.current = EMPTY_STRIP;
      setLanguage(first.language);
      const run = new Listening({
        capture: audio,
        open: async (on) => {
          const grant = first ?? (await mint());
          first = undefined;
          return openLive(grant, SAMPLE_RATE, on);
        },
        words: (words) => take(hear(strip.current, words)),
        // A new socket starts its phrases afresh, so nothing of them is already in the draft.
        flush: () => take({ strip: EMPTY_STRIP, commit: flush(strip.current).commit }),
        ended: (error) => void (listening.current === run && fail(error)),
        now: Date.now,
      });
      listening.current = run;
      setPhase("listening");
      await run.begin();
    } catch (error) {
      if (generation.current !== mine) return;
      if (!listening.current) void audio?.stop();
      await fail(error);
    }
  };

  const finish = async () => {
    const run = listening.current;
    if (!run) return;
    await run.finish();
    if (listening.current === run) close();
  };

  useEffect(() => {
    if (!dictationAudio) return;
    const subscriptions = [
      dictationAudio.addListener("onAudio", ({ data }) => listening.current?.audio(data)),
      dictationAudio.addListener("onRoute", ({ reason }) => void listening.current?.event({ type: "route", reason })),
      dictationAudio.addListener("onInterruption", ({ began }) => void listening.current?.event({ type: "interruption", began })),
      dictationAudio.addListener("onReset", () => void listening.current?.event({ type: "reset" })),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  useEffect(() => {
    if (phase !== "listening") return;
    const timer = setInterval(() => void listening.current?.tick(), TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      generation.current += 1;
      listening.current?.cancel();
      listening.current = undefined;
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
