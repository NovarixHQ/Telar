import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { useContext, useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, useColorScheme, View } from "react-native";
import WebView from "react-native-webview";
import type { Artifact } from "@telar/engine-client";
import { palette, Theme } from "../../ui";
import { ARTIFACT_PROBE, artifactHeight, artifactHtml, artifactScrolls, parseProbe, type Probe } from "./artifact-document";
import { Markdown } from "./Markdown";
import { MONO, Symbol, TextSize } from "./native";
import { ArtifactVersions, attachmentText, SourceContext } from "./source";

type Load = { state: "loading" } | { state: "failed" } | { state: "loaded"; text: string };

function useArtifactText(artifact: Artifact): Load {
  const source = useContext(SourceContext);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    if (!source) return setLoad({ state: "failed" });
    let live = true;
    attachmentText(source, artifact.attachmentId).then(
      (text) => live && setLoad({ state: "loaded", text }),
      () => live && setLoad({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [source, artifact.attachmentId]);
  return load;
}

function ArtifactNotice({ text, desktop }: { text: string; desktop?: boolean }) {
  return (
    <View style={styles.notice}>
      {desktop ? <Symbol name="desktopcomputer" size={TextSize.caption} color={Theme.textMuted} /> : null}
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}

const desktopOnly = (kind: Artifact["kind"]) => <ArtifactNotice desktop text={kind === "mermaid" ? "Open on desktop to see this diagram." : "Open on desktop to see this artifact."} />;

function ArtifactPage({ text, kind, scrolls, onProbe }: { text: string; kind: Artifact["kind"]; scrolls: boolean; onProbe?: (probe: Probe) => void }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <WebView
      originWhitelist={["*"]}
      source={{ html: artifactHtml(text, kind, scheme, palette) }}
      injectedJavaScript={ARTIFACT_PROBE}
      onMessage={({ nativeEvent }) => {
        const probe = parseProbe(nativeEvent.data);
        if (probe) onProbe?.(probe);
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === "about:blank" || request.url.startsWith("data:") || !request.isTopFrame) return true;
        if (request.navigationType === "click" && /^https?:/.test(request.url)) void Linking.openURL(request.url);
        return false;
      }}
      scrollEnabled={scrolls}
      bounces={false}
      style={styles.web}
      containerStyle={styles.web}
      contentInsetAdjustmentBehavior="never"
      dataDetectorTypes="none"
      allowsLinkPreview={false}
      incognito
    />
  );
}

function ArtifactBody({ artifact }: { artifact: Artifact }) {
  const load = useArtifactText(artifact);
  const [probe, setProbe] = useState<Probe>();
  const height = artifactHeight(probe, artifact.height);
  if (load.state === "loading") return <View style={{ height }} />;
  if (load.state === "failed") return <ArtifactNotice text="This artifact could not be loaded." />;
  if (artifact.kind === "markdown") return <Markdown text={load.text} />;
  if (artifact.kind !== "html" && artifact.kind !== "svg") return desktopOnly(artifact.kind);
  return (
    <View style={{ height }}>
      <ArtifactPage text={load.text} kind={artifact.kind} scrolls={artifactScrolls(probe, artifact.height)} onProbe={setProbe} />
    </View>
  );
}

function ArtifactSheet({ artifact, open, onClose }: { artifact: Artifact; open: boolean; onClose: () => void }) {
  const load = useArtifactText(artifact);
  const [view, setView] = useState("rendered");
  const text = load.state === "loaded" ? load.text : undefined;
  const rendered = () => {
    if (!text) return <ArtifactNotice text={load.state === "failed" ? "This artifact could not be loaded." : "Loading…"} />;
    if (artifact.kind === "html" || artifact.kind === "svg") return <ArtifactPage text={text} kind={artifact.kind} scrolls />;
    if (artifact.kind === "markdown") return <ScrollView contentContainerStyle={styles.pad}><Markdown text={text} /></ScrollView>;
    return desktopOnly(artifact.kind);
  };
  return (
    <Modal visible={open} presentationStyle="fullScreen" animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.barButton}>Done</Text>
          </Pressable>
          <Host matchContents>
            <Picker selection={view} onSelectionChange={setView} modifiers={[pickerStyle("segmented")]}>
              <SwiftText modifiers={[tag("rendered")]}>Rendered</SwiftText>
              <SwiftText modifiers={[tag("source")]}>Source</SwiftText>
            </Picker>
          </Host>
          <Pressable onPress={() => text && void Share.share({ title: artifact.title, message: text })} hitSlop={12} disabled={!text} accessibilityRole="button" accessibilityLabel="Share">
            <Symbol name="square.and.arrow.up" size={TextSize.body} color={Theme.accent} />
          </Pressable>
        </View>
        <Text style={styles.sheetTitle} numberOfLines={1}>{artifact.title}</Text>
        {view === "source" && text ? (
          <ScrollView contentContainerStyle={styles.pad}>
            <Text selectable style={styles.source}>{text}</Text>
          </ScrollView>
        ) : (
          <View style={styles.fill}>{rendered()}</View>
        )}
      </View>
    </Modal>
  );
}

/** Something an agent drew inline (display_* tools): the page itself, or a desktop-only notice, with an expand button. */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const versions = useContext(ArtifactVersions);
  const [expanded, setExpanded] = useState(false);
  if ((versions.get(artifact.id) ?? artifact.version) > artifact.version) return <Text style={styles.meta}>{`${artifact.title} · updated below`}</Text>;
  return (
    <View accessibilityLabel={artifact.title}>
      <ArtifactBody artifact={artifact} />
      <Pressable onPress={() => setExpanded(true)} style={styles.expand} accessibilityRole="button" accessibilityLabel={`Open ${artifact.title} full screen`}>
        <Symbol name="arrow.up.left.and.arrow.down.right" size={TextSize.caption} weight="medium" color={Theme.textMuted} />
      </Pressable>
      <ArtifactSheet artifact={artifact} open={expanded} onClose={() => setExpanded(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingRight: 40 },
  meta: { fontSize: TextSize.caption, color: Theme.textMuted },
  web: { flex: 1, backgroundColor: "transparent" },
  expand: { position: "absolute", top: 6, right: 6, padding: 6, borderRadius: 14, backgroundColor: Theme.subtle },
  sheet: { flex: 1, paddingTop: 54, backgroundColor: Theme.canvas },
  bar: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  barButton: { fontSize: TextSize.body, color: Theme.accent },
  sheetTitle: { alignSelf: "center", paddingBottom: 8, fontSize: TextSize.footnote, fontWeight: "600", color: Theme.text },
  fill: { flex: 1 },
  pad: { padding: 16 },
  source: { fontFamily: MONO, fontSize: TextSize.caption, color: Theme.text },
});
