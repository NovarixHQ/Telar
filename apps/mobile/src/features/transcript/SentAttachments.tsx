import { attachmentSymbol, humanBytes } from "@telar/client/journal";
import type { TurnAttachment } from "@telar/engine-client";
import { Directory, File, Paths } from "expo-file-system";
import { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { quickLook } from "../../../modules/quick-look";
import { Radius, Theme, type SymbolName } from "../../ui";
import { Symbol, TextSize } from "./native";
import { cacheFolder, fileName } from "./sent";
import { SourceContext, type TranscriptSource } from "./source";

const TILE = 96;
const reading = new Map<string, Promise<string>>();

/** The sent file on this phone, downloaded once and kept under its own name so Quick Look can tell its type. */
function sentFile(source: TranscriptSource, attachment: TurnAttachment): Promise<string> {
  const folder = new Directory(Paths.cache, ...cacheFolder(source.host.hostId, source.sessionId, attachment.id));
  const file = new File(folder, fileName(attachment.name));
  if (file.exists) return Promise.resolve(file.uri);
  let read = reading.get(file.uri);
  if (!read) {
    read = source.host
      .call(true, () => source.host.client.attachmentBytes(source.sessionId, attachment.id))
      .then(async ({ data }) => {
        folder.create({ intermediates: true, idempotent: true });
        await file.write(data);
        return file.uri;
      })
      .finally(() => reading.delete(file.uri));
    reading.set(file.uri, read);
  }
  return read;
}

function Thumbnail({ source, attachment }: { source: TranscriptSource | undefined; attachment: TurnAttachment }) {
  const [uri, setUri] = useState<string>();
  useEffect(() => {
    if (!source) return;
    let live = true;
    sentFile(source, attachment).then((found) => live && setUri(found), () => undefined);
    return () => void (live = false);
  }, [source?.host, source?.sessionId, attachment.id]);
  return (
    <View style={[styles.thumb, styles.centered]}>
      {uri ? <Image source={{ uri }} style={styles.thumb} resizeMode="cover" /> : <Symbol name="photo" size={20} color={Theme.textMuted} />}
    </View>
  );
}

function FileChip({ attachment }: { attachment: TurnAttachment }) {
  return (
    <View style={styles.chip}>
      <Symbol name={attachmentSymbol(attachment.mediaType) as SymbolName} size={18} color={Theme.textMuted} />
      <View style={styles.chipText}>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">{attachment.name}</Text>
        <Text style={styles.size}>{humanBytes(attachment.bytes)}</Text>
      </View>
    </View>
  );
}

/** What went with a message: image thumbnails and file chips; tap one to download it and see it in Quick Look. */
export function SentAttachments({ attachments }: { attachments: readonly TurnAttachment[] }) {
  const source = useContext(SourceContext);
  const [opening, setOpening] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const open = async (attachment: TurnAttachment) => {
    if (!source) return;
    setOpening(attachment.id);
    setFailed(undefined);
    const uri = await sentFile(source, attachment).catch(() => undefined);
    setOpening(undefined);
    if (!uri || !(await quickLook?.preview(uri))) setFailed(`Couldn't download ${attachment.name}.`);
  };
  return (
    <View style={styles.stack}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {attachments.map((attachment) => (
          <Pressable
            key={attachment.id}
            disabled={!source || opening !== undefined}
            onPress={() => void open(attachment)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${attachment.name}`}
          >
            {attachment.mediaType.startsWith("image/") ? <Thumbnail source={source} attachment={attachment} /> : <FileChip attachment={attachment} />}
            {opening === attachment.id ? (
              <View style={[StyleSheet.absoluteFill, styles.centered]}>
                <View style={styles.spinner}>
                  <ActivityIndicator />
                </View>
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      {failed ? <Text style={styles.failed}>{failed}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: "flex-end", gap: 6 },
  strip: { flexGrow: 1, justifyContent: "flex-end", gap: 8 },
  centered: { alignItems: "center", justifyContent: "center" },
  thumb: { width: TILE, height: TILE, borderRadius: Radius.card, borderCurve: "continuous", overflow: "hidden", backgroundColor: Theme.subtle },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 220, paddingHorizontal: 12, paddingVertical: 10, borderRadius: Radius.card, borderCurve: "continuous", backgroundColor: Theme.subtle },
  chipText: { flexShrink: 1, gap: 2 },
  name: { fontSize: TextSize.footnote, fontWeight: "500", color: Theme.text },
  size: { fontSize: TextSize.caption, color: Theme.textMuted },
  spinner: { padding: 8, borderRadius: 20, backgroundColor: Theme.subtle },
  failed: { fontSize: TextSize.footnote, color: Theme.red },
});
