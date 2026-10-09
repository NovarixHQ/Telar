import { Host, Spacer, VStack } from "@expo/ui/swift-ui";
import { padding } from "@expo/ui/swift-ui/modifiers";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { LiveSessionsAnswer, RunConfigurationView, RunView, SessionChild, SessionDiff, Subscription } from "@telar/engine-client";
import { useCallback, useEffect, useState } from "react";
import { AppState, RefreshControl, ScrollView, StyleSheet } from "react-native";
import type { HostConnection } from "../../../platform/connection";
import { Theme } from "../../../ui";
import { DiffCounts, relativeTime, StatBar } from "../../git";
import { AgentRow, AgentSection, AgentsEmpty, FactRow, FactValue } from "./AgentRows";
import { childDetail, childState, coordinatorDetail, coordinatorsOf, coordinatorState, delegateDetail, delegatesOf, delegateState, sessionFacts, workspaceProcesses } from "./agents";

const POLL_MS = 10_000;

type Reads = { live?: LiveSessionsAnswer; following?: Subscription[]; children?: SessionChild[]; diff?: SessionDiff; configs?: RunConfigurationView[]; terminals?: RunView[]; loaded: boolean; failed: boolean };

function useSessionReads(host: HostConnection, sessionId: string) {
  const [reads, setReads] = useState<Reads>({ loaded: false, failed: false });
  const read = useCallback(async () => {
    const value = <T,>(result: PromiseSettledResult<T>) => (result.status === "fulfilled" ? result.value : undefined);
    const call = <T,>(run: () => Promise<T>) => host.call(true, run);
    const [live, following, children, diff, configs, terminals] = await Promise.allSettled([
      call(() => host.client.liveSessions({ all: true })),
      call(() => host.client.subscriptions(sessionId)),
      call(() => host.client.children(sessionId)),
      call(() => host.client.sessionDiff(sessionId)),
      call(() => host.client.runConfigurations(sessionId)),
      call(() => host.client.runStatus(sessionId)),
    ]);
    setReads((current) => ({
      live: value(live) ?? current.live,
      following: value(following)?.subscriptions ?? current.following,
      children: value(children)?.children ?? current.children,
      diff: value(diff)?.diff ?? current.diff,
      configs: value(configs)?.configurations ?? current.configs,
      terminals: value(terminals)?.terminals ?? current.terminals,
      loaded: true,
      failed: live.status === "rejected",
    }));
  }, [host, sessionId]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = (active: boolean) => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (!active) return;
      void read();
      timer = setInterval(() => void read(), POLL_MS);
    };
    run(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => run(state === "active"));
    return () => {
      subscription.remove();
      if (timer) clearInterval(timer);
    };
  }, [read]);
  return { reads, read };
}

