import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type ScrollViewInstance } from "react-native";
import type { JournalTurn } from "@telar/client/journal";
import { FOLLOWING, scrolled, shouldFollow, showsJump, type Follow } from "./follow";
import { SourceContext, type TranscriptSource } from "./source";
import { Transcript } from "./Transcript";
import { ReadingColumn } from "../../platform/layout";
import { Theme } from "../../ui";
import { Symbol, TextSize } from "./native";

type Props = {
  turns: readonly JournalTurn[];
  loading: boolean;
  older?: { loading: boolean; load: () => void } | undefined;
  /** Bumped when the phone sends, so the transcript jumps back to the tail. */
  pin: number;
  /** Where artifacts read their content. */
  source?: TranscriptSource | undefined;
  /** Height of whatever floats over the transcript's bottom edge (the composer). */
  bottomInset?: number;
  children?: ReactNode;
};

// Swift's 12pt column padding plus the read-receipt marker and stack spacing after the last turn.
const TAIL_GAP = 28;

const metricsOf = ({ contentOffset, layoutMeasurement, contentSize }: NativeScrollEvent) => ({ offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height });

/** The transcript follows its tail until the reader scrolls up; a jump button brings it back. */
export function TranscriptScroll({ turns, loading, older, pin, source, bottomInset = 0, children }: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const follow = useRef<Follow>(FOLLOWING);
  const dragging = useRef(false);
  const viewport = useRef(0);
  const content = useRef(0);
  const [jump, setJump] = useState(false);

  const update = (next: Follow) => {
    follow.current = next;
    setJump(showsJump(next));
  };
  // A transcript shorter than the screen stays at its resting offset; scrollToEnd would clamp to 0 and tuck its top under the bar.
  const pinToTail = (animated = false) => {
    update(FOLLOWING);
    if (content.current > viewport.current) scroll.current?.scrollToEnd({ animated });
  };
  useEffect(() => {
    if (pin) pinToTail();
  }, [pin]);

  return (
    <View style={styles.frame}>
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: TAIL_GAP + bottomInset }]}
        scrollIndicatorInsets={{ bottom: bottomInset }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        maintainVisibleContentPosition={{ minIndexForVisible: older ? 1 : 0 }}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => (dragging.current = true)}
        onScrollEndDrag={() => (dragging.current = false)}
        onScroll={({ nativeEvent }) => update(scrolled(follow.current, metricsOf(nativeEvent), dragging.current))}
        onLayout={({ nativeEvent }) => (viewport.current = nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => {
          content.current = height;
          if (shouldFollow(follow.current)) pinToTail();
        }}
      >
        {older ? (
          <Pressable onPress={older.load} disabled={older.loading} style={styles.older} accessibilityRole="button">
            <Text style={styles.olderLabel}>{older.loading ? "Loading earlier turns…" : "Load earlier turns"}</Text>
          </Pressable>
        ) : null}
        {loading ? <ActivityIndicator style={styles.loading} /> : null}
        <ReadingColumn style={styles.lane}>
          <SourceContext.Provider value={source}>
            <Transcript turns={turns} />
          </SourceContext.Provider>
          {children}
        </ReadingColumn>
      </ScrollView>
      {jump ? (
        <Pressable onPress={() => pinToTail(true)} style={[styles.jump, { bottom: 12 + bottomInset }]} accessibilityRole="button" accessibilityLabel="Scroll to the newest message">
          <Symbol name="arrow.down" size={14} weight="semibold" color={Theme.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  scroll: { flex: 1 },
  content: { gap: 16, paddingVertical: 12 },
  lane: { gap: 16, paddingHorizontal: 12 },
  loading: { marginTop: 40 },
  older: { alignSelf: "center", height: 32, paddingHorizontal: 14, justifyContent: "center", borderRadius: 16, borderWidth: 1, borderColor: Theme.border, backgroundColor: Theme.subtle },
  olderLabel: { fontSize: TextSize.footnote, fontWeight: "500", color: Theme.textMuted },
  jump: {
    position: "absolute", right: 16, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: Theme.card, borderWidth: 1, borderColor: Theme.border,
    shadowColor: "black", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
});
