import { Alert, Button, ContentUnavailableView, Host, HStack, NavigationDestination, NavigationStack, ProgressView, Rectangle, ScrollView, Spacer, Text, TextField, Toolbar, ToolbarItem, useNativeState, VStack } from "@expo/ui/swift-ui";
import {
  autocorrectionDisabled,
  background,
  buttonStyle,
  clipShape,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  navigationBarTitleDisplayMode,
  navigationTitle,
  onSubmit,
  opacity,
  padding,
  shapes,
  submitLabel,
  textInputAutocapitalization,
  tint,
  truncationMode,
} from "@expo/ui/swift-ui/modifiers";
import type { DirectoryListing, Project } from "@telar/engine-client";
import { Fragment, useEffect, useState } from "react";
import type { HostConnection } from "../../platform/connection";
import { faded, Icon, Radius, Theme, type SymbolName } from "../../ui";
import { hosts } from "../hosts";
import { listDirectories, otherRoots, parseFolderPath, registerProject } from "./directories";

type Entry = { name: string; path: string; git?: boolean };
type PageProps = { host: HostConnection; path?: string; onOpen: (path: string) => void; onAdded: (project: Project) => void };

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

function FolderCard({ entries, icon, onOpen }: { entries: Entry[]; icon: (entry: Entry) => SymbolName; onOpen: (path: string) => void }) {
  return (
    <VStack spacing={0} modifiers={[background(Theme.card), clipShape("roundedRectangle", Radius.settingsCard)]}>
      {entries.map((entry, index) => (
        <Fragment key={entry.path}>
          <Button onPress={() => onOpen(entry.path)} modifiers={[buttonStyle("plain"), contentShape(shapes.rectangle())]}>
            <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 12 })]}>
              <Icon name={icon(entry)} textStyle="subheadline" color={entry.git ? Theme.accent : Theme.textMuted} modifiers={[frame({ width: 27 })]} />
              <Text modifiers={[font({ textStyle: "callout", weight: entry.git ? "bold" : "regular" }), foregroundStyle(Theme.text), lineLimit(1)]}>{entry.name}</Text>
              <Spacer minLength={8} />
              <Icon name="chevron.right" textStyle="footnote" weight="medium" color={Theme.textMuted} />
            </HStack>
          </Button>
          {index < entries.length - 1 ? <Rectangle modifiers={[foregroundStyle(faded("border", 0.6)), frame({ height: 1 })]} /> : null}
        </Fragment>
      ))}
    </VStack>
  );
}

function UseThisFolder({ listing, busy, onPress }: { listing: DirectoryListing; busy: boolean; onPress: () => void }) {
  return (
    <Button onPress={() => !busy && onPress()} modifiers={[buttonStyle("plain")]}>
      <HStack spacing={10} modifiers={[foregroundStyle(Theme.accentGlyph), padding({ horizontal: 16, vertical: 12 }), frame({ maxWidth: Infinity }), background(Theme.accent), clipShape("roundedRectangle", Radius.primaryButton)]}>
        {busy ? <ProgressView modifiers={[tint(Theme.accentGlyph)]} /> : <Icon name="plus.circle.fill" textStyle="body" />}
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ textStyle: "subheadline", weight: "bold" })]}>Use this folder</Text>
          <Text modifiers={[font({ textStyle: "footnote", design: "monospaced" }), lineLimit(1), truncationMode("head"), opacity(0.7)]}>{listing.path}</Text>
        </VStack>
        <Spacer minLength={0} />
      </HStack>
    </Button>
  );
}

function PathField({ host, onOpen }: { host: HostConnection; onOpen: (path: string) => void }) {
  const text = useNativeState("");
  const [problem, setProblem] = useState<string>();
  const [checking, setChecking] = useState(false);
  const open = async () => {
    const parsed = parseFolderPath(text.get());
    if (!parsed.ok) return setProblem(parsed.message);
    setChecking(true);
    try {
      const found = await listDirectories(host, parsed.path);
      setProblem(undefined);
      onOpen(found.path);
    } catch (error) {
      setProblem(failure(error));
    }
    setChecking(false);
  };
  return (
    <VStack alignment="leading" spacing={6}>
      <HStack spacing={10} modifiers={[padding({ horizontal: 16, vertical: 12 }), background(Theme.card), clipShape("roundedRectangle", Radius.statusCard)]}>
        <Icon name="text.cursor" textStyle="body" color={Theme.textMuted} />
        <TextField
          placeholder="/Volumes/Drive/project"
          text={text}
          modifiers={[font({ textStyle: "footnote", design: "monospaced" }), textInputAutocapitalization("never"), autocorrectionDisabled(), submitLabel("go"), onSubmit(() => void open())]}
        />
        {checking ? <ProgressView /> : null}
      </HStack>
      {problem ? <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.red), padding({ horizontal: 16 })]}>{problem}</Text> : null}
    </VStack>
  );
}

