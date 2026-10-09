import { requireOptionalNativeModule, type EventSubscription } from "expo";

export type PastedFile = { uri: string; name: string; mimeType: string; size: number };

/** While someone listens, an image pasted into a multiline field comes here as files instead of being dropped; null in tests and older builds. */
export type ComposerPasteModule = {
  addListener(name: "onPaste", listener: (event: { files: PastedFile[] }) => void): EventSubscription;
};

export const composerPaste = requireOptionalNativeModule<ComposerPasteModule>("TelarComposerPaste");
