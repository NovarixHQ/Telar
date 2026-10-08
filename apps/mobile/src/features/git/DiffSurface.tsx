import { Button, ContentUnavailableView, ContextMenu, HStack, Label, List, ProgressView, Section, Text } from "@expo/ui/swift-ui";
import {
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listRowSeparatorTint,
  listStyle,
  monospacedDigit,
  padding,
  refreshable,
  scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers";
import type { GitFileChange, SessionDiff } from "@telar/engine-client";
import { useCallback, useEffect, useState } from "react";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { HostConnection } from "../../platform/connection";
import { bandCaption, faded, Theme } from "../../ui";
import { DiffCommitRow, DiffFileRow, DiffSummary } from "./DiffRows";
import { PatchBody } from "./PatchBody";
import { diffNotes, fileLine } from "./summary";

const CLEAR = "#00000000";
const separator = faded("border", 0.6);
const plainRow = [listRowBackground(CLEAR), listRowSeparator("hidden")];

const clipboard = TurboModuleRegistry.get<TurboModule & { setString(text: string): void }>("Clipboard");

function FileMenuItems({ file, onOpenFile }: { file: GitFileChange; onOpenFile?: (path: string) => void }) {
  return (
    <>
      {file.status === "deleted" ? null : <Button label="Open in Editor" systemImage="sidebar.trailing" onPress={() => onOpenFile?.(file.path)} modifiers={onOpenFile ? [] : [disabled(true)]} />}
      {clipboard ? <Button label="Copy path" systemImage="doc.on.doc" onPress={() => clipboard.setString(file.path)} /> : null}
    </>
  );
}

function FileRows({ host, sessionId, file, generation, onOpenFile }: { host: HostConnection; sessionId: string; file: GitFileChange; generation: number; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <ContextMenu modifiers={[listRowBackground(CLEAR), listRowSeparatorTint(separator), listRowInsets({ top: 0, leading: 16, bottom: 0, trailing: 16 })]}>
        <ContextMenu.Items>
          <FileMenuItems file={file} {...(onOpenFile ? { onOpenFile } : {})} />
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <Button onPress={() => setOpen(!open)} modifiers={[buttonStyle("plain")]}>
            <DiffFileRow line={fileLine(file)} open={open} />
          </Button>
        </ContextMenu.Trigger>
      </ContextMenu>
      {open ? (
        <HStack modifiers={[...plainRow, listRowInsets({ top: 0, leading: 16, bottom: 10, trailing: 16 })]}>
          <PatchBody host={host} sessionId={sessionId} file={file} generation={generation} />
        </HStack>
      ) : null}
    </>
  );
}

function DiffList({ host, sessionId, diff, generation, reload, onOpenFile }: { host: HostConnection; sessionId: string; diff: SessionDiff; generation: number; reload: () => Promise<void>; onOpenFile?: (path: string) => void }) {
  const now = Date.now();
  return (
    <List modifiers={[listStyle("plain"), scrollContentBackground("hidden"), background(Theme.canvas), refreshable(reload)]}>
      <HStack modifiers={[...plainRow, listRowInsets({ top: 14, leading: 16, bottom: 10, trailing: 16 })]}>
        <DiffSummary diff={diff} notes={diffNotes(diff)} />
      </HStack>
      {diff.files.map((file) => (
        <FileRows key={file.path} host={host} sessionId={sessionId} file={file} generation={generation} {...(onOpenFile ? { onOpenFile } : {})} />
      ))}
      {diff.commits.length > 0 ? (
        <Section
          header={
            <HStack spacing={6} modifiers={[...bandCaption, padding({ top: 12 })]}>
              <Text>Commits</Text>
              <Text modifiers={[monospacedDigit()]}>{String(diff.commits.length)}</Text>
            </HStack>
          }
        >
          {diff.commits.map((commit) => (
            <HStack key={commit.sha} modifiers={[listRowBackground(CLEAR), listRowSeparatorTint(separator), listRowInsets({ top: 4, leading: 16, bottom: 4, trailing: 16 })]}>
              <DiffCommitRow commit={commit} now={now} />
            </HStack>
          ))}
        </Section>
      ) : null}
      {diff.files.length === 0 && diff.commits.length === 0 && !diff.filesIncomplete ? (
        <Label title="No changes yet." systemImage="checkmark.circle" modifiers={[...plainRow, font({ textStyle: "subheadline" }), foregroundStyle(Theme.textMuted)]} />
      ) : null}
    </List>
  );
}

/** What a session changed: a summary, each file's patch, and its commits. Pull to read it again. */
export function DiffSurface({ host, sessionId, onOpenFile }: { host: HostConnection; sessionId: string; onOpenFile?: (path: string) => void }) {
  const [diff, setDiff] = useState<SessionDiff>();
  const [failed, setFailed] = useState<string>();
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    try {
      setDiff((await host.call(true, () => host.client.sessionDiff(sessionId))).diff);
      setGeneration((current) => current + 1);
      setFailed(undefined);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }, [host, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (diff) return <DiffList host={host} sessionId={sessionId} diff={diff} generation={generation} reload={load} {...(onOpenFile ? { onOpenFile } : {})} />;
  if (failed) return <ContentUnavailableView title="Could not load changes" systemImage="xmark.circle" description={failed} modifiers={[background(Theme.canvas)]} />;
  return <ProgressView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(Theme.canvas)]} />;
}
