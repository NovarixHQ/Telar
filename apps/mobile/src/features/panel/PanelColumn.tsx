import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, View } from "react-native";
import { faded, Theme } from "../../ui";
import { clampPanelWidth } from "./panel-width";

type Props = { shown: boolean; full: boolean; width: number; onWidth: (width: number) => void; top: number | Animated.Value | Animated.AnimatedInterpolation<number>; panel: ReactNode; children: ReactNode };

const STEP = 40;

function Handle({ width, total, onWidth }: { width: number; total: number; onWidth: (width: number) => void }) {
  const start = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ width, total, onWidth });
  latest.current = { width, total, onWidth };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dx }) => Math.abs(dx) > 2,
      onPanResponderGrant: () => {
        start.current = clampPanelWidth(latest.current.width, latest.current.total);
        setDragging(true);
      },
      onPanResponderMove: (_, { dx }) => latest.current.onWidth(clampPanelWidth((start.current ?? latest.current.width) - dx, latest.current.total)),
      onPanResponderRelease: () => ((start.current = undefined), setDragging(false)),
      onPanResponderTerminate: () => ((start.current = undefined), setDragging(false)),
    }),
  ).current;
  const shown = clampPanelWidth(width, total);
  return (
    <View
      {...responder.panHandlers}
      style={styles.handle}
      accessible
      accessibilityLabel="Panel width"
      accessibilityRole="adjustable"
      accessibilityValue={{ text: `${Math.round(shown)} points` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={({ nativeEvent }) => onWidth(clampPanelWidth(shown + (nativeEvent.actionName === "increment" ? STEP : -STEP), total))}
    >
      <View style={[styles.grip, { backgroundColor: faded("textMuted", dragging ? 0.7 : 0.35) }]} />
    </View>
  );
}

export function PanelColumn({ shown, full, width, onWidth, top, panel, children }: Props) {
  const [total, setTotal] = useState(0);
  const [mounted, setMounted] = useState(shown);
  const progress = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    if (shown) setMounted(true);
    Animated.timing(progress, { toValue: shown ? 1 : 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !shown) setMounted(false);
    });
  }, [shown, progress]);
  const column = full ? total : clampPanelWidth(width, total);
  const hidden = shown && full;
  return (
    <View style={styles.row} onLayout={({ nativeEvent }) => setTotal(nativeEvent.layout.width)}>
      <Animated.View style={[styles.content, { width: total ? progress.interpolate({ inputRange: [0, 1], outputRange: [total, Math.max(0, total - column)] }) : "100%", opacity: hidden ? 0 : 1 }]} accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}>
        {children}
      </Animated.View>
      {mounted && total ? (
        <Animated.View style={[styles.column, { width: column, paddingTop: top, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [column, 0] }) }] }]}>
          {panel}
          <View style={styles.rule} pointerEvents="none" />
          {full ? null : <Handle width={width} total={total} onWidth={onWidth} />}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", overflow: "hidden" },
  content: { height: "100%" },
  column: { position: "absolute", top: 0, bottom: 0, right: 0, backgroundColor: Theme.sheet },
  rule: { position: "absolute", left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
  handle: { position: "absolute", left: 0, top: 0, bottom: 0, width: 16, alignItems: "center", justifyContent: "center" },
  grip: { width: 4, height: 36, borderRadius: 2 },
});
