import { createContext, useContext } from "react";
import { StyleSheet, View, type HostInstance } from "react-native";

/** The newest answer's turn and where its marker sits, so the scroll can tell when that answer is on screen. */
export type ReceiptMarkerSlot = { runId: string; mount(node: HostInstance | null): void; moved(): void };

export const ReceiptMarkerContext = createContext<ReceiptMarkerSlot | undefined>(undefined);

/** A hairline at the bottom of a turn, drawn only for the turn the receipt is waiting on. */
export function ReceiptMarker({ runId }: { runId: string }) {
  const slot = useContext(ReceiptMarkerContext);
  if (slot?.runId !== runId) return null;
  return <View ref={slot.mount} onLayout={slot.moved} pointerEvents="none" style={styles.marker} />;
}

const styles = StyleSheet.create({ marker: { position: "absolute", left: 0, right: 0, bottom: 0, height: 1 } });
