import { Button } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle } from "@expo/ui/swift-ui/modifiers";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from "react-native";
import WebView from "react-native-webview";
import type { HostConnection } from "../../platform/connection";
import { EmptyState, Icon, Theme } from "../../ui";
import { AddressRow } from "./address-row";
import { humanBytes } from "./tree";

const describe = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));
const DOUBLE_TAP_MS = 300;
let written = 0;

/** The raw bytes are written to the app's cache so the native viewers read a file rather than a giant data URL. */
async function cached(bytes: Uint8Array, path: string): Promise<File> {
  const file = new File(Paths.cache, `panel-${Date.now()}-${(written += 1)}-${path.slice(path.lastIndexOf("/") + 1)}`);
  file.create({ overwrite: true });
  await file.write(bytes);
  return file;
}

function useCachedFile() {
  const current = useRef<File>(undefined);
  const drop = () => {
    try {
      current.current?.delete();
    } catch {}
  };
  useEffect(() => drop, []);
  return async (bytes: Uint8Array, path: string) => {
    const next = await cached(bytes, path);
    drop();
    current.current = next;
    return next.uri;
  };
}

function Frame({ path, detail, trailing, children }: { path: string; detail?: string | undefined; trailing?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.fill}>
      <AddressRow path={path} detail={detail} trailing={trailing} />
      {children}
    </View>
  );
}

/** A picture fitted to the panel's width; pinch zooms up to 8×, a double tap goes back to fit. */
export function ImageFileView({ host, sessionId, path }: { host: HostConnection; sessionId: string; path: string }) {
  const [image, setImage] = useState<{ uri: string; width: number; height: number; bytes: number }>();
  const [error, setError] = useState<string>();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [fitted, setFitted] = useState(0);
  const lastTap = useRef(0);
  const store = useCachedFile();

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await host.call(true, () => host.client.sessionFileBytes(sessionId, path));
      const uri = await store(data, path);
      const size = await Image.getSize(uri).catch(() => undefined);
      if (!live) return;
      if (!size) return setError("The bytes are not an image this device can decode.");
      setImage({ uri, width: size.width, height: size.height, bytes: data.length });
    })().catch((failure: unknown) => live && setError(describe(failure)));
    return () => {
      live = false;
    };
  }, [host, sessionId, path]);

  const scale = image && viewport.width > 0 ? Math.min(1, viewport.width / image.width) : 1;
  return (
    <Frame path={path} detail={image ? humanBytes(image.bytes) : undefined}>
      {image ? (
        <ScrollView
          key={fitted}
          style={styles.fill}
          contentContainerStyle={{ minWidth: viewport.width, minHeight: viewport.height, alignItems: "center", justifyContent: "center" }}
          minimumZoomScale={1}
          maximumZoomScale={8}
          bouncesZoom
          centerContent
          showsHorizontalScrollIndicator={false}
          onLayout={({ nativeEvent }) => setViewport(nativeEvent.layout)}
          onTouchEnd={() => {
            const now = Date.now();
            if (now - lastTap.current < DOUBLE_TAP_MS) setFitted((count) => count + 1);
            lastTap.current = now;
          }}
          accessibilityLabel="Image, pinch to zoom"
        >
          <Image source={{ uri: image.uri }} style={{ width: image.width * scale, height: image.height * scale }} />
        </ScrollView>
      ) : error ? (
        <EmptyState icon="xmark.circle" title="Could not read this file" detail={error} />
      ) : (
        <ActivityIndicator style={styles.fill} />
      )}
    </Frame>
  );
}

/** A PDF drawn by the system viewer; the reload button reads it again when it changed on disk. */
export function PdfFileView({ host, sessionId, path }: { host: HostConnection; sessionId: string; path: string }) {
  const [document, setDocument] = useState<{ uri: string; sha256: string }>();
  const [bytes, setBytes] = useState<number>();
  const [error, setError] = useState<string>();
  const loaded = useRef<string>(undefined);
  const store = useCachedFile();

  const load = useCallback(
    async (force: boolean) => {
      try {
        const { file } = await host.call(true, () => host.client.sessionFile(sessionId, path));
        setBytes(file.bytes);
        if (!force && file.sha256 === loaded.current) return;
        const { data } = await host.call(true, () => host.client.sessionFileBytes(sessionId, path));
        const uri = await store(data, path);
        loaded.current = file.sha256;
        setDocument({ uri, sha256: file.sha256 });
        setError(undefined);
      } catch (failure) {
        setError(describe(failure));
      }
    },
    [host, sessionId, path],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const reload = (
    <Button onPress={() => void load(true)} modifiers={[buttonStyle("plain"), accessibilityLabel("Reload PDF")]}>
      <Icon name="arrow.clockwise" textStyle="caption" color={Theme.textMuted} />
    </Button>
  );
  return (
    <Frame path={path} detail={bytes === undefined ? undefined : humanBytes(bytes)} trailing={reload}>
      {document ? (
        <WebView
          key={document.uri}
          source={{ uri: document.uri }}
          originWhitelist={["file://*"]}
          allowingReadAccessToURL={Paths.cache.uri}
          onError={({ nativeEvent }) => setError(nativeEvent.description || "The bytes are not a PDF this device can open.")}
          style={styles.pdf}
          containerStyle={styles.fill}
          dataDetectorTypes="none"
          allowsLinkPreview={false}
        />
      ) : error ? (
        <EmptyState icon="xmark.circle" title="Could not read this file" detail={error} />
      ) : (
        <ActivityIndicator style={styles.fill} />
      )}
    </Frame>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pdf: { flex: 1, backgroundColor: Theme.canvas },
});
