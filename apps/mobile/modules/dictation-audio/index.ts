import { requireOptionalNativeModule, type EventSubscription } from "expo";

export type RouteReason =
  | "newDeviceAvailable"
  | "oldDeviceUnavailable"
  | "categoryChange"
  | "override"
  | "wakeFromSleep"
  | "noSuitableRouteForCategory"
  | "routeConfigurationChange"
  | "unknown";

type Events = {
  onAudio: (event: { data: ArrayBuffer }) => void;
  onRoute: (event: { reason: RouteReason }) => void;
  onInterruption: (event: { began: boolean }) => void;
  onReset: () => void;
};

/** 16 kHz mono 16-bit microphone capture on a play-and-record session that takes Bluetooth and car audio; null in tests and older builds. */
export type DictationAudioModule = {
  start(): Promise<void>;
  /** Taps the input again on the current route, keeping the session claimed. */
  rebuild(): Promise<void>;
  stop(): Promise<void>;
  addListener<Name extends keyof Events>(name: Name, listener: Events[Name]): EventSubscription;
};

export const dictationAudio = requireOptionalNativeModule<DictationAudioModule>("TelarDictationAudio");
