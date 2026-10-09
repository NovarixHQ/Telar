import { Alert, Button, Host, HStack, Label, Menu, ProgressView, ScrollView, Section, Text, TextField, useNativeState, VStack } from "@expo/ui/swift-ui";
import { background, buttonStyle, clipShape, disabled, font, foregroundStyle, frame, lineLimit, padding, strokeBorder, type ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { EnvMode } from "@telar/engine-client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Settings, StyleSheet, useColorScheme, View } from "react-native";
import { useKeyboardOverlap } from "../../platform/layout";
import type { RootStack } from "../../platform/navigation/routes";
import { Icon, palette, ProjectAvatar, Theme, type SymbolName } from "../../ui";
import { DraftComposer, type DraftFile } from "../composer";
import { hosts } from "../hosts";
import { useProjectIcon } from "../projects";
import { DraftMenus, type DraftPicks } from "../providers";
import { newRunId } from "../transcript";
import { createdRoute, preferredTarget, shortRef, startSession, targetKey, workspaceLabel, type Target, type Workspace } from "./new-session";
import { StatusNotice } from "./StatusNotice";
import { newSessionMemory, useTargets } from "./use-targets";

type Navigation = NativeStackNavigationProp<RootStack, "NewSession">;

const chip: ModifierConfig[] = [
  padding({ horizontal: 14 }),
  frame({ height: 44 }),
  background(Theme.subtle),
  clipShape("capsule"),
  strokeBorder({ color: Theme.border, style: { lineWidth: 1 }, shape: "capsule" }),
];
const chipText = [font({ textStyle: "subheadline", weight: "semibold" }), foregroundStyle(Theme.text), lineLimit(1)];
const chevron = <Icon name="chevron.down" textStyle="caption" weight="medium" color={Theme.text} />;

function Avatar({ target }: { target: Target }) {
  const image = useProjectIcon(target.hostId, target.project.id, target.project.icon);
  return <ProjectAvatar name={target.project.name} iconName={target.project.iconName} iconEmoji={target.project.iconEmoji} image={image} size={18} />;
}

function ProjectChip({ target, loading, showHost, onPress }: { target: Target | undefined; loading: boolean; showHost: boolean; onPress: () => void }) {
  return (
    <Button onPress={onPress} modifiers={[buttonStyle("plain")]}>
      <HStack spacing={8} modifiers={chip}>
        {target ? <Avatar target={target} /> : <Icon name="folder" textStyle="subheadline" color={Theme.text} />}
        <Text modifiers={chipText}>{target?.project.name ?? (loading ? "Loading projects…" : "Choose a project")}</Text>
        {target && showHost ? <Text modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(Theme.textMuted), lineLimit(1)]}>{target.hostName}</Text> : null}
        {chevron}
      </HStack>
    </Button>
  );
}

const row = (label: string, selected: boolean, onPress: () => void) => <Button label={label} onPress={onPress} {...(selected ? { systemImage: "checkmark" as SymbolName } : {})} />;

function WorkspaceChip({ workspace, onMode, onStart, onName }: { workspace: Workspace; onMode: (mode: EnvMode) => void; onStart: () => void; onName: () => void }) {
  const label = (
    <HStack spacing={8} modifiers={[...chip, frame({ maxWidth: 220 })]}>
      <Icon name="point.topleft.down.curvedto.point.bottomright.up" textStyle="subheadline" color={Theme.text} />
      <Text modifiers={chipText}>{workspaceLabel(workspace)}</Text>
      {chevron}
    </HStack>
  );
  return (
    <Menu label={label}>
      <Section title="Mode">
        {row("New worktree", workspace.envMode === "worktree", () => onMode("worktree"))}
        {row("Current checkout", workspace.envMode === "local", () => onMode("local"))}
      </Section>
      {workspace.envMode === "worktree" ? (
        <>
          <Button label={workspace.baseRef ? `Start from: ${shortRef(workspace.baseRef)}` : "Start from…"} systemImage="arrow.triangle.branch" onPress={onStart} />
          <Button label={workspace.branchName ? `Branch: ${workspace.branchName}` : "Name the branch…"} systemImage="signature" onPress={onName} />
        </>
      ) : null}
    </Menu>
  );
}

function BranchAlert({ shown, onShown, current, onUse, children }: { shown: boolean; onShown: (shown: boolean) => void; current: string; onUse: (name: string) => void; children: ReactNode }) {
  const text = useNativeState(current);
  useEffect(() => {
    if (shown) text.set(current);
  }, [shown]);
  return (
    <Alert title="Name the branch" isPresented={shown} onIsPresentedChange={onShown}>
      <Alert.Trigger>{children}</Alert.Trigger>
      <Alert.Actions>
        <TextField placeholder="branch-name" text={text} />
        <Button label="Use it" onPress={() => onUse(text.get().trim())} />
        <Button label="Cancel" role="cancel" onPress={() => onShown(false)} />
      </Alert.Actions>
      <Alert.Message>
        <Text>Leave it empty to let the engine name the worktree's branch.</Text>
      </Alert.Message>
    </Alert>
  );
}

