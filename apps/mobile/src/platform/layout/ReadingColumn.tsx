import { useEffect, useState, type ReactNode } from "react";
import { Platform, Settings, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { CHAT_WIDTH_KEY, chatWidthOf, laneMaxWidth } from "./reading-column";
import { isRegularWidth } from "./size-class";

function useChatWidth() {
  const [width, setWidth] = useState(() => chatWidthOf(Settings.get(CHAT_WIDTH_KEY)));
  useEffect(() => {
    const watch = Settings.watchKeys(CHAT_WIDTH_KEY, () => setWidth(chatWidthOf(Settings.get(CHAT_WIDTH_KEY))));
    return () => Settings.clearWatch(watch);
  }, []);
  return width;
}

/** The chat's reading lane: centred and capped at the Chat width setting, like Swift's `readingColumn(margins:)`. */
export function ReadingColumn({ margins = 0, style, children }: { margins?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const setting = useChatWidth();
  const { width } = useWindowDimensions();
  const pad = Platform.OS === "ios" && Platform.isPad;
  const max = laneMaxWidth(setting, margins, pad && isRegularWidth(width, pad));
  return <View style={[styles.lane, { paddingHorizontal: margins }, Number.isFinite(max) ? { maxWidth: max } : null, style]}>{children}</View>;
}

const styles = StyleSheet.create({ lane: { width: "100%", alignSelf: "center" } });
