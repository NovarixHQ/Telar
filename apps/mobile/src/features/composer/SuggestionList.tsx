import { Host } from "@expo/ui/swift-ui";
import { Fragment } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Glass } from "./chrome";
import type { Completion } from "./completions";
import { faded, Icon, Theme, type SymbolName } from "../../ui";

type Props = { rows: Completion[]; loading: boolean; onPick: (row: Completion) => void };

/** The glass popover over the field for `/`, `$` and `@`; the first row is the one Return would take. */
export function SuggestionList({ rows, loading, onPick }: Props) {
  return (
    <View style={styles.popover}>
      <Glass radius={18} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="always" bounces={false}>
        {rows.map((row, index) => (
          <Fragment key={row.id}>
            {index === 0 || rows[index - 1]!.group !== row.group ? (
              <Text style={styles.header} accessibilityRole="header">
                {row.group.toUpperCase()}
              </Text>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityHint={row.detail} onPress={() => onPick(row)} style={[styles.row, index === 0 && styles.active]}>
              <Host matchContents style={styles.symbol}>
                <Icon name={row.symbol as SymbolName} textStyle="footnote" color={Theme.textMuted} />
              </Host>
              <View style={styles.text}>
                <Text style={styles.label} numberOfLines={1}>{row.label}</Text>
                {row.detail ? <Text style={styles.detail} numberOfLines={1}>{row.detail}</Text> : null}
              </View>
            </Pressable>
          </Fragment>
        ))}
        {loading ? <Text style={[styles.detail, styles.loading]}>Reading skills…</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  popover: { marginBottom: 8, borderRadius: 18 },
  scroll: { maxHeight: 260, flexGrow: 0 },
  content: { paddingVertical: 6 },
  header: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, fontSize: 12, fontWeight: "600", color: Theme.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  active: { backgroundColor: faded("accent", 0.14) },
  symbol: { width: 18, alignItems: "center" },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: "500", color: Theme.text },
  detail: { fontSize: 13, color: Theme.textMuted },
  loading: { paddingHorizontal: 14, paddingVertical: 10 },
});
