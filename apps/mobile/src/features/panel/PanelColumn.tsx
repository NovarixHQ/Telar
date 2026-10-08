import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LayoutAnimation, PanResponder, StyleSheet, View } from "react-native";
import { faded, Theme } from "../../ui";
import { clampPanelWidth } from "./panel-width";

type Props = { shown: boolean; full: boolean; width: number; onWidth: (width: number) => void; top: number; panel: ReactNode; children: ReactNode };

const STEP = 40;
const SNAPPY = LayoutAnimation.create(300, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);

function Handle({ width, total, onDrag, onWidth }: { width: number; total: number; onDrag: (width: number | undefined) => void; onWidth: (width: number) => void }) {
  const start = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ width, total, onDrag, onWidth, last: width });
  latest.current = { ...latest.current, width, total, onDrag, onWidth };
  const end = () => {
    if (start.current === undefined) return;
    start.current = undefined;
    setDragging(false);
    latest.current.onWidth(latest.current.last);
    latest.current.onDrag(undefined);
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dx }) => Math.abs(dx) > 2,
      onPanResponderGrant: () => {
        start.current = clampPanelWidth(latest.current.width, latest.current.total);
        latest.current.last = start.current;
        setDragging(true);
      },
      onPanResponderMove: (_, { dx }) => {
        const next = clampPanelWidth((start.current ?? latest.current.width) - dx, latest.current.total);
        latest.current.last = next;
        latest.current.onDrag(next);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
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

/** The panel beside the session at regular width: the chat narrows as the column slides in from the trailing edge. */
export function PanelColumn({ shown, full, width, onWidth, top, panel, children }: Props) {
  const [total, setTotal] = useState(0);
  const [drawn, setDrawn] = useState({ shown, full });
  const [mounted, setMounted] = useState(shown);
  const [dragged, setDragged] = useState<number>();
  const wanted = useRef(shown);
  wanted.current = shown;
  useLayoutEffect(() => {
    if (drawn.shown === shown && drawn.full === full) return;
    LayoutAnimation.configureNext(SNAPPY, () => setMounted(wanted.current));
    if (shown) setMounted(true);
    setDrawn({ shown, full });
  }, [shown, full]);
  const column = clampPanelWidth(dragged ?? width, total);
  const covers = drawn.shown && drawn.full;
  return (
    <View style={styles.row} onLayout={({ nativeEvent }) => setTotal(nativeEvent.layout.width)}>
      <View style={[styles.content, covers && styles.hidden]} accessibilityElementsHidden={covers} importantForAccessibility={covers ? "no-hide-descendants" : "auto"}>
        {children}
      </View>
      {(mounted || drawn.shown) && total ? (
        <View
          style={covers ? styles.cover : [styles.clip, { width: drawn.shown ? column : 0 }]}
          accessibilityElementsHidden={!drawn.shown}
          importantForAccessibility={drawn.shown ? "auto" : "no-hide-descendants"}
        >
          <View style={[styles.column, { width: covers ? total : column, paddingTop: top }]}>
            {panel}
            <View style={styles.rule} pointerEvents="none" />
            {covers ? null : <Handle width={width} total={total} onDrag={setDragged} onWidth={onWidth} />}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", overflow: "hidden" },
  content: { flex: 1 },
  hidden: { opacity: 0 },
  clip: { overflow: "hidden" },
  cover: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
  column: { flex: 1, backgroundColor: Theme.sheet },
  rule: { position: "absolute", left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: faded("border", 0.6) },
  handle: { position: "absolute", left: 0, top: 0, bottom: 0, width: 16, alignItems: "center", justifyContent: "center" },
  grip: { width: 4, height: 36, borderRadius: 2 },
});
