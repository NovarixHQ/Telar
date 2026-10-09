import { getDocumentAsync } from "expo-document-picker";
import { File } from "expo-file-system";
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from "expo-image-picker";
import { useEffect, useState } from "react";
import type { TurnAttachment } from "@telar/engine-client";
import { Settings } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { intake, PREVIEW_CAP, TURN_CAP, type Picked } from "./intake";
import type { StashedImage } from "./stash";

type PendingAttachment = { attachment: TurnAttachment; preview?: string };

export type PickerKind = "photos" | "camera" | "files";

const keyOf = (hostId: string, sessionId: string) => `telar.attachments.${hostId}.${sessionId}`;

function restore(hostId: string, sessionId: string): PendingAttachment[] {
  const raw: unknown = Settings.get(keyOf(hostId, sessionId));
  if (typeof raw !== "string" || !raw) return [];
  try {
    return JSON.parse(raw) as PendingAttachment[];
  } catch {
    return [];
  }
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function launchPicker(kind: PickerKind): Promise<{ picked: Picked[]; fallback: string }> {
  if (kind === "files") {
    const result = await getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    return { picked: result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null })), fallback: "file" };
  }
  if (kind === "camera" && !(await requestCameraPermissionsAsync()).granted) throw new Error("Telar can't use the camera. Allow it in Settings › Telar.");
  const result = kind === "camera" ? await launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 }) : await launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8, quality: 1 });
  return { picked: result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? null, mimeType: asset.mimeType ?? "image/jpeg", size: asset.fileSize ?? null })), fallback: "photo" };
}

/** Opens the photo library, the camera or Files; what comes back is cleared for attaching or refused with a reason. */
export async function pickFiles(kind: PickerKind): Promise<{ files: { uri: string; name: string; mediaType: string }[]; refusals: string[] }> {
  const { picked, fallback } = await launchPicker(kind);
  const taken = picked.map((item) => intake(item, fallback));
  return { files: taken.flatMap((item) => ("file" in item ? [item.file] : [])), refusals: taken.flatMap((item) => ("refused" in item ? [item.refused] : [])) };
}

/** The files waiting to go with the next message: picked, uploaded to the session, and kept across launches. */
export function useAttachments(host: HostConnection | undefined, hostId: string, sessionId: string) {
  const [pending, setPending] = useState(() => restore(hostId, sessionId));
  const [uploading, setUploading] = useState(0);
  const [note, setNote] = useState<string>();
  useEffect(() => Settings.set({ [keyOf(hostId, sessionId)]: pending.length ? JSON.stringify(pending) : "" }), [pending, hostId, sessionId]);

  const upload = async (name: string, mediaType: string, data: Uint8Array, preview: string | undefined): Promise<string | undefined> => {
    if (!host) return `Couldn't upload ${name}: not connected.`;
    try {
      const { attachment } = await host.call(false, () => host.client.uploadAttachment(sessionId, { name, mediaType, data }));
      setPending((rows) => [...rows, { attachment, ...(preview && mediaType.startsWith("image/") && data.length <= PREVIEW_CAP ? { preview } : {}) }]);
      return undefined;
    } catch (error) {
      return `Couldn't upload ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const attach = async (items: { name: string; mediaType: string; read: () => Promise<Uint8Array>; preview?: string }[], refusals: string[] = []) => {
    const problems = [...refusals];
    const room = TURN_CAP - pending.length;
    if (items.length > room) problems.push(`A message carries at most ${TURN_CAP} files.`);
    setUploading((count) => count + Math.min(items.length, room));
    for (const item of items.slice(0, Math.max(0, room))) {
      const failed = await item.read().then((data) => upload(item.name, item.mediaType, data, item.preview), () => `${item.name} could not be read.`);
      if (failed) problems.push(failed);
      setUploading((count) => count - 1);
    }
    setNote(problems.length ? problems.join(" ") : undefined);
  };

  return {
    pending,
    uploading: uploading > 0,
    note,
    setNote,
    hasImage: pending.some((row) => row.attachment.mediaType.startsWith("image/")),
    remove: (id: string) => setPending((rows) => rows.filter((row) => row.attachment.id !== id)),
    clear: () => setPending([]),
    pick: async (kind: PickerKind) => {
      try {
        const { files, refusals } = await pickFiles(kind);
        await attach(files.map((file) => ({ ...file, read: () => new File(file.uri).bytes(), preview: file.uri })), refusals);
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      }
    },
    restoreImages: (images: StashedImage[]) =>
      attach(images.map((image) => ({ name: image.name, mediaType: image.type, read: async () => fromBase64(image.dataUrl.slice(image.dataUrl.indexOf(",") + 1)), preview: image.dataUrl }))),
  };
}