/** What this session runs on and who works with it: its builders and sub-agents, and the sessions it works for. */
export function SessionSurface({ host, sessionId }: { host: HostConnection; sessionId: string }) {
  const navigation = useNavigation();
  const { reads, read } = useSessionReads(host, sessionId);
  const [refreshing, setRefreshing] = useState(false);
  const now = Date.now();
  const ago = (at: number) => relativeTime(at, now);

  const sessions = reads.live?.sessions ?? [];
  const assignments = reads.live?.assignments ?? {};
  const children = reads.children ?? [];
  const tasked = new Set(children.map((child) => child.sessionId));
  const delegates = delegatesOf(sessions, assignments, sessionId, reads.following).filter((entry) => !tasked.has(entry.session.id));
  const employers = coordinatorsOf(sessions, assignments, sessionId);
  const session = sessions.find((candidate) => candidate.id === sessionId);
  const diff = reads.diff;
  const open = (id: string) => () => navigation.dispatch(StackActions.push("Session", { hostId: host.hostId, sessionId: id }));

  const workspace = session ? session.workspace : undefined;
  const path = (workspace && workspace.mode !== "none" ? workspace.path : undefined) ?? diff?.workspacePath;
  const worktree = workspace?.mode === "worktree";
  const branch = diff?.branch ?? (workspace?.mode === "worktree" ? workspace.branch : undefined);
  const processes = workspaceProcesses(reads.configs ?? [], reads.terminals ?? [], session?.activityDetail?.kind === "background" ? session.activityDetail.tasks : undefined);
  const facts = session ? sessionFacts(session, reads.live?.projects.find((project) => project.id === session.projectId)?.name, host.name, ago) : [];

  return (
    <ScrollView
      style={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void read().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Host matchContents={{ vertical: true }}>
        <VStack alignment="leading" spacing={20} modifiers={[padding({ horizontal: 12, vertical: 14 })]}>
          {session ? (
            <>
              <AgentSection label="About">
                {facts.map((fact, index) => (
                  <FactRow key={fact.label} label={fact.label} last={index === facts.length - 1}>
                    <FactValue text={fact.value} />
                  </FactRow>
                ))}
              </AgentSection>
              <AgentSection label="Workspace">
                <AgentRow
                  title={path ? path.slice(path.replace(/\/+$/, "").lastIndexOf("/") + 1) : worktree ? "Own worktree" : "Project checkout"}
                  detail={path}
                  state={{ label: worktree ? "Worktree" : "Checkout", tone: "quiet" }}
                  last={processes.length === 0}
                />
                {processes.map((process, index) => (
                  <AgentRow key={process.id} title={process.title} detail={process.detail} state={process.state} last={index === processes.length - 1} />
                ))}
              </AgentSection>
              {branch || diff?.repository ? (
                <AgentSection label="Version control">
                  <FactRow label="Branch" last={!diff?.repository}>
                    <FactValue text={branch ?? "Detached"} mono />
                  </FactRow>
                  {diff?.repository ? (
                    <FactRow label="Changes" last>
                      <DiffCounts added={diff.linesAdded} removed={diff.linesRemoved} />
                      <Spacer minLength={0} />
                      <StatBar added={diff.linesAdded} removed={diff.linesRemoved} />
                    </FactRow>
                  ) : null}
                </AgentSection>
              ) : null}
            </>
          ) : null}
          {children.length + delegates.length + employers.length === 0 ? (
            reads.loaded ? (
              <AgentsEmpty failed={reads.failed} />
            ) : null
          ) : (
            <>
              {children.length + delegates.length > 0 ? (
                <AgentSection label="Agents" count={children.length + delegates.length}>
                  {children.map((child, index) => {
                    const row = sessions.find((candidate) => candidate.id === child.sessionId);
                    const title = child.title || row?.title;
                    const live = child.state === "working" || child.state === "waiting";
                    return (
                      <AgentRow
                        key={child.sessionId}
                        title={title || "Untitled session"}
                        detail={childDetail(child, ago)}
                        state={childState(child)}
                        activity={live ? row?.activity : undefined}
                        onOpen={open(child.sessionId)}
                        last={delegates.length === 0 && index === children.length - 1}
                      />
                    );
                  })}
                  {delegates.map((entry, index) => (
                    <AgentRow
                      key={entry.session.id}
                      title={entry.session.title || "Untitled session"}
                      detail={delegateDetail(entry, ago)}
                      state={delegateState(entry)}
                      activity={entry.kind === "finished" && entry.outcome ? undefined : entry.session.activity}
                      onOpen={open(entry.session.id)}
                      last={index === delegates.length - 1}
                    />
                  ))}
                </AgentSection>
              ) : null}
              {employers.length > 0 ? (
                <AgentSection label="Working for" count={employers.length}>
                  {employers.map((entry, index) => (
                    <AgentRow
                      key={entry.id}
                      title={entry.session?.title || `Conversation ${entry.sessionId.slice(0, 8)}`}
                      detail={coordinatorDetail(entry, ago)}
                      state={coordinatorState(entry)}
                      activity={entry.session?.activity}
                      onOpen={entry.session ? open(entry.sessionId) : undefined}
                      last={index === employers.length - 1}
                    />
                  ))}
                </AgentSection>
              ) : null}
            </>
          )}
        </VStack>
      </Host>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ scroll: { flex: 1, backgroundColor: Theme.canvas } });
