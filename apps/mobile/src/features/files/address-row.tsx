import { Button, ContextMenu, Divider, HStack, Host, Spacer, Text as SwiftText } from "@expo/ui/swift-ui";
import { background, font, foregroundStyle, frame, lineLimit, padding, truncationMode } from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { StyleSheet, Text, TurboModuleRegistry, View, type TurboModule } from "react-native";
import { faded, Icon, Theme } from "../../ui";
import { fileGlyph } from "./tree";

const clipboard = TurboModuleRegistry.get<TurboModule & { setString(text: string): void }>("Clipboard");

const absolutePath = (root: string, path: string) => `${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

/** A file's copy items for a press-and-hold menu; the absolute path needs the checkout's root. */
export function CopyPathItems({ path, root }: { path: string; root?: string | undefined }) {
  if (!clipboard) return null;
  return (
    <>
      {root ? <Button label="Copy path" systemImage="doc.on.doc" onPress={() => clipboard.setString(absolutePath(root, path))} /> : null}
      <Button label="Copy relative path" systemImage="doc.on.doc" onPress={() => clipboard.setString(path)} />
    </>
  );
}

export function ReferenceItem({ path, onReference }: { path: string; onReference: ((path: string) => void) | undefined }) {
  if (!onReference) return null;
  return (
    <>
      <Divider />
      <Button label="Insert as a reference" systemImage="text.badge.plus" onPress={() => onReference(path)} />
    </>
  );
}

type Props = { path: string; detail?: string | undefined; trailing?: ReactNode; menu?: ReactNode };

export function AddressRow({ path, detail, trailing, menu }: Props) {
  const row = (
    <HStack spacing={8} modifiers={[padding({ horizontal: 10 }), frame({ minHeight: 30 }), background(Theme.sheet)]}>
      <Icon name={fileGlyph(path)} textStyle="caption" color={Theme.textMuted} />
      <SwiftText modifiers={[font({ textStyle: "caption", design: "monospaced" }), foregroundStyle(Theme.textMuted), lineLimit(1), truncationMode("head")]}>{path}</SwiftText>
      <Spacer minLength={4} />
      {detail ? <SwiftText modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.textMuted)]}>{detail}</SwiftText> : null}
      {trailing}
    </HStack>
  );
  return (
    <View>
      <Host matchContents={{ vertical: true }}>
        {menu ? (
          <ContextMenu>
            <ContextMenu.Items>{menu}</ContextMenu.Items>
            <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
          </ContextMenu>
        ) : (
          row
        )}
      </Host>
      <View style={styles.rule} />
    </View>
  );
}

/** A write the engine refused or that never arrived; a conflict offers to throw the edit away and read the file again. */
export function ProblemBanner({ message, onReread }: { message: string; onReread?: (() => void) | undefined }) {
  return (
    <View style={styles.banner}>
      <Host matchContents>
        <Icon name="exclamationmark.triangle" textStyle="caption" color={Theme.red} />
      </Host>
      <Text style={styles.bannerText}>{message}</Text>
      {onReread ? (
        <Text style={styles.reread} onPress={onReread} accessibilityRole="button">
          Re-read from disk
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, backgroundColor: faded("red", 0.08) },
  bannerText: { flex: 1, fontSize: 13, color: Theme.red },
  reread: { fontSize: 13, fontWeight: "500", color: Theme.text },
});
