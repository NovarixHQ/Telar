import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import type { WorkspaceListing } from "@telar/engine-client";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts, useHosts } from "../hosts";
import { fileListing } from "./tree";

export function FilesScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Files">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const [listing, setListing] = useState<WorkspaceListing>();
  const [failed, setFailed] = useState<string>();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!host) return;
    let live = true;
    host
      .call(true, () => host.client.sessionFiles(params.sessionId))
      .then(({ listing: read }) => live && setListing(read))
      .catch((error: unknown) => live && setFailed(error instanceof Error ? error.message : String(error)));
    return () => {
      live = false;
    };
  }, [host, params.sessionId]);

  if (!listing) {
    return <View style={styles.screen}>{failed ? <Text style={styles.failed}>{failed}</Text> : <ActivityIndicator style={styles.loading} />}</View>;
  }
  const { rows, footer } = fileListing(listing.files, query, closed, listing.truncated);
  const toggle = (path: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <View style={styles.screen}>
      <TextInput style={styles.search} placeholder="Find a file" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.node.path}
        renderItem={({ item: { node, depth } }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => (node.kind === "directory" ? toggle(node.path) : navigation.navigate("File", { hostId: params.hostId, sessionId: params.sessionId, path: node.path }))}
            style={[styles.row, { paddingLeft: 12 + depth * 16 }]}
          >
            <Text style={styles.icon}>{node.kind === "directory" ? (closed.has(node.path) && !query ? "▸" : "▾") : "·"}</Text>
            <Text style={[styles.name, node.kind === "directory" && styles.folder]} numberOfLines={1}>{node.name}</Text>
          </Pressable>
        )}
        ListFooterComponent={<Text style={styles.footer}>{footer}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "white" },
  loading: { marginTop: 40 },
  failed: { margin: 16, color: "#D70015" },
  search: { margin: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#F2F2F7", fontSize: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingRight: 12 },
  icon: { width: 12, color: "#8E8E93" },
  name: { flex: 1, fontSize: 15, color: "#1C1C1E" },
  folder: { fontWeight: "500" },
  footer: { padding: 16, fontSize: 12, color: "#8E8E93", textAlign: "center" },
});
