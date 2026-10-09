import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, LayoutAnimation, PanResponder, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { faded, Theme } from "../../ui";
import { clampPanelWidth } from "./panel-width";

type Props = { shown: boolean; full: boolean; width: number; onWidth: (width: number) => void; total: number; panel: ReactNode };

const STEP = 40;
const SNAPPY = LayoutAnimation.create(300, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);

// The drag moves only this handle's transform; the columns re-lay out once, on release, so the transcript never re-measures mid-drag.
function Handle({ width, total, onWidth }: { width: number; total: number; onWidth: (width: number) => void }) {
  const start = useRef<number | undefined>(undefined);
  const offset = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ width, total, onWidth, last: width });
  latest.current = { ...latest.current, width, total, onWidth };
  const end = () => {
    if (start.current === undefined) return;
    start.current = undefined;
    latest.current.onWidth(latest.current.last);
    offset.setValue(0);
    setDragging(false);
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dx }) => Math.abs(dx) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = clampPanelWidth(latest.current.width, latest.current.total);
        latest.current.last = start.current;
        setDragging(true);
      },
      onPanResponderMove: (_, { dx }) => {
        const from = start.current ?? latest.current.width;
        const next = clampPanelWidth(from - dx, latest.current.total);
        latest.current.last = next;
        offset.setValue(from - next);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    }),
  ).current;
  const shown = clampPanelWidth(width, total);
  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.handle, { transform: [{ translateX: offset }] }]}
      accessible
      accessibilityLabel="Panel width"
      accessibilityRole="adjustable"
      accessibilityValue={{ text: `${Math.round(shown)} points` }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={({ nativeEvent }) => onWidth(clampPanelWidth(shown + (nativeEvent.actionName === "increment" ? STEP : -STEP), total))}
    >
      {dragging ? <View style={styles.guide} /> : null}
      <View style={[styles.grip, { backgroundColor: faded("textMuted", dragging ? 0.7 : 0.35) }]} />
    </Animated.View>
  );
}

/** The panel beside the session at regular width, on a hairline: the chat narrows as the column slides in from the trailing edge. */
export function PanelColumn({ shown, full, width, onWidth, total, panel }: Props) {
  const top = useSafeAreaInsets().top;
  const [drawn, setDrawn] = useState({ shown, full });
  const [mounted, setMounted] = useState(shown);
  const wanted = useRef(shown);
  wanted.current = shown;
  useLayoutEffect(() => {
    if (drawn.shown === shown && drawn.full === full) return;
    LayoutAnimation.configureNext(SNAPPY, () => setMounted(wanted.current));
    if (shown) setMounted(true);
    setDrawn({ shown, full });
  }, [shown, full]);
  const column = clampPanelWidth(width, total);
  const covers = drawn.shown && drawn.full;
  return mounted || drawn.shown ? (
    <View style={covers ? styles.cover : { width: drawn.shown ? column : 0 }} accessibilityElementsHidden={!drawn.shown} importantForAccessibility={drawn.shown ? "auto" : "no-hide-descendants"}>
      <View style={styles.clip}>
        <View style={[styles.column, styles.surface, { width: covers ? total : column, paddingTop: top + 4 }]}>{panel}</View>
      </View>
      {covers ? null : <Handle width={width} total={total} onWidth={onWidth} />}
    </View>
  ) : null;
}

const styles = StyleSheet.create({
  clip: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, overflow: "hidden" },
  cover: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  column: { flex: 1 },
  surface: { backgroundColor: Theme.canvas, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: Theme.border },
  handle: { position: "absolute", left: 0, top: 0, bottom: 0, width: 16, alignItems: "center", justifyContent: "center" },
  grip: { width: 4, height: 36, borderRadius: 2 },
  guide: { position: "absolute", top: 0, bottom: 0, left: 7, width: 2, backgroundColor: Theme.accent },
});
