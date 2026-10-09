import { requireOptionalNativeModule, type EventSubscription } from "expo";

export type KeyModifier = "command" | "option" | "shift" | "control";

/** A hardware key command; one without a title works but stays out of the ⌘-hold overlay. */
export type NativeKeyCommand = { id: string; input: string; modifiers: KeyModifier[]; title?: string };

/** Hardware keyboard shortcuts on the window's root controller; null in tests and older builds. */
export type KeyCommandsModule = {
  setCommands(commands: NativeKeyCommand[]): void;
  addListener(name: "onKeyCommand", listener: (event: { id: string }) => void): EventSubscription;
};

export const keyCommands = requireOptionalNativeModule<KeyCommandsModule>("TelarKeyCommands");