/** One folder on the host: use it as the project, or open one inside it. */
function FolderPage({ host, path, onOpen, onAdded }: PageProps) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  const [naming, setNaming] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [problem, setProblem] = useState<string>();
  const name = useNativeState("");
  useEffect(() => {
    listDirectories(host, path).then(setListing, (cause) => setError(failure(cause)));
  }, [host, path]);
  const register = async () => {
    if (!listing) return;
    setNaming(false);
    setRegistering(true);
    setProblem(undefined);
    try {
      onAdded(await registerProject(host, listing.path, name.get(), listing.name));
    } catch (cause) {
      setProblem(failure(cause));
    }
    setRegistering(false);
  };
  const title = [navigationTitle(listing?.name ?? "Browse"), navigationBarTitleDisplayMode("inline")];
  if (!listing) {
    return error ? (
      <ContentUnavailableView title="Could not browse" systemImage="xmark.circle" description={error} modifiers={[...title, background(Theme.sheet)]} />
    ) : (
      <ProgressView modifiers={[...title, frame({ maxWidth: Infinity, maxHeight: Infinity }), background(Theme.sheet)]} />
    );
  }
  const roots = path === undefined ? otherRoots(listing) : [];
  return (
    <Alert title="Name the project" isPresented={naming} onIsPresentedChange={setNaming}>
      <Alert.Trigger>
        <ScrollView modifiers={[...title, background(Theme.sheet)]}>
          <VStack spacing={12} modifiers={[padding({ horizontal: 20, top: 8, bottom: 32 })]}>
            <UseThisFolder
              listing={listing}
              busy={registering}
              onPress={() => {
                name.set(listing.name);
                setNaming(true);
              }}
            />
            {problem ? <Text modifiers={[font({ textStyle: "footnote" }), foregroundStyle(Theme.red), frame({ maxWidth: Infinity, alignment: "leading" }), padding({ horizontal: 16 })]}>{problem}</Text> : null}
            {path === undefined ? <PathField host={host} onOpen={onOpen} /> : null}
            {roots.length ? <FolderCard entries={roots} icon={() => "externaldrive"} onOpen={onOpen} /> : null}
            {listing.dirs.length ? <FolderCard entries={listing.dirs} icon={(entry) => (entry.git ? "arrow.triangle.branch" : "folder")} onOpen={onOpen} /> : null}
          </VStack>
        </ScrollView>
      </Alert.Trigger>
      <Alert.Actions>
        <TextField placeholder="Name" text={name} />
        <Button label="Add project" onPress={() => void register()} />
        <Button label="Cancel" role="cancel" onPress={() => setNaming(false)} />
      </Alert.Actions>
      <Alert.Message>
        <Text>{listing.path}</Text>
      </Alert.Message>
    </Alert>
  );
}

/** The Add project sheet: browse the host's folders, then register one. Present it modally with no header. */
export function AddProjectScreen({ hostId, onAdded, onCancel }: { hostId: string; onAdded: (project: Project) => void; onCancel: () => void }) {
  const [path, setPath] = useState<string[]>([]);
  const host = hosts.get(hostId);
  const open = (folder: string) => setPath((current) => [...current, folder]);
  if (!host) return null;
  return (
    <Host style={{ flex: 1 }}>
      <NavigationStack path={path} onPathChange={setPath} modifiers={[tint(Theme.accent)]}>
        <Toolbar>
          <FolderPage host={host} onOpen={open} onAdded={onAdded} />
          <Toolbar.Content>
            <ToolbarItem placement="cancellationAction">
              <Button label="Cancel" onPress={onCancel} />
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
        {path.map((folder) => (
          <NavigationDestination key={folder} value={folder}>
            <FolderPage host={host} path={folder} onOpen={open} onAdded={onAdded} />
          </NavigationDestination>
        ))}
      </NavigationStack>
    </Host>
  );
}
