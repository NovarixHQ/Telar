import { BottomSheet, Button, RNHostView, Text, VStack } from "@expo/ui/swift-ui";
import { background, buttonStyle, font, foregroundStyle, frame, padding } from "@expo/ui/swift-ui/modifiers";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type GestureResponderEvent } from "react-native";
import { Theme, Type } from "../../ui";
import { pinchZoom, scanGate, touchSpread } from "./scan-gate";

type Ring = { x: number; y: number; key: number };

/** The yellow 72pt square Swift flashes where the person tapped to focus. */
function FocusRing({ ring }: { ring: Ring }) {
  return <View pointerEvents="none" style={[styles.ring, { left: ring.x - 36, top: ring.y - 36 }]} />;
}

function Preview({ onScan }: { onScan: (payload: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [zoom, setZoom] = useState(0);
  const [focus, setFocus] = useState<"on" | "off">("off");
  const [ring, setRing] = useState<Ring>();
  const pinch = useRef<{ spread: number; zoom: number } | undefined>(undefined);
  const moved = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!ring) return;
    const timer = setTimeout(() => setRing(undefined), 900);
    return () => clearTimeout(timer);
  }, [ring]);

  useEffect(() => {
    if (focus === "off") return;
    const timer = setTimeout(() => setFocus("off"), 400);
    return () => clearTimeout(timer);
  }, [focus]);

  const touches = (event: GestureResponderEvent) => event.nativeEvent.touches;
  const onStart = (event: GestureResponderEvent) => {
    moved.current = false;
    const spread = touchSpread(touches(event));
    pinch.current = spread ? { spread, zoom } : undefined;
  };
  const onMove = (event: GestureResponderEvent) => {
    const spread = touchSpread(touches(event));
    if (!spread) return;
    moved.current = true;
    pinch.current ??= { spread, zoom };
    setZoom(pinchZoom(pinch.current.zoom, spread / pinch.current.spread));
  };
  const onEnd = (event: GestureResponderEvent) => {
    if (touches(event).length > 0) return;
    pinch.current = undefined;
    if (moved.current) return;
    const { locationX: x, locationY: y } = event.nativeEvent;
    setRing({ x, y, key: Date.now() });
    // expo-camera takes no focus point; a one-shot autofocus makes the lens refocus now.
    setFocus("on");
  };

  return (
    <View
      style={styles.preview}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={onStart}
      onResponderMove={onMove}
      onResponderRelease={onEnd}
    >
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          zoom={zoom}
          autofocus={focus}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }: BarcodeScanningResult) => onScan(data)}
        />
      ) : null}
      {ring ? <FocusRing key={ring.key} ring={ring} /> : null}
    </View>
  );
}

/** A sheet of full-bleed camera that hands back the first pairing link it reads, with Swift's bottom bar. Place it inside a SwiftUI host. */
export function QRScanner({ visible, onPaired, onClose }: { visible: boolean; onPaired: (link: string) => void; onClose: () => void }) {
  const [rejected, setRejected] = useState(false);
  const gate = useRef(scanGate());

  useEffect(() => {
    if (!visible) return;
    gate.current = scanGate();
    setRejected(false);
  }, [visible]);

  const onScan = (payload: string) => {
    const verdict = gate.current(payload);
    if (verdict === "reject") setRejected(true);
    if (verdict !== "accept") return;
    onPaired(payload);
    onClose();
  };

  return (
    <BottomSheet isPresented={visible} onIsPresentedChange={(presented) => !presented && onClose()}>
      <VStack spacing={0}>
        <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          <RNHostView>{visible ? <Preview onScan={onScan} /> : <View />}</RNHostView>
        </VStack>
        <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 10 }), background(Theme.canvas)]}>
          {rejected ? <Text modifiers={[Type.meta, foregroundStyle(Theme.amber)]}>That code is not a Telar pairing link.</Text> : null}
          <Text modifiers={[Type.metaSmall, foregroundStyle(Theme.textMuted)]}>Pinch to zoom · tap to focus and expose</Text>
          <Button label="Cancel" onPress={onClose} modifiers={[buttonStyle("borderless"), font({ textStyle: "body", weight: "medium" }), padding({ vertical: 8 })]} />
        </VStack>
      </VStack>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  ring: { position: "absolute", width: 72, height: 72, borderWidth: 1.5, borderRadius: 8, borderColor: "#FFCC00" },
});
