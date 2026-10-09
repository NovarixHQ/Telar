import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, LayoutAnimation, type KeyboardEvent } from "react-native";
import { keyboardOverlap } from "./keyboard-overlap";

/** Whether the software keyboard is up, flipping as it starts to move so a footer can drop its home-indicator inset in step. */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", () => setShown(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setShown(false));
    return () => (show.remove(), hide.remove());
  }, []);
  return shown;
}

/** How many points the keyboard covers at the window's bottom; the change animates with the keyboard's own curve. */
export function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const change = ({ endCoordinates, duration, easing }: KeyboardEvent) => {
      const next = keyboardOverlap(endCoordinates, Dimensions.get("window"));
      if (next === current.current) return;
      current.current = next;
      if (duration > 0) LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types[easing] ?? LayoutAnimation.Types.keyboard } });
      setOverlap(next);
    };
    const frame = Keyboard.addListener("keyboardWillChangeFrame", change);
    const hide = Keyboard.addListener("keyboardWillHide", change);
    return () => (frame.remove(), hide.remove());
  }, []);
  return overlap;
}
