import { File } from "expo-file-system";
import { useState } from "react";
import { Settings } from "react-native";
import { TURN_CAP } from "./intake";
import { appendPrompt, canStash, dropEntry, readStash, stashEntry, takeEntry, type StashedImage, type StashEntry } from "./stash";
import type { useAttachments } from "./use-attachments";

type Attachments = ReturnType<typeof useAttachments>;

async function imageOf(row: Attachments["pending"][number]): Promise<StashedImage | undefined> {
  const { preview, attachment } = row;
  if (!preview || !attachment.mediaType.startsWith("image/")) return undefined;
  const dataUrl = preview.startsWith("data:") ? preview : `data:${attachment.mediaType};base64,${await new File(preview).base64()}`;
  return { name: attachment.name, type: attachment.mediaType, dataUrl };
}

/** Stash this prompt and Show stashed prompts: drafts set aside on this phone, with their images when they fit. */
export function useStash(draft: string, setDraft: (text: string) => void, attachments: Attachments) {
  const { setNote } = attachments;
  const [entries, setEntries] = useState(() => readStash(Settings));
  const [open, setOpen] = useState(false);

  const stash = async () => {
    const text = draft.trim();
    const attached = attachments.pending;
    const images = (await Promise.all(attached.map(imageOf).map((read) => read.catch(() => undefined)))).filter((image): image is StashedImage => image !== undefined);
    const entry: StashEntry = { id: `stash_${Date.now().toString(36)}`, at: Date.now(), prompt: text, images };
    const carriesFiles = attached.length > 0 && images.length === attached.length && canStash(entry);
    if (!carriesFiles) entry.images = [];
    if (!text && !carriesFiles) return;
    const next = stashEntry(Settings, entry);
    if (!next.some((row) => row.id === entry.id)) return setNote("There was no room to stash this. Nothing was taken from the box.");
    setEntries(next);
    setDraft("");
    if (carriesFiles) attachments.clear();
    setNote(attached.length === 0 || carriesFiles ? undefined : "Stashed the text. The files stay here.");
  };

  const restore = (entry: StashEntry) => {
    const taken = takeEntry(Settings, entry.id, TURN_CAP - attachments.pending.length);
    setEntries(readStash(Settings));
    if (!taken) return;
    setDraft(appendPrompt(draft, taken.prompt));
    const left = taken.left > 0 ? `${taken.left === 1 ? "1 image is" : `${taken.left} images are`} still in the stash — there is no room for more here.` : undefined;
    setNote(left);
    if (taken.images.length) void attachments.restoreImages(taken.images).then(() => left && setNote(left));
  };

  return {
    entries,
    open,
    canStash: draft.trim().length > 0 || attachments.pending.length > 0,
    show: () => (setEntries(readStash(Settings)), setOpen(true)),
    close: () => setOpen(false),
    stash: () => void stash(),
    restore,
    drop: (id: string) => setEntries(dropEntry(Settings, id)),
  };
}
