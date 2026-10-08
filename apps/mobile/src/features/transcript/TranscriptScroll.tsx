import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type ScrollViewInstance } from "react-native";
import type { JournalTurn } from "@telar/client/journal";
import { FOLLOWING, scrolled, shouldFollow, showsJump, type Follow } from "./follow";
import { Transcript } from "./Transcript";
import { Symbol, TextSize, Theme } from "./temp-ui";

type Props = {
  turns: readonly JournalTurn[];
  loading: boolean;
  older?: { loading: boolean; load: () => void } | undefined;
  /** Bumped when the phone sends, so the transcript jumps back to the tail. */
  pin: number;
  children?: ReactNode;
};

const metricsOf = ({ contentOffset, layoutMeasurement, contentSize }: NativeScrollEvent) => ({ offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height });

/** The transcript follows its tail until the reader scrolls up; a jump button brings it back. */
export function TranscriptScroll({ turns, loading, older, pin, children }: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const follow = useRef<Follow>(FOLLOWING);
  const dragging = useRef(false);
  const [jump, setJump] = useState(false);

  const update = (next: Follow) => {
    follow.current = next;
    setJump(showsJump(next));
  };
  const pinToTail = (animated = false) => {
    update(FOLLOWING);
    scroll.current?.scrollToEnd({ animated });
  };
  useEffect(() => {
    if (pin) pinToTail();
  }, [pin]);

  return (
    <View style={styles.frame}>
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        maintainVisibleContentPosition={{ minIndexForVisible: older ? 1 : 0 }}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => (dragging.current = true)}
        onScrollEndDrag={() => (dragging.current = false)}
        onScroll={({ nativeEvent }) => update(scrolled(follow.current, metricsOf(nativeEvent), dragging.current))}
        onContentSizeChange={() => {
          if (shouldFollow(follow.current)) pinToTail();
        }}
      >
        {older ? (
          <Pressable onPress={older.load} disabled={older.loading} style={styles.older} accessibilityRole="button">
            <Text style={styles.olderLabel}>{older.loading ? "Loading earlier turns…" : "Load earlier turns"}</Text>
          </Pressable>
        ) : null}
        {loading ? <ActivityIndicator style={styles.loading} /> : null}
        <Transcript turns={turns} />
        {children}
      </ScrollView>
      {jump ? (
        <Pressable onPress={() => pinToTail(true)} style={styles.jump} accessibilityRole="button" accessibilityLabel="Scroll to the newest message">
          <Symbol name="arrow.down" size={14} weight="semibold" color={Theme.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  scroll: { flex: 1 },
  content: { gap: 16, paddingHorizontal: 12, paddingVertical: 12 },
  loading: { marginTop: 40 },
  older: { alignSelf: "center", height: 32, paddingHorizontal: 14, justifyContent: "center", borderRadius: 16, borderWidth: 1, borderColor: Theme.border, backgroundColor: Theme.subtle },
  olderLabel: { fontSize: TextSize.footnote, fontWeight: "500", color: Theme.textMuted },
  jump: {
    position: "absolute", right: 16, bottom: 12, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: Theme.card, borderWidth: 1, borderColor: Theme.border,
    shadowColor: "black", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
});
