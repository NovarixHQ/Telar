import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

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
