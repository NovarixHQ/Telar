import { useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import { useEffect, useLayoutEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useKeyCommand } from "../commands";
import { FloatingComposer } from "../composer";
import { hosts, useHosts } from "../hosts";
import { PanelColumn, PanelView, usePanelColumn } from "../panel";
import { setVisibleSession } from "../push";
import { feedOf, TranscriptScroll, useFeed } from "../transcript";
import { present } from "../../platform/connection";
import { useKeyboardOverlap, useSplitColumn } from "../../platform/layout";
import { Theme } from "../../ui";
import { useSessionHeader } from "./session-header";
import { StatusNotice } from "./StatusNotice";
import { useRail } from "./use-rail";
import { useReadReceipt } from "./use-read-receipt";
import type { RootStack } from "../../platform/navigation/routes";

export function SessionScreen() {
  const { params } = useRoute<RouteProp<RootStack, "Session">>();
  const navigation = useNavigation<NavigationProp<RootStack>>();
  const split = useSplitColumn();
  const rows = useHosts(hosts);
  const host = hosts.get(params.hostId);
  const connection = rows.find((row) => row.connection === host)?.state;
  const feed = useFeed(host, params.sessionId);
  const [footer, setFooter] = useState(0);
  const keyboard = useKeyboardOverlap();
  const [pin, setPin] = useState(0);
  const [problem, setProblem] = useState<string>();
  const { rows: railRows } = useRail(params.hostId);
  const receipt = useReadReceipt(host, params.sessionId, feed.head);

  const act = async (work: () => Promise<unknown>) => {
    setProblem(undefined);
    try {
      await work();
      if (host) await feedOf(host, params.sessionId)?.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  const column = usePanelColumn(params.hostId, params.sessionId, (tab) => navigation.navigate("Panel", { hostId: params.hostId, sessionId: params.sessionId, ...(tab ? { tab } : {}) }));
  useKeyCommand("togglePanel", () => column.toggle(), { enabled: column.wantsColumn, title: column.state.isOpen ? "Hide panel" : "Show panel" });
  useKeyCommand("leaveFullScreen", () => column.panel.setFullScreen(false), { enabled: column.shown && column.state.fullScreen });
  useSessionHeader(host, params.sessionId, feed.head?.session, params.title, (work) => void act(work), column.toggle);

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

  const panel = host ? <PanelView host={host} sessionId={params.sessionId} panel={column.panel} state={column.state} presentation="column" onClose={column.panel.close} /> : null;
  useLayoutEffect(() => {
    split.setAside({
      full: column.shown && column.state.fullScreen,
      render: (total) => <PanelColumn shown={column.shown} full={column.state.fullScreen} width={column.width} onWidth={column.setWidth} total={total} panel={panel} />,
    });
  }, [host, params.sessionId, column.shown, column.state, column.width]);
  useEffect(() => () => split.setAside(undefined), []);
  useEffect(() => {
    setVisibleSession({ hostId: params.hostId, sessionId: params.sessionId });
    return () => setVisibleSession(undefined);
  }, [params.hostId, params.sessionId]);
  return (
    <View style={styles.screen}>
      <TranscriptScroll
        turns={feed.turns}
        loading={!feed.head && !feed.failed}
        pin={pin}
        bottomInset={footer + keyboard}
        receipt={receipt}
        source={host ? { host, sessionId: params.sessionId } : undefined}
        older={feed.hasOlder ? { loading: Boolean(feed.loadingOlder), load: () => void feedOf(host, params.sessionId)?.loadOlder() } : undefined}
      />
      <FloatingComposer
        host={host}
        hostId={params.hostId}
        sessionId={params.sessionId}
        mentions={railRows}
        notices={notices}
        {...(params.draft ? { initialDraft: params.draft } : {})}
        keyboard={keyboard}
        onHeight={setFooter}
        onSent={() => setPin((value) => value + 1)}
        reference={column.state.reference}
        onReference={() => {
          column.panel.clearReference();
          if (column.state.fullScreen) column.panel.close();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.canvas },
});
