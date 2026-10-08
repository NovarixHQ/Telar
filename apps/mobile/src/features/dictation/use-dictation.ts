import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useRef, useState } from "react";
import type { HostConnection } from "../../platform/connection";
import { transcribe } from "./transcribe";

export type DictationPhase = "idle" | "recording" | "transcribing";

/** Press to record, press again to stop; the words are written into the draft when the clip is transcribed. */
export function useDictation(host: HostConnection | undefined, onWords: (words: string) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [problem, setProblem] = useState<string>();
  const grant = useRef<{ token: string; language: string; keyterms?: string[] }>(undefined);

  const fail = (message: string) => {
    setProblem(message);
    setPhase("idle");
  };

  const start = async () => {
    if (!host) return;
    setProblem(undefined);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return fail("Telar can't use the microphone. Allow it in Settings › Telar.");
      grant.current = await host.call(false, () => host.client.dictationToken());
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  const stop = async () => {
    setPhase("transcribing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri || !grant.current) return fail("Nothing was recorded.");
      const clip = await (await fetch(uri)).blob();
      const words = await transcribe(clip, grant.current);
      if (words) onWords(words);
      setPhase("idle");
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  };

  return { phase, problem, language: grant.current?.language, toggle: () => void (phase === "recording" ? stop() : phase === "idle" ? start() : undefined) };
}
