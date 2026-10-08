import { useRoute, type RouteProp } from "@react-navigation/native";
import { useState } from "react";
import { isActiveTurn } from "@telar/client/journal";
import { KeyboardAvoidingView, StyleSheet } from "react-native";
import { FloatingComposer } from "../composer";
import { hosts, useHosts } from "../hosts";
import { feedOf, TranscriptScroll, useFeed } from "../transcript";
import { present } from "../../platform/connection";
import { Theme } from "../../ui";
import { useSessionHeader } from "./session-header";
import { StatusNotice } from "./StatusNotice";
import { useRail } from "./use-rail";
import type { RootStack } from "../../platform/navigation/routes";

export function SessionScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Session">>();
  const rows = useHosts(hosts);
  const host = hosts.get(params.hostId);
  const connection = rows.find((row) => row.connection === host)?.state;
  const feed = useFeed(host, params.sessionId);
  const [footer, setFooter] = useState(0);
  const [pin, setPin] = useState(0);
  const [problem, setProblem] = useState<string>();
  const working = feed.turns.some((turn) => isActiveTurn(turn.state));
  const { rows: railRows } = useRail(params.hostId);

  const act = async (work: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await work();
      if (host) await feedOf(host, params.sessionId)?.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  useSessionHeader(host, params.sessionId, feed.head?.session, params.title, (work) => void act(work));

  const offline = connection && connection.kind !== "online" && connection.kind !== "connecting" ? present(connection, Date.now()).label : undefined;
  const lost = offline ?? feed.failed;
  const notices = (
    <>
      {lost ? (
        <StatusNotice
          tint="amber"
          icon="wifi.exclamationmark"
          text={feed.head ? `Showing what was recorded — ${lost}` : lost}
          actions={[{ label: "Retry", onPress: () => {
            host?.wake("reconnect");
            void feedOf(host, params.sessionId)?.refresh();
          } }]}
        />
      ) : null}
      {problem ? <StatusNotice tint="red" text={problem} /> : null}
    </>
  );

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <TranscriptScroll
        turns={feed.turns}
        loading={!feed.head && !feed.failed}
        pin={pin}
        bottomInset={footer}
        older={feed.hasOlder ? { loading: Boolean(feed.loadingOlder), load: () => void feedOf(host, params.sessionId)?.loadOlder() } : undefined}
      />
      <FloatingComposer
        host={host}
        hostId={params.hostId}
        sessionId={params.sessionId}
        head={feed.head}
        working={working}
        mentions={railRows}
        notices={notices}
        {...(params.draft ? { initialDraft: params.draft } : {})}
        onHeight={setFooter}
        onSent={() => setPin((value) => value + 1)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.canvas },
});
