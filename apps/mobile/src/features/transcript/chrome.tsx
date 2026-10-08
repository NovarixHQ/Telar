import { Button, ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import { setStringAsync } from "expo-clipboard";
import type { ReactElement, ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Radius, Theme, faded, type SymbolName } from "../../ui";
import { MONO, TextSize } from "./native";

export type MenuAction = { label: string; icon: SymbolName; onPress: () => void };

export const copyAction = (label: string, text: string): MenuAction => ({ label, icon: "doc.on.doc", onPress: () => void setStringAsync(text) });

/** The native long-press menu (SwiftUI's .contextMenu) around React Native content. */
export function LongPressMenu({ actions, children }: { actions: MenuAction[]; children: ReactElement }) {
  if (!actions.length) return children;
  return (
    <Host matchContents={{ vertical: true }} style={styles.fill}>
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((action) => <Button key={action.label} label={action.label} systemImage={action.icon} onPress={action.onPress} />)}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents={{ vertical: true }}>{children}</RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
}

/** Swift's CodeBlockView: caption mono on codeBackground, scrolling sideways, copyable on long press. */
export function CodeBlockView({ code }: { code: string }) {
  return (
    <LongPressMenu actions={[copyAction("Copy", code)]}>
      <View style={styles.code}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codePad}>
          <Text selectable style={styles.codeText}>{code}</Text>
        </ScrollView>
      </View>
    </LongPressMenu>
  );
}

/** A page sheet with an inline title and a Done button, as Swift's NavigationStack sheets. */
export function PageSheet({ title, open, onClose, children, scrolls = true }: { title: string; open: boolean; onClose: () => void; children: ReactNode; scrolls?: boolean }) {
  return (
    <Modal visible={open} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" style={styles.done}>
            <Text style={styles.doneLabel}>Done</Text>
          </Pressable>
        </View>
        {scrolls ? <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView> : children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%" },
  code: { backgroundColor: Theme.codeBackground, borderRadius: Radius.row, borderWidth: 1, borderColor: faded("border", 0.6), overflow: "hidden" },
  codePad: { padding: 10 },
  codeText: { fontFamily: MONO, fontSize: TextSize.caption, color: Theme.text },
  sheet: { flex: 1, backgroundColor: Theme.canvas },
  bar: { height: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 72 },
  title: { fontSize: TextSize.body, fontWeight: "600", color: Theme.text },
  done: { position: "absolute", right: 16 },
  doneLabel: { fontSize: TextSize.body, fontWeight: "600", color: Theme.accent },
  body: { padding: 16, gap: 12 },
});
