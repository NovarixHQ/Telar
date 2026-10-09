import { requireOptionalNativeModule, type EventSubscription } from "expo";

type Events = {
  onPushToken: (event: { id: string; token: string }) => void;
  onStateChange: (event: { id: string; state: string }) => void;
};

/** The native side of the Lock Screen card; null where ActivityKit is missing (tests, older builds). */
export type LiveActivityModule = {
  enabled(): boolean;
  card(): { id: string; token?: string } | null;
  start(state: string, staleSeconds: number): string;
  /** Drops titles from the running card, for when message previews are turned off. */
  conceal(): Promise<void>;
  endAll(): Promise<void>;
  endOthers(): Promise<void>;
  addListener<Name extends keyof Events>(name: Name, listener: Events[Name]): EventSubscription;
};

export const liveActivity = requireOptionalNativeModule<LiveActivityModule>("TelarLiveActivity");
