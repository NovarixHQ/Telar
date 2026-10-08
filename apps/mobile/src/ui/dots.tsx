import { Circle } from "@expo/ui/swift-ui";
import { accessibilityLabel, foregroundStyle, frame, opacity } from "@expo/ui/swift-ui/modifiers";
import type { SessionActivity } from "@telar/engine-client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, type ColorValue } from "react-native";
import { faded, Theme } from "./theme";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((notify) => notify()), 1000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const evenSecond = () => Math.floor(Date.now() / 1000) % 2 === 0;

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => subscription.remove();
  }, []);
  return reduce;
}

/** 7pt dot stepping between full and half opacity once a second, in step with every other dot. */
export function SteppedPulseDot({ color = Theme.sky }: { color?: ColorValue }) {
  const reduce = useReduceMotion();
  const even = useSyncExternalStore(reduce ? () => () => {} : subscribe, evenSecond);
  return <Circle modifiers={[foregroundStyle(color), frame({ width: 7, height: 7 }), opacity(reduce || even ? 1 : 0.5)]} />;
}

const badgeColor = (activity: SessionActivity): ColorValue =>
  activity === "blocked" ? Theme.amber : activity === "working" || activity === "queued" || activity === "monitoring" ? Theme.sky : faded("textMuted", 0.4);

export function ActivityBadge({ activity }: { activity: SessionActivity }) {
  return <Circle modifiers={[foregroundStyle(badgeColor(activity)), frame({ width: 7, height: 7 }), accessibilityLabel(activity)]} />;
}
