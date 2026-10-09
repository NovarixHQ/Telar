import type { ComposerPasteModule } from "../../../modules/composer-paste";
import type { Picked } from "./intake";

/** Hands pasted images to `onFiles` until the returned stop runs; text pastes stay with the field. */
export function listenForPaste(source: ComposerPasteModule | null, onFiles: (files: Picked[]) => void): () => void {
  const subscription = source?.addListener("onPaste", ({ files }) => {
    if (files.length) onFiles(files);
  });
  return () => subscription?.remove();
}