/** A new session: the project and workspace up top, the first message in the composer below. */
export function NewSessionScreen() {
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<RouteProp<RootStack, "NewSession">>();
  const { targets, activity, loading, unreachable, computers } = useTargets();
  const [mode, setMode] = useState(() => ({ envMode: newSessionMemory.envMode(), branchName: "" }));
  const [picks, setPicks] = useState<DraftPicks>({ driver: "claude" });
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<{ key: string; sessionId: string }>();
  const [runId] = useState(() => newRunId());

  const keyboard = useKeyboardOverlap();
  const canvas = palette.canvas[useColorScheme() === "dark" ? "dark" : "light"];
  useLayoutEffect(() => navigation.setOptions({ headerStyle: { backgroundColor: canvas } }), [navigation, canvas]);

  const chosen = params?.hostId && params.projectId ? targetKey(params.hostId, params.projectId) : undefined;
  const target = targets.find((entry) => targetKey(entry.hostId, entry.project.id) === chosen) ?? (chosen ? undefined : preferredTarget(targets, activity, newSessionMemory.target()));
  const key = target && targetKey(target.hostId, target.project.id);
  const host = target && hosts.get(target.hostId);
  const locked = busy || created !== undefined;
  const workspace: Workspace = { ...mode, ...(mode.envMode === "worktree" && params?.baseRef ? { baseRef: params.baseRef } : {}) };

  const pick = (next: Partial<typeof mode>) => {
    setMode((current) => ({ ...current, ...next, ...(next.envMode === "local" ? { branchName: "" } : {}) }));
    if (next.envMode === "local") navigation.setParams({ baseRef: undefined });
  };
  const send = async (text: string, files: readonly DraftFile[] = []): Promise<boolean> => {
    if (!target || !host || !key) {
      setError(loading ? "Projects are still loading." : "Choose a project first.");
      return false;
    }
    setBusy(true);
    setError(undefined);
    try {
      const draft = { projectId: target.project.id, workspace, ...picks, prompt: text, files, runId };
      const sessionId = await startSession(hosts, target.hostId, draft, created?.key === key ? created.sessionId : undefined, (id) => {
        setCreated({ key, sessionId: id });
        newSessionMemory.remember(key, workspace.envMode);
      });
      const route = createdRoute(target.hostId, sessionId, text);
      navigation.replace(route.name, route.params);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // `-telarStartOnOpen <text>` at launch starts a session with it once a project is picked, so a simulator can test it without typing.
  const startedOnOpen = useRef(false);
  useEffect(() => {
    const text: unknown = Settings.get("telarStartOnOpen");
    if (startedOnOpen.current || !host || !params?.projectId || typeof text !== "string" || !text) return;
    startedOnOpen.current = true;
    void send(text);
  });

  const notices = error ? <StatusNotice tint="red" text={error} actions={[{ label: "Dismiss", onPress: () => setError(undefined) }]} /> : null;
  return (
    <View style={styles.screen}>
      <Host style={styles.screen}>
        <ScrollView>
          <BranchAlert shown={naming} onShown={setNaming} current={workspace.branchName} onUse={(branchName) => (pick({ branchName }), setNaming(false))}>
            <VStack spacing={14} modifiers={[padding({ horizontal: 16, top: 48 }), frame({ maxWidth: Infinity }), disabled(locked)]}>
              <HStack spacing={8}>
                <ProjectChip target={target} loading={loading} showHost={computers > 1} onPress={() => navigation.navigate("ProjectPicker", target ? { hostId: target.hostId, projectId: target.project.id } : undefined)} />
                <WorkspaceChip
                  workspace={workspace}
                  onMode={(envMode) => pick({ envMode })}
                  onStart={() => target && navigation.navigate("BranchPicker", { hostId: target.hostId, projectId: target.project.id, ...(workspace.baseRef ? { baseRef: workspace.baseRef } : {}) })}
                  onName={() => setNaming(true)}
                />
              </HStack>
              {unreachable.length ? <Label title={`${unreachable.join(", ")} didn't answer.`} systemImage="wifi.slash" modifiers={[font({ textStyle: "caption" }), foregroundStyle(Theme.amber)]} /> : null}
              {busy ? (
                <ProgressView modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.textMuted)]}>
                  <Text>Starting the session…</Text>
                </ProgressView>
              ) : null}
            </VStack>
          </BranchAlert>
        </ScrollView>
      </Host>
      <DraftComposer
        keyboard={keyboard}
        host={host}
        draftKey={target ? { hostId: target.hostId, id: `new.${target.project.id}` } : undefined}
        placeholder={target ? `Describe a coding task in ${target.project.name}` : "Describe a coding task"}
        controls={host ? <DraftMenus host={host} picks={picks} onPicks={setPicks} /> : undefined}
        notices={notices}
        busy={busy}
        onSend={send}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Theme.canvas },
});
