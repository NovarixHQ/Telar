import { useRoute, type RouteProp } from "@react-navigation/native";
import type { GitFileChange, GitFilePatch, SessionDiff } from "@telar/engine-client";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { HostConnection } from "../../platform/connection";
import type { RootStack } from "../../platform/navigation/routes";
import { hosts, useHosts } from "../hosts";
import { parsePatch, type PatchRow } from "./patch";
import { diffHeadline, diffWarnings, fileLine } from "./summary";

const PATCH_LINES = 400;
const LETTER_TONE: Record<string, string> = { A: "#248A3D", U: "#248A3D", D: "#D70015", R: "#AF52DE", M: "#C93400" };
const ROW_TINT: Partial<Record<PatchRow["kind"], string>> = { add: "#E6F6EA", del: "#FDE8E8", hunk: "#EEF3FB" };

function Patch({ host, sessionId, file }: { host: HostConnection; sessionId: string; file: GitFileChange }) {
  const [patch, setPatch] = useState<GitFilePatch | string>();
  const [limit, setLimit] = useState(PATCH_LINES);
  useEffect(() => {
    let live = true;
    host
      .call(true, () => host.client.sessionFilePatch(sessionId, file.path, file.status === "untracked" ? { untracked: true } : {}))
      .then(({ file: read }) => live && setPatch(read))
      .catch((error: unknown) => live && setPatch(error instanceof Error ? error.message : String(error)));
    return () => {
      live = false;
    };
  }, [host, sessionId, file.path, file.status]);
  if (patch === undefined) return <ActivityIndicator style={styles.patchLoading} />;
  if (typeof patch === "string") return <Text style={styles.note}>{patch}</Text>;
  if (patch.binary) return <Text style={styles.note}>Binary file.</Text>;
  const rows = parsePatch(patch.patch);
  if (rows.length === 0) return <Text style={styles.note}>No textual difference.</Text>;
  return (
    <View>
      <ScrollView horizontal>
        <View>
          {rows.slice(0, limit).map((row, index) => (
            <View key={index} style={[styles.patchRow, ROW_TINT[row.kind] ? { backgroundColor: ROW_TINT[row.kind] } : null]}>
              <Text style={styles.gutter}>{"old" in row && row.old !== undefined ? row.old : ""}</Text>
              <Text style={styles.gutter}>{"new" in row && row.new !== undefined ? row.new : ""}</Text>
              <Text style={[styles.code, row.kind === "hunk" && styles.hunk]}>{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "} {row.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      {rows.length > limit ? (
        <Pressable accessibilityRole="button" onPress={() => setLimit(rows.length)}>
          <Text style={styles.more}>Show {rows.length - limit} more lines</Text>
        </Pressable>
      ) : null}
      {patch.incomplete ? <Text style={styles.note}>Git didn't finish this file's diff.</Text> : null}
    </View>
  );
}

export function DiffScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Diff">>();
  useHosts(hosts);
  const host = hosts.get(params.hostId);
  const [diff, setDiff] = useState<SessionDiff>();
  const [failed, setFailed] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    if (!host) return;
    try {
      setDiff((await host.call(true, () => host.client.sessionDiff(params.sessionId))).diff);
      setFailed(undefined);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }, [host, params.sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      {!diff && !failed ? <ActivityIndicator style={styles.patchLoading} /> : null}
      {failed ? <Text style={[styles.note, styles.failed]}>{failed}</Text> : null}
      {diff ? (
        <>
          <Text style={styles.headline}>{diffHeadline(diff)}</Text>
          {diff.branch ? <Text style={styles.branch} numberOfLines={1} ellipsizeMode="middle">⎇ {diff.branch}</Text> : null}
          {diffWarnings(diff).map((warning) => (
            <Text key={warning} style={styles.warning}>{warning}</Text>
          ))}
          {diff.files.length === 0 ? <Text style={styles.note}>No changes yet.</Text> : null}
          {diff.files.map((file) => {
            const line = fileLine(file);
            const open = !closed.has(file.path);
            return (
              <View key={file.path} style={styles.file}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setClosed((current) => { const next = new Set(current); if (open) next.add(file.path); else next.delete(file.path); return next; })}
                  style={styles.fileHeader}
                >
                  <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
                  <Text style={[styles.letter, { color: LETTER_TONE[line.letter] }]}>{line.letter}</Text>
                  <View style={styles.fileText}>
                    <Text style={styles.fileName} numberOfLines={1}>{line.name}</Text>
                    {line.detail ? <Text style={styles.folder} numberOfLines={1}>{line.detail}</Text> : null}
                  </View>
                  <Text style={styles.counts}>{line.counts}</Text>
                </Pressable>
                {open && host ? <Patch host={host} sessionId={params.sessionId} file={file} /> : null}
              </View>
            );
          })}
          {diff.commits.length > 0 ? <Text style={styles.section}>{diff.commits.length} {diff.commits.length === 1 ? "commit" : "commits"}</Text> : null}
          {diff.commits.map((commit) => (
            <View key={commit.sha} style={styles.commit}>
              <Text style={styles.sha}>{commit.shortSha}</Text>
              <Text style={styles.subject} numberOfLines={2}>{commit.subject}</Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F2F2F7" },
  content: { padding: 12, gap: 10 },
  headline: { fontSize: 17, fontWeight: "600", color: "#1C1C1E" },
  branch: { fontSize: 13, color: "#6E6E73", fontFamily: "Menlo" },
  warning: { fontSize: 13, color: "#8A5300", backgroundColor: "#FFF4E0", padding: 8, borderRadius: 8 },
  note: { fontSize: 13, color: "#6E6E73", padding: 8 },
  failed: { color: "#D70015" },
  file: { backgroundColor: "white", borderRadius: 12, overflow: "hidden" },
  fileHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  chevron: { width: 12, color: "#8E8E93" },
  letter: { width: 14, fontWeight: "700", fontFamily: "Menlo" },
  fileText: { flex: 1 },
  fileName: { fontSize: 15, color: "#1C1C1E" },
  folder: { fontSize: 12, color: "#8E8E93" },
  counts: { fontSize: 12, color: "#6E6E73", fontFamily: "Menlo" },
  patchLoading: { margin: 12 },
  patchRow: { flexDirection: "row" },
  gutter: { width: 34, textAlign: "right", paddingRight: 6, fontSize: 11, color: "#AEAEB2", fontFamily: "Menlo" },
  code: { fontSize: 12, fontFamily: "Menlo", color: "#1C1C1E", paddingRight: 12 },
  hunk: { color: "#3478F6" },
  more: { fontSize: 13, color: "#0A84FF", padding: 10 },
  section: { fontSize: 13, fontWeight: "600", color: "#6E6E73", marginTop: 6 },
  commit: { flexDirection: "row", gap: 8, backgroundColor: "white", borderRadius: 10, padding: 10 },
  sha: { fontSize: 12, fontFamily: "Menlo", color: "#6E6E73" },
  subject: { flex: 1, fontSize: 14, color: "#1C1C1E" },
});
