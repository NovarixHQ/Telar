import { Host } from "@expo/ui/swift-ui";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon, Theme, type SymbolName } from "../../ui";
import { attachmentSymbol } from "./intake";
import type { TurnAttachment } from "@telar/engine-client";

type Row = { attachment: Pick<TurnAttachment, "id" | "name" | "mediaType">; preview?: string };

const TILE = 72;

function Tile({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const { name, mediaType } = row.attachment;
  return (
    <View style={styles.tile} accessibilityLabel={name}>
      {row.preview ? (
        <Image source={{ uri: row.preview }} style={styles.fill} resizeMode="cover" />
      ) : (
        <View style={[styles.fill, styles.glyph]}>
          <Host matchContents>
            <Icon name={attachmentSymbol(mediaType) as SymbolName} size={20} color={Theme.textMuted} />
          </Host>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
        </View>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={onRemove} style={styles.remove} hitSlop={6}>
        <Host matchContents>
          <Icon name="xmark" size={9} weight="bold" color="white" />
        </Host>
      </Pressable>
    </View>
  );
}

/** The files going with the next message, as the Swift app's 72pt tiles. */
export function AttachmentStrip({ rows, uploading, onRemove }: { rows: Row[]; uploading: boolean; onRemove: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="always">
      {rows.map((row) => (
        <Tile key={row.attachment.id} row={row} onRemove={() => onRemove(row.attachment.id)} />
      ))}
      {uploading ? (
        <View style={[styles.tile, styles.glyph]}>
          <ActivityIndicator />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 10 },
  tile: { width: TILE, height: TILE, borderRadius: 16, borderCurve: "continuous", overflow: "hidden", backgroundColor: Theme.subtle },
  fill: { width: TILE, height: TILE },
  glyph: { alignItems: "center", justifyContent: "center", gap: 6 },
  name: { maxWidth: TILE - 8, fontSize: 10, color: Theme.textMuted },
  remove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
});
