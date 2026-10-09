import { memo, useRef } from "react";
import { ScrollView, StyleSheet, Text, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { Theme } from "../../ui";

const MONO = "ui-monospace";
const PINNED_SLACK = 24;

/** The terminal's text on the code background, kept scrolled to the bottom unless the person scrolled up. */
export const TerminalOutput = memo(function TerminalOutput({ text, dropped }: { text: string; dropped: boolean }) {
  const scroll = useRef<ScrollViewInstance>(null);
  const pinned = useRef(true);
  const onScroll = ({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }: NativeSyntheticEvent<NativeScrollEvent>) => {
    pinned.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - PINNED_SLACK;
  };
  return (
    <ScrollView
      ref={scroll}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      onScroll={onScroll}
      scrollEventThrottle={100}
      onContentSizeChange={() => pinned.current && scroll.current?.scrollToEnd({ animated: false })}
      keyboardDismissMode="interactive"
    >
      {dropped ? <Text style={styles.dropped}>Earlier output is no longer kept.</Text> : null}
      <Text style={styles.text} selectable>
        {text || " "}
      </Text>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Theme.codeBackground },
  content: { padding: 12, gap: 8 },
  dropped: { fontSize: 12, color: Theme.textMuted },
  text: { fontFamily: MONO, fontSize: 12, lineHeight: 16, color: Theme.text },
});
