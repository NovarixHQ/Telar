import { File } from "expo-file-system";
import { useState } from "react";
import { TURN_CAP } from "./intake";
import { pickFiles, type PickerKind } from "./use-attachments";

/** A file picked for a session that does not exist yet: read and uploaded once the session is made. */
export type DraftFile = { id: string; name: string; mediaType: string; uri: string; read: () => Promise<Uint8Array> };

let minted = 0;

export function useDraftAttachments() {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [note, setNote] = useState<string>();
  return {
    files,
    note,
    rows: files.map((file) => ({ attachment: { id: file.id, name: file.name, mediaType: file.mediaType }, ...(file.mediaType.startsWith("image/") ? { preview: file.uri } : {}) })),
    hasImage: files.some((file) => file.mediaType.startsWith("image/")),
    remove: (id: string) => setFiles((rows) => rows.filter((row) => row.id !== id)),
    clear: () => setFiles([]),
    pick: async (kind: PickerKind) => {
      try {
        const picked = await pickFiles(kind);
        const room = TURN_CAP - files.length;
        const problems = [...picked.refusals, ...(picked.files.length > room ? [`A message carries at most ${TURN_CAP} files.`] : [])];
        const taken = picked.files.slice(0, Math.max(0, room)).map((file) => ({ ...file, id: `draft_${(minted += 1)}`, read: () => new File(file.uri).bytes() }));
        setFiles((rows) => [...rows, ...taken]);
        setNote(problems.length ? problems.join(" ") : undefined);
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
