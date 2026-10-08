import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { WorkspaceFile } from "@telar/engine-client";
import { fileKind } from "@telar/client/files";
import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Button, FlatList, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts, useHosts } from "../hosts";

type Shown = { file: WorkspaceFile } | { image: string } | { failed: string };

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function Code({ text, wrap }: { text: string; wrap: boolean }) {
  const lines = text.split("\n");
  const list = (
    <FlatList
      data={lines}
      keyExtractor={(_, index) => String(index)}
      renderItem={({ item, index }) => (
        <View style={styles.line}>
          <Text style={styles.number}>{index + 1}</Text>
          <Text style={styles.code}>{item || " "}</Text>
        </View>
      )}
    />
  );
  return wrap ? list : <ScrollView horizontal>{list}</ScrollView>;
}

export function FileScreen() {
  const { params } = useRoute<RouteProp<RootStack, "File">>();
  const navigation = useNavigation();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const [shown, setShown] = useState<Shown>();
  const [wrap, setWrap] = useState(false);
  const kind = fileKind(params.path);

  useLayoutEffect(() => {
    navigation.setOptions({ title: params.path.split("/").at(-1), headerRight: () => <Button title={wrap ? "No wrap" : "Wrap"} onPress={() => setWrap(!wrap)} /> });
  }, [navigation, params.path, wrap]);

  useEffect(() => {
    if (!host) return;
    let live = true;
    const read =
      kind.media === "image"
        ? host.call(true, () => host.client.sessionFileBytes(params.sessionId, params.path)).then(({ data, contentType }) => ({ image: `data:${contentType};base64,${base64(data)}` }))
        : host.call(true, () => host.client.sessionFile(params.sessionId, params.path)).then(({ file }) => ({ file }));
    read.then((value) => live && setShown(value)).catch((error: unknown) => live && setShown({ failed: error instanceof Error ? error.message : String(error) }));
    return () => {
      live = false;
    };
  }, [host, params.sessionId, params.path, kind.media]);

  if (!shown) return <ActivityIndicator style={styles.loading} />;
  if ("failed" in shown) return <Text style={[styles.note, styles.failed]}>{shown.failed}</Text>;
  if ("image" in shown) return <Image source={{ uri: shown.image }} style={styles.image} resizeMode="contain" />;
  const { file } = shown;
  if (file.binary) return <Text style={styles.note}>A binary file of {file.bytes.toLocaleString()} bytes.</Text>;
  return (
    <View style={styles.screen}>
      {file.truncated ? <Text style={styles.note}>Only the first part of this file is shown.</Text> : null}
      <Code text={file.text} wrap={wrap} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  loading: { marginTop: 40 },
  note: { padding: 12, fontSize: 13, color: "#6E6E73" },
  failed: { color: "#D70015" },
  image: { flex: 1, backgroundColor: "#F2F2F7" },
  line: { flexDirection: "row", paddingRight: 12 },
  number: { width: 44, textAlign: "right", paddingRight: 8, fontSize: 12, lineHeight: 18, color: "#AEAEB2", fontFamily: "Menlo" },
  code: { fontSize: 12, lineHeight: 18, color: "#1C1C1E", fontFamily: "Menlo", flexShrink: 1 },
});
