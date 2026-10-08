import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useRef, useState } from "react";
import type { HostConnection } from "../../platform/connection";
import { explain, freshGrant, grantOf, MIC_REFUSED, type Grant } from "./grant";
import { transcribe } from "./transcribe";

export type DictationPhase = "idle" | "recording" | "transcribing";

/** Press to record, press again to stop; the words are written into the draft when the clip is transcribed. */
export function useDictation(host: HostConnection | undefined, onWords: (words: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [problem, setProblem] = useState<string>();
  const grant = useRef<Grant>(undefined);

  const fail = async (error: unknown) => {
    setPhase("idle");
    setProblem(host ? await explain(error, () => host.call(false, () => host.client.dictationDiagnosis())) : String(error));
  };

  const start = async () => {
    if (!host) return;
    setProblem(undefined);
    try {
      grant.current = grantOf(await host.call(false, () => host.client.dictationToken()));
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setProblem(MIC_REFUSED);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch (error) {
      await fail(error);
    }
  };

  const stop = async () => {
    setPhase("transcribing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri || !grant.current || !host) return await fail(new Error("Nothing was recorded."));
      grant.current = await freshGrant(grant.current, () => host.call(false, () => host.client.dictationToken()));
      const clip = await (await fetch(uri)).blob();
      const words = await transcribe(clip, grant.current);
      if (words) onWords(words);
      setPhase("idle");
    } catch (error) {
      await fail(error);
    }
  };

  return { phase, problem, language: grant.current?.language, toggle: () => void (phase === "recording" ? stop() : phase === "idle" ? start() : undefined) };
}
